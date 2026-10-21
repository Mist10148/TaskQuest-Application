/**
 * Calendar-date helpers for list deadlines ("YYYY-MM-DD", no time or zone).
 * They are compared and shown as strings: `new Date('2030-01-05')` is UTC
 * midnight, which marks a list overdue on its own due date and shows the
 * previous day to users west of UTC. Mirrors packages/shared/src/dates.js.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The user's time zone setting (set by AuthProvider), or null to use the browser's own zone. */
let userZone: string | null = null;

/**
 * Read "today" in `zone`: the user's time zone setting, which is the day the server uses for overdue, due today and the
 * date bonuses. Null (no account loaded, or no zone saved yet) falls back to the browser's zone.
 */
export function setUserZone(zone: string | null | undefined): void {
  userZone = zone || null;
}

/** YYYY-MM-DD from a Date's browser-local parts. */
function browserDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today's date as YYYY-MM-DD in the user's time zone (see setUserZone), else the browser's. */
export function localToday(now: Date = new Date(), zone: string | null = userZone): string {
  if (zone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    } catch {
      // an unknown zone name: use the browser's day
    }
  }
  return browserDay(now);
}

/** `day` ("YYYY-MM-DD") moved by `days` calendar days, without going through UTC. */
export function addDays(day: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly(day));
  if (!m) return "";
  return browserDay(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
}

/** The quick picks next to a due-date field. "" clears the date. */
export function quickDueDates(today: string = localToday()): Array<{ label: string; value: string }> {
  return [
    { label: "Today", value: today },
    { label: "Tomorrow", value: addDays(today, 1) },
    { label: "Next week", value: addDays(today, 7) },
    { label: "No date", value: "" },
  ];
}

/** The date part of a DATE or ISO string, or "" when absent. */
export function dateOnly(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : "";
}

/** Past only once the whole due day is over: due today is not overdue. */
export function isPastDeadline(deadline: string | null | undefined, today: string = localToday()): boolean {
  const d = dateOnly(deadline);
  return d !== "" && d < today;
}

/** "Dec 26", or "Jan 15, 2026" when the year differs from today's year. */
export function formatDeadline(deadline: string | null | undefined, today: string = localToday()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnly(deadline));
  if (!m) return "";
  const label = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  return m[1] === today.slice(0, 4) ? label : `${label}, ${m[1]}`;
}

/** Sort key for deadlines: plain string order is chronological for YYYY-MM-DD. */
export function compareDeadlines(a: string | null | undefined, b: string | null | undefined): number {
  const x = dateOnly(a);
  const y = dateOnly(b);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x < y ? -1 : x > y ? 1 : 0;
}
