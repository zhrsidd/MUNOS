import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  participationSummary,
  suggestedDelegates,
} from "../lib/repository";
import { createSeed } from "../lib/seed";
import { parseCSV, validateImport } from "../lib/import";

test("roll call remains exclusive and removes an ineligible vote and queued speaker", () => {
  let data = createSeed();
  data = applyCommand(
    data,
    {
      type: "vote",
      delegateId: "d1",
      sessionId: "s1",
      resolutionId: "r1",
      choice: "Abstain",
    },
    "chair",
  );
  data = applyCommand(
    data,
    {
      type: "attendance",
      delegateId: "d1",
      sessionId: "s1",
      status: "Present & Voting",
    },
    "chair",
  );
  assert.equal(data.votes.length, 0);
  assert.equal(
    data.attendance.filter((a) => a.delegateId === "d1" && a.sessionId === "s1")
      .length,
    1,
  );
  assert.throws(
    () =>
      applyCommand(
        data,
        {
          type: "vote",
          delegateId: "d1",
          sessionId: "s1",
          resolutionId: "r1",
          choice: "Abstain",
        },
        "chair",
      ),
    /Attendance/,
  );
  data = applyCommand(
    data,
    { type: "attendance", delegateId: "d1", sessionId: "s1", status: "Absent" },
    "chair",
  );
  assert.equal(
    data.queue.some((q) => q.delegateId === "d1"),
    false,
  );
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
      sessionId: "s1",
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
  const list = suggestedDelegates(data, "s1");
  assert.equal(participationSummary(data, list[0].id).opportunities, 0);
  assert.equal(
    list.some((d) => ["d0", "d1", "d2", "d10"].includes(d.id)),
    false,
  );
  const reordered = structuredClone(data);
  reordered.events.forEach((e) => (e.points = 999));
  assert.deepEqual(
    suggestedDelegates(reordered, "s1").map((d) => d.id),
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
        {
          type: "attendance",
          delegateId: "d0",
          sessionId: "s2",
          status: "Present",
        },
        "chair",
      ),
    /outside/,
  );
  assert.throws(
    () =>
      applyCommand(
        data,
        {
          type: "participation",
          delegateId: "d0",
          sessionId: "s1",
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
        { type: "queue", delegateId: "d10", sessionId: "s1" },
        "chair",
      ),
    /present/,
  );
});
test("timers persist transitions per session and advancing resets only that session", () => {
  let data = createSeed();
  data = applyCommand(
    data,
    {
      type: "timer",
      sessionId: "s1",
      duration: 120,
      remaining: 80,
      startedAt: 123,
    },
    "chair",
  );
  data = applyCommand(
    data,
    {
      type: "timer",
      sessionId: "s2",
      duration: 60,
      remaining: 60,
      startedAt: null,
    },
    "chair",
  );
  data = applyCommand(
    data,
    { type: "queue", sessionId: "s1", advance: true },
    "chair",
  );
  assert.deepEqual(data.timers.s1, {
    revision: 2,
    duration: 120,
    remaining: 120,
    startedAt: null,
  });
  assert.equal(data.timers.s2.duration, 60);
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
      sessionId: "s1",
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
