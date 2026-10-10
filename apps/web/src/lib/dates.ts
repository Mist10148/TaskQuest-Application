/**
 * Calendar-date helpers for list deadlines ("YYYY-MM-DD", no time or zone).
 * They are compared and shown as strings: `new Date('2030-01-05')` is UTC
 * midnight, which marks a list overdue on its own due date and shows the
 * previous day to users west of UTC. Mirrors packages/shared/src/dates.js.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today's date in the browser's own time zone, as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
