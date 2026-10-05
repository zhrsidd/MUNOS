import type { ConferenceData, School } from "../domain";
import type { PhotoSlotFields } from "./commands";
import { parseDate, parseTable, parseTime, type DateOrder } from "./schedule-import";
import { CONFERENCE_TIMEZONE, zonedToUtc } from "./time";
// Photo-slot CSV: school,date,start_time,end_time,location[,note]
// Schools are matched to existing records only. Exact (normalized) matches are accepted; near misses
// are SUGGESTED and must be confirmed; anything else is unresolved. Schools are never created here.

/** Case, accents, punctuation, "&"/"and" and repeated spaces are ignored. */
export function normalizeSchool(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
export function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}
export type SchoolMatch = { kind: "exact"; school: School } | { kind: "suggested"; suggestions: School[] } | { kind: "unresolved" };
export function matchSchool(input: string, schools: School[]): SchoolMatch {
  const n = normalizeSchool(input);
  if (!n) return { kind: "unresolved" };
  const exact = schools.filter((s) => normalizeSchool(s.name) === n);
  if (exact.length === 1) return { kind: "exact", school: exact[0] };
  if (exact.length > 1) return { kind: "suggested", suggestions: exact }; // two schools normalize the same: ask
  const near = schools
    .map((s) => ({ s, d: editDistance(n, normalizeSchool(s.name)) }))
    .filter(({ s, d }) => d <= Math.max(1, Math.floor(normalizeSchool(s.name).length * 0.2)))
    .sort((a, b) => a.d - b.d)
    .map(({ s }) => s);
  return near.length ? { kind: "suggested", suggestions: near } : { kind: "unresolved" };
}
export interface PhotoDraft {
  key: string;
  line: number;
  include: boolean;
  schoolText: string;
  match: SchoolMatch;
  /** Explicit choice by the Executive (required for suggested/unresolved rows). */
  schoolId: string;
  date: string;
  start: string;
  end: string;
  location: string;
  note: string;
  parseErrors: string[];
}
const HEAD = { school: /^school( name)?$/, date: /^(date|day)$/, start: /^(start|start time|start_time|time|from)$/, end: /^(end|end time|end_time|to|until)$/, location: /^(location|place|venue|where)$/, note: /^(note|notes|comment)$/ };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z_ ]+/g, "").trim();
export function parsePhotoSchedule(text: string, data: ConferenceData, order: DateOrder = "DMY"): PhotoDraft[] {
  const table = parseTable(text);
  if (!table.length) return [];
  const header = table[0].map(norm);
  const find = (k: keyof typeof HEAD) => header.findIndex((h) => HEAD[k].test(h));
  const hasHeader = find("school") >= 0;
  const col = hasHeader ? { school: find("school"), date: find("date"), start: find("start"), end: find("end"), location: find("location"), note: find("note") } : { school: 0, date: 1, start: 2, end: 3, location: 4, note: 5 };
  return (hasHeader ? table.slice(1) : table).map((cells, i) => {
    const at = (c: number) => (c >= 0 ? cells[c] ?? "" : "");
    const line = i + (hasHeader ? 2 : 1);
    const parseErrors: string[] = [];
    const date = parseDate(at(col.date), data.conference.date, order);
    if (!date) parseErrors.push(at(col.date) ? `Date not understood: “${at(col.date)}”` : "Date is missing");
    const start = parseTime(at(col.start));
    if (!start) parseErrors.push(at(col.start) ? `Start time not understood: “${at(col.start)}”` : "Start time is missing");
    const end = at(col.end) ? parseTime(at(col.end)) : null;
    if (at(col.end) && !end) parseErrors.push(`End time not understood: “${at(col.end)}”`);
    const match = matchSchool(at(col.school), data.schools);
    return { key: `p${line}`, line, include: true, schoolText: at(col.school), match, schoolId: match.kind === "exact" ? match.school.id : "", date: date ?? "", start: start ?? "", end: end ?? "", location: at(col.location).trim(), note: at(col.note).trim(), parseErrors };
  });
}
export function reviewPhotoSchedule(drafts: PhotoDraft[], data: ConferenceData, timeZone = CONFERENCE_TIMEZONE) {
  const existing = new Set((data.photoSlots ?? []).map((s) => `${s.schoolId}|${Date.parse(s.startsAt)}`));
  const seen = new Set<string>();
  const slots: PhotoSlotFields[] = [];
  const rows = drafts.map((d) => {
    const errors = [...d.parseErrors];
    if (!d.schoolId) errors.push(d.match.kind === "suggested" ? "Confirm the school" : `School not found: “${d.schoolText || "blank"}”`);
    if (!d.location) errors.push("Location is missing");
    if (d.start && d.end && d.end <= d.start) errors.push("End time is before the start time");
    const startsAt = d.date && d.start ? zonedToUtc(d.date, d.start, timeZone) : null;
    let duplicate = false;
    if (d.include && !errors.length && startsAt) {
      const key = `${d.schoolId}|${Date.parse(startsAt)}`;
      duplicate = existing.has(key) || seen.has(key);
      if (!duplicate) {
        seen.add(key);
        slots.push({ schoolId: d.schoolId, startsAt, endsAt: d.end ? zonedToUtc(d.date, d.end, timeZone) : null, location: d.location, note: d.note });
      }
    }
    const delegates = data.delegates.filter((x) => x.schoolId === d.schoolId).length;
    return { ...d, errors, duplicate, startsAt, delegates };
  });
  return { rows, slots, summary: { create: slots.length, invalid: rows.filter((r) => r.include && r.errors.length).length, duplicates: rows.filter((r) => r.duplicate).length, skipped: rows.filter((r) => !r.include).length } };
}
