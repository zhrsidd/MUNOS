/**
 * Next resolution number for a committee: `GA1 / 03`. Mirrors private.next_resolution_code (migration
 * 20261021140000), which both a Chair-created draft and a public submission use in hosted mode.
 *
 * Highest existing sequential number in the committee + 1, at least two digits. "Sequential" is a code ending in ` / `
 * and 2-6 digits; the old Chair draft codes (` / ca7640bb`, always 8 characters) never match, so they are ignored and
 * never renumbered. Skips forward over any code already used in the conference.
 */
export function nextResolutionCode(
  committeeCode: string,
  committeeDocuments: readonly { code?: string | null }[],
  conferenceCodes: ReadonlySet<string> = new Set(),
): string {
  let n = 1;
  for (const { code } of committeeDocuments) {
    const match = /^.* \/ ([0-9]{2,6})$/.exec(code ?? "");
    if (match) n = Math.max(n, Number(match[1]) + 1);
  }
  while (conferenceCodes.has(`${committeeCode} / ${String(n).padStart(2, "0")}`)) n += 1;
  return `${committeeCode} / ${String(n).padStart(2, "0")}`;
}
