import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/database";
import { loadingScreenFeatureKey } from "../lib/loading-screen";
import type { ConferenceData } from "../lib/domain";

test("existing feature RPC persists committee loading flags, rejects Chairs and acknowledges an exact retry once", async () => {
  const fixture = await freshDatabase();
  const { db, ids, grant, as, query } = fixture;
  try {
    const executive = "20000000-0000-4000-8000-000000009011";
    const chair = "20000000-0000-4000-8000-000000009012";
    await grant(executive, "admin");
    await grant(chair, "chair", ids.ga1);
    const name = loadingScreenFeatureKey(ids.ga1);
    const command = { type: "feature", name, enabled: true };
    const mutation = crypto.randomUUID();
    const send = (role: string, enabled = true, id = mutation) => query(
      "select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)",
      [ids.conference, id, JSON.stringify({ ...command, enabled }), role, null, "2026-10-30T12:00:00Z"],
    );
    await as(chair);
    await assert.rejects(() => send("admin"), /access|permission|allowed/i);
    await assert.rejects(() => send("chair"), /access|permission|allowed|role/i);
    await as(executive);
    await send("admin");
    await send("admin");
    const snapshot = async () => (await query<{ data: ConferenceData }>("select public.conference_snapshot($1) data", [ids.conference]))[0].data;
    assert.equal((await snapshot()).conference.features[name], true);
    assert.equal((await query<{ n: number }>("select count(*)::int n from public.audit_log where mutation_id=$1", [mutation]))[0].n, 1);
    await as(chair);
    assert.equal((await snapshot()).conference.features[name], true, "Chair learns flag in the normal snapshot");
    await as(executive);
    await send("admin", false, crypto.randomUUID());
    assert.equal((await snapshot()).conference.features[name], false);
  } finally { await db.close(); }
});
