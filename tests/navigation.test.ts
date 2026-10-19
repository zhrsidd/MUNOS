import test from "node:test";
import assert from "node:assert/strict";
import { activeEntry, destinationSlugs, navigationFor } from "../lib/navigation";

// Kept destinations stay reachable. Retired Award discussion routes redirect to useful records.
const PREVIOUS: Record<string, string[]> = {
  chair: ["", "roll-call", "participation", "documents", "amendments", "voting", "photos", "health"],
  approval: ["", "health"],
  logistics: ["", "health"],
  admin: ["", "conference", "committees", "sessions", "delegates", "schools", "photos", "staff", "access-codes", "scoring", "workflow", "submissions", "amendment-links", "audit", "health"],
};
test("every previous route keeps a home in the destination map", () => {
  for (const [role, slugs] of Object.entries(PREVIOUS)) for (const slug of slugs) assert.ok(destinationSlugs(role as never).includes(slug), `${role}/${slug}`);
});
test("no role has a destination twice, and each shows at most seven top-level entries", () => {
  for (const role of ["chair", "approval", "logistics", "admin"] as const) {
    const slugs = destinationSlugs(role);
    assert.equal(new Set(slugs).size, slugs.length, role);
    assert.ok(navigationFor(role).length <= 7, role);
  }
});
test("Chair live actions stay direct links; setup lives in menus", () => {
  const direct = navigationFor("chair").filter((i) => i.slug !== undefined).map((i) => i.slug);
  for (const slug of ["", "roll-call", "documents", "amendments", "participation", "voting"]) assert.ok(direct.includes(slug), slug);
});
test("a section inside a menu activates its parent entry", () => {
  assert.equal(activeEntry(navigationFor("admin"), "access-codes")?.label, "People");
  assert.equal(activeEntry(navigationFor("chair"), "health")?.label, "More");
  assert.equal(activeEntry(navigationFor("approval"), "history")?.label, "History");
  assert.equal(activeEntry(navigationFor("admin"), "nowhere"), undefined);
});

test("retired Award discussion has no navigation destination", () => {
  for (const role of ["chair", "admin"] as const) assert.ok(!destinationSlugs(role).includes("awards"));
});

test("old Award discussion bookmarks redirect without rendering retired controls", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url), cssLoader = require.extensions[".css"];
  require.extensions[".css"] = module => { module.exports = {}; };
  const { default: Page, generateStaticParams } = await import("../app/[[...route]]/page");
  if (cssLoader) require.extensions[".css"] = cssLoader; else delete require.extensions[".css"];
  assert.ok(!generateStaticParams().some(p => p.route.includes("awards")));
  const config = (await import("../next.config")).default;
  const redirects = await config.redirects!();
  for (const [role, destination] of [["chair", "/chair/participation"], ["admin", "/admin/scoring"]]) {
    assert.ok(redirects.some(rule => rule.source === `/${role}/awards` && rule.destination === destination && rule.permanent === false));
    await assert.rejects(Page({ params: Promise.resolve({ route: [role, "awards"] }) }), error => {
      return typeof error === "object" && error !== null && "digest" in error && String(error.digest).includes("404");
    });
  }
});
