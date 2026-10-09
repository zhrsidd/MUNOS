// DRY-RUN Google Drive folder plan. Pure: no Google API calls, no credentials, no database.
// It defines the folder layout and the STABLE KEYS a future Drive integration would map to
// Drive folder ids (see docs/GOOGLE_DRIVE_ARCHITECTURE.md). Nothing in the app imports this yet.

export interface DriveFolder {
  /** Stable logical key. The future integration stores key → Drive folder id; names may change. */
  key: string;
  name: string;
  purpose: string;
  children: DriveFolder[];
}
export interface PlanCommittee {
  code: string;
  name?: string;
}
export const COMMITTEE_FOLDERS = [
  { slug: "approval", name: "1 Approval Copies", purpose: "Conference-owned copy of each resolution the Approval Panel reviews (one per resolution)." },
  { slug: "snapshots", name: "2 PDF Snapshots", purpose: "PDFs of the approved/printed and final versions." },
  { slug: "exports", name: "3 Exports", purpose: "Generated, read-only exports from Conference OS (roll call, votes, resolution status)." },
] as const;

/** Drive allows most characters, but "/" confuses people and some sync clients; keep names plain. */
export function safeFolderName(name: string) {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
}
export function normalizeCode(code: string) {
  return safeFolderName(code).toUpperCase();
}
/** Validates committee input: non-empty, unique codes (case-insensitive). */
export function validateCommittees(committees: PlanCommittee[]) {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [i, c] of committees.entries()) {
    const code = normalizeCode(c.code ?? "");
    if (!code) errors.push(`Committee ${i + 1} has no code.`);
    else if (!/^[A-Z0-9][A-Z0-9 &-]{0,23}$/.test(code)) errors.push(`Committee code "${c.code}" should be short letters/numbers (e.g. GA1, WHO).`);
    else if (seen.has(code)) errors.push(`Committee code ${code} appears twice.`);
    seen.add(code);
  }
  return errors;
}
export function planDrive(conference: string, committees: PlanCommittee[]): DriveFolder {
  const root = safeFolderName(conference);
  if (!root) throw Error("Conference name is required.");
  const errors = validateCommittees(committees);
  if (errors.length) throw Error(errors.join(" "));
  const committee = (c: PlanCommittee): DriveFolder => {
    const code = normalizeCode(c.code);
    const name = c.name?.trim() ? `${code} — ${safeFolderName(c.name)}` : code;
    return {
      key: `committee:${code}`,
      name,
      purpose: `Everything for ${code}.`,
      children: COMMITTEE_FOLDERS.map((f) => ({ key: `committee:${code}:${f.slug}`, name: f.name, purpose: f.purpose, children: [] })),
    };
  };
  return {
    key: "conference",
    name: root,
    purpose: "Shared Drive root owned by the conference (not a personal account).",
    children: [
      { key: "committees", name: "Committees", purpose: "One folder per committee.", children: committees.map(committee) },
      { key: "conference-wide", name: "Conference-wide", purpose: "Generated conference-wide exports: schedule, schools, group photos, final results.", children: [] },
      { key: "system-backups", name: "System Backups", purpose: "Restricted: database exports for disaster recovery (Executive + technical contact only).", children: [] },
    ],
  };
}
export function renderTree(folder: DriveFolder, withPurpose = false): string {
  const lines = [folder.name + (withPurpose ? `   (${folder.purpose})` : "")];
  const walk = (children: DriveFolder[], prefix: string) =>
    children.forEach((child, i) => {
      const last = i === children.length - 1;
      lines.push(`${prefix}${last ? "└── " : "├── "}${child.name}${withPurpose && child.children.length === 0 ? `   — ${child.purpose}` : ""}`);
      walk(child.children, prefix + (last ? "    " : "│   "));
    });
  walk(folder.children, "");
  return lines.join("\n");
}
export function flatten(folder: DriveFolder, parentKey: string | null = null): { key: string; parentKey: string | null; name: string }[] {
  return [{ key: folder.key, parentKey, name: folder.name }, ...folder.children.flatMap((c) => flatten(c, folder.key))];
}
/** Parses "GA1, WHO" or lines of "GA1 | General Assembly" / "GA1,General Assembly". */
export function parseCommitteeList(text: string): PlanCommittee[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length === 1 && !lines[0].includes("|") && lines[0].split(",").every((p) => p.trim().split(/\s+/).length === 1))
    return lines[0].split(",").map((code) => ({ code: code.trim() })).filter((c) => c.code);
  return lines.map((l) => {
    const [code, ...rest] = l.split(/\s*[|,;\t]\s*/);
    return { code: code.trim(), name: rest.join(" ").trim() || undefined };
  });
}
