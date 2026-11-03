import { countryFlag } from "./countries";
export function parseCSV(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("Unclosed quote in CSV.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
type ImportCommittee = { id: string; code: string; name: string; archived?: boolean };
const key = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
/** Matches a CSV committee cell to an active committee by code ("GA1") or name ("Security Council"), ignoring case. */
export function matchCommittee(value: string, committees: ImportCommittee[]): ImportCommittee | undefined {
  const k = key(value);
  if (!k) return undefined;
  const active = committees.filter((c) => !c.archived);
  return active.find((c) => key(c.code) === k) ?? active.find((c) => key(c.name) === k);
}
/**
 * Validates mapped CSV rows. `mapping.committee` may be -1 (no committee column): then every row gets
 * `committeeId`. With a committee column, each row's committee is matched from its own cell.
 */
export function validateImport(
  rows: string[][],
  mapping: Record<string, number>,
  existingEmails: string[],
  committee: { committees: ImportCommittee[]; committeeId?: string } = { committees: [] },
) {
  const seen = new Set(existingEmails.map((e) => e.toLowerCase()));
  const cell = (row: string[], field: string) => ((mapping[field] ?? -1) >= 0 ? row[mapping[field]] || "" : "");
  const byColumn = (mapping.committee ?? -1) >= 0;
  return rows.map((row, i) => {
    const name = cell(row, "name"),
      country = cell(row, "country"),
      email = cell(row, "email"),
      committeeText = cell(row, "committee");
    const errors: string[] = [];
    if (!name) errors.push("Name is required");
    if (!country) errors.push("Country is required");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      errors.push("Valid email required");
    if (seen.has(email.toLowerCase())) errors.push("Duplicate email");
    seen.add(email.toLowerCase());
    let committeeId = committee.committeeId ?? "";
    if (byColumn) {
      const match = matchCommittee(committeeText, committee.committees);
      committeeId = match?.id ?? "";
      if (!committeeText) errors.push("Committee is required");
      else if (!match) errors.push(`Unknown committee "${committeeText}"`);
    }
    // The flag is derived from the country text; staff never type an emoji.
    return { line: i + 2, name, country, flag: countryFlag(country), email, committeeId, errors };
  });
}
