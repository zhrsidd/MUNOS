import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  participationSummary,
  suggestedDelegates,
} from "../lib/repository";
import { createSeed } from "../lib/seed";
import { parseCSV, validateImport } from "../lib/import";
import { rollCall } from "./helpers/roll-call";

test("a ballot uses the roll call in force when it opens; Present & Voting cannot abstain; an absent delegate leaves the queue", () => {
  let data = createSeed();
  const run = (c: Parameters<typeof applyCommand>[1]) => { data = applyCommand(data, c, "chair"); };
  // Seed roll call: d1 is Present, so may abstain once the ballot is open.
  run({ type: "voteMode", committeeId: "ga1", resolutionId: "r1", mode: "normal", voteType: "procedural" });
  run({ type: "vote", delegateId: "d1", committeeId: "ga1", resolutionId: "r1", choice: "Abstain" });
  // A later roll call makes d1 Present & Voting: the open ballot keeps its snapshot.
  run(rollCall("ga1", { d0: "Present & Voting", d1: "Present & Voting", d2: "Present" }));
  run({ type: "vote", delegateId: "d1", committeeId: "ga1", resolutionId: "r1", choice: "Abstain" });
  // A fresh ballot snapshots the new roll call: d1 can no longer abstain.
  run({ type: "voteMode", committeeId: "ga1", resolutionId: "r1", mode: "normal", voteType: "procedural" });
  assert.throws(() => applyCommand(data, { type: "vote", delegateId: "d1", committeeId: "ga1", resolutionId: "r1", choice: "Abstain" }, "chair"), /Attendance/);
  // The live roll call marks d1 absent: d1 leaves the speaker queue.
  assert.equal(data.queue.some((q) => q.delegateId === "d1"), true);
  run(rollCall("ga1", { d0: "Present & Voting", d2: "Present" }));
  assert.equal(data.queue.some((q) => q.delegateId === "d1"), false);
  // Attendance commands are retired.
  assert.throws(() => applyCommand(data, { type: "attendance", delegateId: "d1", sessionId: "s1", status: "Present" }, "chair"), /roll calls/);
});
test("participation counts opportunities independently of points; undo retains an event", () => {
  let data = createSeed();
  const before = participationSummary(data, "d0");
  data = applyCommand(
    data,
    {
      type: "participation",
      delegateId: "d0",
      categoryId: "speech",
      points: 3,
      committeeId:"ga1",
      resolutionId: "r1",
    },
    "chair",
  );
  assert.deepEqual(participationSummary(data, "d0"), {
    opportunities: before.opportunities + 1,
    points: before.points + 3,
    speeches: before.speeches + 1,
  });
  const event = data.events.at(-1)!;
  data = applyCommand(
    data,
    { type: "event", id: event.id, points: 1 },
    "chair",
  );
  assert.equal(participationSummary(data, "d0").points, before.points + 1);
  data = applyCommand(
    data,
    { type: "event", id: event.id, undo: true },
    "chair",
  );
  assert.deepEqual(participationSummary(data, "d0"), before);
  assert.ok(data.events.find((e) => e.id === event.id)?.voidedAt);
});
test("suggestions favor opportunities, exclude absent and already queued delegates", () => {
  const data = createSeed();
  const list = suggestedDelegates(data, "ga1");
  assert.equal(participationSummary(data, list[0].id).opportunities, 0);
  assert.equal(
    list.some((d) => ["d0", "d1", "d2", "d10"].includes(d.id)),
    false,
  );
  const reordered = structuredClone(data);
  reordered.events.forEach((e) => (e.points = 999));
  assert.deepEqual(
    suggestedDelegates(reordered, "ga1").map((d) => d.id),
    list.map((d) => d.id),
  );
});
test("review, revision and print transitions preserve versions and reject wrong roles", () => {
  let data = createSeed();
  assert.throws(
    () =>
      applyCommand(
        data,
        { type: "document", id: "r2", status: "Approved" },
        "chair",
      ),
    /Chair/,
  );
  assert.throws(
    () =>
      applyCommand(
        data,
        { type: "document", id: "r2", status: "Draft" },
        "approval",
      ),
    /comment/,
  );
  data = applyCommand(
    data,
    {
      type: "document",
      id: "r2",
      status: "Draft",
      comment: "Clarify clause 2.",
    },
    "approval",
  );
  data = applyCommand(
    data,
    {
      type: "version",
      id: "r2",
      fileName: "revised.txt",
      text: "Revised clause 2",
    },
    "chair",
  );
  data = applyCommand(
    data,
    { type: "document", id: "r2", status: "Submitted" },
    "chair",
  );
  data = applyCommand(
    data,
    { type: "document", id: "r2", status: "Approved" },
    "approval",
  );
  data = applyCommand(
    data,
    { type: "document", id: "r2", status: "Printed" },
    "logistics",
  );
  assert.equal(data.documents.find((r) => r.id === "r2")?.versionIds.length, 2);
  assert.equal(
    data.documents.find((r) => r.id === "r2")?.comments[0].text,
    "Clarify clause 2.",
  );
  assert.throws(
    () =>
      applyCommand(
        data,
        { type: "document", id: "r2", status: "In Debate" },
        "chair",
      ),
    /Close the current/,
  );
});
test("session and committee foreign-key boundaries are enforced", () => {
  const data = createSeed();
  assert.throws(
    () =>
      applyCommand(
        data,
        rollCall("ecosoc", { d0: "Present" }),
        "chair",
      ),
    /delegate of this committee/,
  );
  assert.throws(
    () =>
      applyCommand(
        data,
        {
          type: "participation",
          delegateId: "d0",
          committeeId:"ga1",
          resolutionId: "r3",
          categoryId: "speech",
          points: 2,
        },
        "chair",
      ),
    /outside/,
  );
  assert.throws(
    () =>
      applyCommand(
        data,
        { type: "queue", delegateId: "d10", committeeId:"ga1" },
        "chair",
      ),
    /present/,
  );
});
test("the speaker timer is not part of conference state: queue advance and speech transitions write no timer", () => {
  let data = createSeed();
  assert.equal(data.timers, undefined, "the seed carries no stored timers");
  data = applyCommand(data, { type: "queue", committeeId:"ga1", advance: true }, "chair");
  assert.equal(data.timers, undefined, "advancing the queue no longer resets a stored timer");
});
test("committee scoring overrides do not change other committees", () => {
  let data = createSeed();
  data = applyCommand(
    data,
    { type: "scoring", id: "speech", committeeId: "ga1", values: [1, 4] },
    "admin",
  );
  assert.deepEqual(
    data.scoring.find((s) => s.id === "speech")?.values,
    [1, 2, 3],
  );
  data = applyCommand(
    data,
    {
      type: "participation",
      delegateId: "d0",
      committeeId:"ga1",
      resolutionId: "r1",
      categoryId: "speech",
      points: 4,
    },
    "chair",
  );
  data = applyCommand(
    data,
    { type: "event", id: data.events.at(-1)!.id, points: 4 },
    "chair",
  );
  assert.equal(data.events.at(-1)?.points, 4);
});
test("CSV handles quoted cells, duplicate validation, and atomic rejection", () => {
  const rows = parseCSV(
    'Name,Country,Email\r\n"Doe, Jane",Italy,jane@example.com\r\nJane,Italy,jane@example.com',
  );
  assert.equal(rows[1][0], "Doe, Jane");
  const checked = validateImport(
    rows.slice(1),
    { name: 0, country: 1, email: 2 },
    [],
  );
  assert.deepEqual(checked[1].errors, ["Duplicate email"]);
  const data = createSeed();
  assert.throws(
    () =>
      applyCommand(
        data,
        {
          type: "import",
          rows: checked.map((r) => ({
            name: r.name,
            email: r.email,
            country: r.country,
            schoolId: "school0",
            committeeId: "ga1",
          })),
        },
        "admin",
      ),
    /duplicate/,
  );
  assert.equal(data.delegates.length, createSeed().delegates.length);
});
