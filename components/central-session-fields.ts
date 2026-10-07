/** Inputs deliberately use conference time, independent of the device timezone. */
export const conferenceTimeZone = "Asia/Qatar";
export function sessionInputTime(value?: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: conferenceTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function sessionTimeLabel(value?: string | null): string {
  if (!value) return "Not set";
  if (!Number.isFinite(Date.parse(value))) return "Invalid time";
  return new Intl.DateTimeFormat("en-GB", { timeZone: conferenceTimeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
export function sessionSlotFields(name: string, start: string, end: string) {
  const error = (message: string): never => { throw new Error(message); };
  if (!name.trim()) error("Enter a session name.");
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return error("Enter a valid date and time.");
    const instant = new Date(`${value}:00+03:00`);
    if (!Number.isFinite(instant.getTime()) || sessionInputTime(instant.toISOString()) !== value) return error("Enter a valid date and time.");
    return instant.toISOString();
  };
  const startsAt = parse(start);
  const endsAt = end ? parse(end) : null;
  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) error("End must be after start.");
  return { name: name.trim(), startsAt, endsAt };
}
