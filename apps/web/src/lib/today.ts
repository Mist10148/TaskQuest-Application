import type { TodayData } from "./api";

/** One friendly line for the top of the Today page. */
export function todayHeadline(data: Pick<TodayData, "counts" | "tasks">): string {
  const { dueToday, overdue, doneToday } = data.counts;
  if (overdue > 0) return `${overdue} ${overdue === 1 ? "task is" : "tasks are"} overdue. Start with the oldest.`;
  if (dueToday > 0) return `${dueToday} ${dueToday === 1 ? "task is" : "tasks are"} due today.`;
  if (doneToday > 0) return `Nice: ${doneToday} done today and nothing is waiting.`;
  return data.tasks.length > 0 ? "Nothing is due. These are your HIGH priority tasks." : "A clear day. Add a task or take a break.";
}

/** The width of a progress bar, 0 to 100, for `progress` of `target` (no goal reads as 0). */
export function goalPercent(progress: number, target: number | null): number {
  if (!target || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progress / target) * 100)));
}

/**
 * When a streak lapses, for the at-risk alert: "at 11:30 PM today", "at 8:00 AM tomorrow", or "today" when the server did not
 * say (an older server). Read in the browser's own zone, which is the one the time is shown in.
 */
export function streakDeadline(expiresAt: string | null | undefined, now: Date = new Date()): string {
  if (!expiresAt) return "today";
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return "today";
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `at ${time} ${at.toDateString() === now.toDateString() ? "today" : "tomorrow"}`;
}
