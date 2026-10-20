import test from "node:test";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { createSeed } from "../lib/seed";
import { resolutionOverview, resolutionProgress } from "../lib/resolution-overview";
import { activeEntry, destinationSlugs, navigationFor } from "../lib/navigation";

test("Executive overview includes every committee, empty/archived groups, submitter and outcome, without changing state", () => {
  const data = createSeed();
  data.committees.at(-1)!.archived = true;
  data.documents[0].outcome = "Passed";
  const before = JSON.stringify(data);
  const groups = resolutionOverview(data);
  assert.equal(groups.length, data.committees.length);
  assert.ok(groups.some(g => g.committee.archived && !g.resolutions.length));
  assert.equal(groups.flatMap(g => g.resolutions).length, data.documents.length);
  assert.equal(groups.flatMap(g => g.resolutions).find(r => r.resolution.id === data.documents[0].id)!.submitter, data.delegates.find(d => d.id === data.documents[0].submitterId)!.country);
  assert.equal(JSON.stringify(data), before);
});
test("status progress covers every stage; feedback-backed Draft is changes requested, with local filters", () => {
  const data = createSeed();
  const r = data.documents[0];
  r.status = "Draft";
  r.comments = [{ id: "comment", text: "Funding needed", authorId: "reviewer", createdAt: "2026-10-19" }];
  assert.equal(resolutionOverview(data, r.committeeId, "changes requested")[0].resolutions[0].status, "Changes requested");
  assert.equal(resolutionOverview(data, "", "no such resolution").length, 0);
  assert.ok(resolutionOverview(data, r.committeeId, r.code)[0].resolutions.some(x => x.resolution.id === r.id));
  assert.deepEqual(["Draft", "Submitted", "Review", "Approved", "Printed", "In Debate", "Closed"].map(s => resolutionProgress(s as typeof r.status).printing), ["Not ready", "Not ready", "Not ready", "Awaiting print", "Printed", "Printed", "Printed"]);
});
test("resolution status is reachable through Executive Operations without adding another top-level tab", async () => {
  assert.ok(destinationSlugs("admin").includes("resolution-status"));
  assert.equal(activeEntry(navigationFor("admin"), "resolution-status")?.label, "Operations");
  assert.equal(navigationFor("admin").length, 5);
  assert.ok(!destinationSlugs("chair").includes("resolution-status"));
  const require = createRequire(import.meta.url), previous = require.extensions[".css"];
  require.extensions[".css"] = module => { module.exports = {}; };
  const { generateStaticParams } = await import("../app/[[...route]]/page");
  if (previous) require.extensions[".css"] = previous; else delete require.extensions[".css"];
  assert.ok(generateStaticParams().some(p => p.route.join("/") === "admin/resolution-status"));
});
