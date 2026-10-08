import test from "node:test";
import assert from "node:assert/strict";
import { sessionInputTime, sessionSlotFields } from "../components/central-session-fields";

test("central schedule input uses Qatar time and round-trips across UTC midnight", () => {
  assert.equal(sessionInputTime("2026-10-08T22:30:00Z"), "2026-10-09T01:30");
  assert.deepEqual(sessionSlotFields(" Morning ", "2026-10-09T01:30", "2026-10-09T02:30"), {name:"Morning",startsAt:"2026-10-08T22:30:00.000Z",endsAt:"2026-10-08T23:30:00.000Z"});
  assert.equal(sessionSlotFields("Morning", "2026-10-09T09:00", "").endsAt, null);
});
test("central schedule rejects malformed, impossible and reversed dates", () => {
  for (const start of ["", "2026-02-30T09:00", "2026-10-09T25:00", "2026-10-09T09:00Z"]) assert.throws(() => sessionSlotFields("Morning",start,""),/valid date and time/);
  assert.throws(() => sessionSlotFields("Morning","2026-10-09T09:00","2026-10-09T08:00"),/after start/);
  assert.throws(() => sessionSlotFields("Morning","2026-10-09T09:00","2026-10-09T09:00"),/after start/);
  assert.throws(() => sessionSlotFields(" ","2026-10-09T09:00",""),/session name/);
});
