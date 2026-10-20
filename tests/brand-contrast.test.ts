import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Measures the tokens the application actually ships (app/globals.css :root), not a copy.
const css = readFileSync("app/globals.css", "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b`).exec(root);
  assert.ok(m, `token --${name} is a hex colour`);
  const h = m![1];
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h);
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const TEXT: [string, string][] = [
  ["ink", "surface"], ["ink", "paper"], ["ink-2", "surface"], ["ink-2", "paper"], ["ink-3", "paper"], ["ink-3", "surface"], ["ink-3", "sunken"],
  ["action", "surface"], ["action", "action-soft"], ["attention", "attention-soft"], ["success", "success-soft"], ["danger", "danger-soft"], ["ink-2", "sunken"],
];
test("text pairs meet 4.5:1", () => {
  for (const [fg, bg] of TEXT) assert.ok(ratio(token(fg), token(bg)) >= 4.5, `${fg} on ${bg} = ${ratio(token(fg), token(bg)).toFixed(2)}`);
});
test("white on action and action-hover meets 4.5:1", () => {
  for (const bg of ["action", "action-hover"]) assert.ok(ratio("#ffffff", token(bg)) >= 4.5, bg);
});
test("control outline meets 3:1 on every surface a control sits on", () => {
  for (const bg of ["surface", "paper", "sunken"]) assert.ok(ratio(token("control"), token(bg)) >= 3, `control on ${bg} = ${ratio(token("control"), token(bg)).toFixed(2)}`);
});
test("focus ring is visible on paper and surface; brand blue is not used as small text", () => {
  for (const bg of ["surface", "paper"]) assert.ok(ratio(token("focus"), token(bg)) >= 3, bg);
  assert.ok(ratio(token("brand"), token("surface")) < 4.5, "brand blue stays an identity colour (3.2:1), never body text");
});
test("white on the navy context band meets 4.5:1", () => {
  assert.ok(ratio("#ffffff", token("ink")) >= 4.5);
  assert.ok(ratio("#d3dcec", token("ink")) >= 4.5, "secondary band text");
});
