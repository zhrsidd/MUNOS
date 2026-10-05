// Conference wall-clock time. Schedules and photo slots are written in the venue's local time;
// they are stored as absolute instants and always displayed in the conference time zone,
// whatever time zone a device is set to. Reminders compare absolute instants only.
export const CONFERENCE_TIMEZONE = process.env.NEXT_PUBLIC_CONFERENCE_TIMEZONE || "Asia/Qatar";
const parts = (instant: number, timeZone: string) => {
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant))
    map[p.type] = p.value;
  return map;
};
/** Offset (ms) of a zone from UTC at a given instant. */
function offset(instant: number, timeZone: string) {
  const p = parts(instant, timeZone);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(instant / 1000) * 1000;
}
/** "2026-11-12" + "13:30" in the conference zone → ISO instant. Handles DST transitions. */
export function zonedToUtc(date: string, time: string, timeZone = CONFERENCE_TIMEZONE): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - offset(wall, timeZone);
  guess = wall - offset(guess, timeZone);
  return new Date(guess).toISOString();
}
/** ISO instant → "YYYY-MM-DD" in the conference zone. */
export function zonedDate(iso: string, timeZone = CONFERENCE_TIMEZONE) {
  const p = parts(Date.parse(iso), timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}
/** ISO instant → "HH:MM" (24 h) in the conference zone. */
export function zonedTime(iso: string, timeZone = CONFERENCE_TIMEZONE) {
  const p = parts(Date.parse(iso), timeZone);
  return `${p.hour}:${p.minute}`;
}
/** "Thu 12 Nov" in the conference zone. */
export function zonedDay(iso: string, timeZone = CONFERENCE_TIMEZONE) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(Date.parse(iso));
}
export function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
