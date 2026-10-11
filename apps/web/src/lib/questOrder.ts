import { dateOnly, isPastDeadline, localToday } from "./dates";

export interface OrderableList {
  id: number;
  deadline: string | null;
  created_at: string;
  itemsTotal?: number;
  itemsCompleted?: number;
}

const isFinished = (l: OrderableList) => (l.itemsTotal ?? 0) > 0 && (l.itemsCompleted ?? 0) >= (l.itemsTotal ?? 0);

/** 0 = overdue, 1 = due today, 2 = everything else. Finished quests never count as urgent. */
function urgency(l: OrderableList, today: string): number {
  if (isFinished(l)) return 2;
  if (isPastDeadline(l.deadline, today)) return 0;
  if (dateOnly(l.deadline) === today) return 1;
  return 2;
}

/** Overdue first (oldest deadline first), then due today, then the rest newest first. Stable. */
export function orderQuestsForDashboard<T extends OrderableList>(lists: readonly T[], today: string = localToday()): T[] {
  return [...lists].sort((a, b) => {
    const ua = urgency(a, today);
    const ub = urgency(b, today);
    if (ua !== ub) return ua - ub;
    if (ua === 0) return dateOnly(a.deadline).localeCompare(dateOnly(b.deadline));
    if (ua === 2) return String(b.created_at).localeCompare(String(a.created_at));
    return 0;
  });
}
