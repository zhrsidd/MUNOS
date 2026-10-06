import type { ConferenceData } from "../domain";
import { addDays, CONFERENCE_TIMEZONE, zonedToUtc } from "./time";
// Schedule import: paste/upload → parse → preview → validate → confirm → create.
// Structured text only (CSV, Excel/Sheets copy-paste as tab-separated). No PDF guessing.

export type DateOrder = "DMY" | "MDY";
export interface DraftRow {
  key: string;
  line: number;
  include: boolean;
  /** YYYY-MM-DD, or "" when it could not be read. */
  date: string;
  name: string;
  start: string; // HH:MM
  end: string; // HH:MM or ""
  /** Committee text as written ("All", "GA1, WHO"); "" = use the default selection. */
  committees: string;
  /** Lunch, ceremonies and breaks are listed but not imported unless explicitly selected. */
  nonCommittee: boolean;
  raw: string;
  parseErrors: string[];
}
export interface ReviewedRow extends DraftRow {
  committeeIds: string[];
  unknownCommittees: string[];
  errors: string[];
  /** Committees that already have this session (or appear twice in this import). */
  duplicateCommitteeIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  /** Sessions this row will create (0 when excluded/invalid/all duplicates). */
  creates: number;
}
export interface ScheduleSession { committeeId: string; name: string; startsAt: string; endsAt: string | null }
export const MAX_IMPORT_SESSIONS = 500;

const NON_COMMITTEE = /\b(lunch|break|coffee|tea|ceremon(y|ies)|registration|prayers?|dinner|breakfast|social|photos?|keynote|transit|arrival|departure|check[- ]?in|dismissal)\b/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HEADERS: Record<"date" | "name" | "start" | "end" | "time" | "committees", RegExp> = {
  date: /^(date|day|day\/date|date\/day)$/,
  name: /^(session|session name|name|event|item|activity|title|programme|program)$/,
  start: /^(start|start time|from|begins?|starts?)$/,
  end: /^(end|end time|to|until|finish|ends?)$/,
  time: /^(time|times|slot|time slot)$/,
  committees: /^(committees?|applies to|bodies|for|rooms?|forums?)$/,
};
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** Splits pasted text into cells. Tab-separated (spreadsheet copy), semicolon or comma CSV with quotes. */
export function parseTable(text: string): string[][] {
  const lines = text.replace(/^﻿/, "");
  const first = lines.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const delimiter = first.includes("\t") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i];
    if (c === '"' && (quoted || cell.trim() === "")) {
      if (quoted && lines[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (c === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && lines[i + 1] === "\n") i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("A quotation mark is not closed. Check the pasted text.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
/** "13:30", "1:30 pm", "9.00", "0900", "9am" → "HH:MM" (24 h), else null. */
export function parseTime(input: string): string | null {
  const m = input.trim().toLowerCase().replace(/\s+/g, "").match(/^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const meridiem = m[3]?.[0];
  if (!m[2] && !meridiem && m[1].length < 3) return null; // a bare "9" is too ambiguous
  if (meridiem) { if (h < 1 || h > 12) return null; h = (h % 12) + (meridiem === "p" ? 12 : 0); }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
function splitRange(input: string): [string, string] | null {
  const parts = input.split(/\s*(?:-|–|—|\bto\b|\buntil\b)\s*/i).filter(Boolean);
  return parts.length === 2 ? [parts[0], parts[1]] : null;
}
/** Reads ISO, D/M/Y (or M/D/Y), "Day 2", weekday names and "12 Nov [2026]" forms. */
export function parseDate(input: string, conferenceStart: string, order: DateOrder = "DMY"): string | null {
  const s = input.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return null;
  const valid = (y: number, m: number, d: number) => {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso) ? iso : null;
  };
  const baseYear = +conferenceStart.slice(0, 4);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : baseYear;
    return order === "DMY" ? valid(y, +m[2], +m[1]) : valid(y, +m[1], +m[2]);
  }
  m = s.match(/^(?:day|d)\s*(\d{1,2})\b/);
  if (m && +m[1] >= 1 && +m[1] <= 14) return addDays(conferenceStart, +m[1] - 1);
  const words = s.split(" ").filter((w) => !WEEKDAYS.some((d) => w.startsWith(d)) || /\d/.test(w));
  const monthIndex = words.findIndex((w) => MONTHS.some((mo) => w.startsWith(mo)));
  if (monthIndex >= 0) {
    const month = MONTHS.findIndex((mo) => words[monthIndex].startsWith(mo)) + 1;
    const numbers = words.filter((w) => /^\d+$/.test(w)).map(Number);
    const day = numbers.find((n) => n >= 1 && n <= 31);
    const year = numbers.find((n) => n >= 2000) ?? baseYear;
    return day ? valid(year, month, day) : null;
  }
  const weekday = WEEKDAYS.findIndex((d) => s.startsWith(d));
  if (weekday >= 0 && s.split(" ").length === 1) {
    for (let i = 0; i < 7; i++) {
      const date = addDays(conferenceStart, i);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === weekday) return date;
    }
  }
  return null;
}
/** Parse pasted/uploaded schedule text into editable draft rows. */
export function parseSchedule(text: string, conferenceStart: string, order: DateOrder = "DMY"): DraftRow[] {
  const table = parseTable(text);
  if (!table.length) return [];
  const header = table[0].map(norm);
  const find = (key: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[key].test(h));
  const hasHeader = (["date", "name", "start", "time"] as const).some((k) => find(k) >= 0);
  const col = hasHeader
    ? { date: find("date"), name: find("name"), start: find("start"), end: find("end"), time: find("time"), committees: find("committees") }
    : { date: 0, name: 1, start: 2, end: 3, time: -1, committees: 4 };
  const body = hasHeader ? table.slice(1) : table;
  let currentDate = "";
  const rows: DraftRow[] = [];
  body.forEach((cells, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const at = (c: number) => (c >= 0 ? cells[c] ?? "" : "");
    let startText = at(col.start) || at(col.time), endText = at(col.end);
    const range = endText ? null : splitRange(startText); // "09:00–10:30" in one cell
    if (range) [startText, endText] = range;
    const dateText = at(col.date);
    const name = at(col.name).replace(/\s+/g, " ");
    // A row with a date but no time and no name is a day heading ("Day 2 — Friday 13 November").
    if (dateText && !startText && !name) { currentDate = parseDate(dateText, conferenceStart, order) ?? currentDate; return; }
    if (!name && !startText && cells.length === 1) { const heading = parseDate(cells[0], conferenceStart, order); if (heading) { currentDate = heading; return; } }
    const parseErrors: string[] = [];
    let date = currentDate;
    if (dateText) {
      const parsed = parseDate(dateText, conferenceStart, order);
      if (parsed) date = currentDate = parsed; else { date = ""; parseErrors.push(`Date not understood: “${dateText}”`); }
    }
    const start = startText ? parseTime(startText) : null;
    const end = endText ? parseTime(endText) : null;
    if (startText && !start) parseErrors.push(`Start time not understood: “${startText}”`);
    if (endText && !end) parseErrors.push(`End time not understood: “${endText}”`);
    const nonCommittee = NON_COMMITTEE.test(name);
    rows.push({ key: `r${line}`, line, include: !nonCommittee, date, name, start: start ?? "", end: end ?? "", committees: at(col.committees), nonCommittee, raw: cells.join(" | "), parseErrors });
  });
  return rows;
}
/** Resolve a committee cell against configured committees by code or name. */
export function matchCommittees(text: string, data: ConferenceData): { ids: string[]; unknown: string[]; all: boolean } {
  const t = text.trim();
  if (!t) return { ids: [], unknown: [], all: false };
  if (/^(all|all committees|everyone|every committee|\*)$/i.test(t)) return { ids: data.committees.map((c) => c.id), unknown: [], all: true };
  const ids: string[] = [], unknown: string[] = [];
  for (const token of t.split(/\s*(?:,|;|\/|\+|&|\band\b)\s*/i).filter(Boolean)) {
    const n = norm(token);
    const committee = data.committees.find((c) => norm(c.code) === n || norm(c.name) === n || norm(`${c.code} ${c.name}`) === n);
    if (committee) { if (!ids.includes(committee.id)) ids.push(committee.id); } else unknown.push(token);
  }
  return { ids, unknown, all: false };
}
/** Validate drafts against the conference: committees, times, duplicates (existing and within the import). */
export function reviewSchedule(drafts: DraftRow[], data: ConferenceData, defaultCommitteeIds: string[], timeZone = CONFERENCE_TIMEZONE) {
  const existing = new Set(data.sessions.map((s) => `${s.committeeId}|${Date.parse(s.startsAt)}`));
  const existingByName = new Set(data.sessions.map((s) => `${s.committeeId}|${norm(s.name)}|${s.startsAt.slice(0, 10)}`));
  const seen = new Set<string>();
  const sessions: ScheduleSession[] = [];
  const rows: ReviewedRow[] = drafts.map((d) => {
    const errors = [...d.parseErrors];
    const match = d.committees ? matchCommittees(d.committees, data) : { ids: defaultCommitteeIds, unknown: [], all: false };
    if (match.unknown.length) errors.push(`Unknown committee${match.unknown.length > 1 ? "s" : ""}: ${match.unknown.join(", ")}`);
    if (!d.name.trim()) errors.push("Session name is missing");
    if (d.name.trim().length > 120) errors.push("Session name is longer than 120 characters");
    if (!d.date) errors.push(errors.some((e) => e.startsWith("Date")) ? "" : "Date is missing");
    if (!d.start) errors.push(errors.some((e) => e.startsWith("Start")) ? "" : "Start time is missing");
    if (d.start && d.end && d.end <= d.start) errors.push("End time is before the start time");
    if (!match.ids.length && !match.unknown.length) errors.push("Choose at least one committee");
    const clean = errors.filter(Boolean);
    const startsAt = d.date && d.start ? zonedToUtc(d.date, d.start, timeZone) : null;
    const endsAt = d.date && d.end ? zonedToUtc(d.date, d.end, timeZone) : null;
    const duplicateCommitteeIds: string[] = [];
    let creates = 0;
    if (d.include && !clean.length && startsAt) {
      for (const committeeId of match.ids) {
        const key = `${committeeId}|${Date.parse(startsAt)}`;
        if (existing.has(key) || seen.has(key) || existingByName.has(`${committeeId}|${norm(d.name)}|${startsAt.slice(0, 10)}`)) { duplicateCommitteeIds.push(committeeId); continue; }
        seen.add(key);
        sessions.push({ committeeId, name: d.name.trim(), startsAt, endsAt });
        creates++;
      }
    }
    return { ...d, committeeIds: match.ids, unknownCommittees: match.unknown, errors: clean, duplicateCommitteeIds, startsAt, endsAt, creates };
  });
  const included = rows.filter((r) => r.include);
  return {
    rows,
    sessions,
    summary: {
      create: sessions.length,
      committees: new Set(sessions.map((s) => s.committeeId)).size,
      duplicates: rows.reduce((n, r) => n + r.duplicateCommitteeIds.length, 0),
      invalid: included.filter((r) => r.errors.length).length,
      skipped: rows.length - included.length,
      tooMany: sessions.length > MAX_IMPORT_SESSIONS,
    },
  };
}
