// Eastern-time formatters used across the dashboard. Uses the IANA
// "America/New_York" zone so the abbreviation auto-toggles between
// EST and EDT depending on DST.

const EASTERN = "America/New_York";

function partsFor(d: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(d);
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

// "YYYY-MM-DD HH:MM EST" / "YYYY-MM-DD HH:MM EDT"
export function formatEasternStamp(d: Date | string | null | undefined): string {
  if (d == null) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "never";
  const p = partsFor(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName}`;
}

// "HH:MM" in Eastern time — for chart x-axis labels at sub-day granularity.
export function formatEasternTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const p = partsFor(date);
  return `${p.hour}:${p.minute}`;
}

// "MM-DD HH:00" — for chart x-axis at hourly bucket granularity (7d view).
export function formatEasternDateHour(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const p = partsFor(date);
  return `${p.month}-${p.day} ${p.hour}:00`;
}

// "MM-DD" — for chart x-axis at multi-hour / daily granularity (30d, 90d).
export function formatEasternDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const p = partsFor(date);
  return `${p.month}-${p.day}`;
}

// "YYYY-MM" — for chart x-axis at daily-or-larger granularity over a year.
export function formatEasternMonth(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const p = partsFor(date);
  return `${p.year}-${p.month}`;
}
