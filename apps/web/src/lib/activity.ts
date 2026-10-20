/** Words for a task's history entries (the Activity tab of the detail drawer). */

import type { ItemActivity } from "./api";
import { formatDeadline } from "./dates";

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** "You", the person's name, or "Someone" when the account is gone. */
export const actorName = (actor: ItemActivity["actor"]): string => (actor?.isYou ? "You" : actor?.name || "Someone");

/** One history entry as a sentence, e.g. "Sam changed the priority from Low to High". */
export function describeActivity(a: ItemActivity): string {
  const who = actorName(a.actor);
  switch (a.kind) {
    case "created":
      return `${who} added this task`;
    case "renamed":
      return `${who} renamed it from "${a.from ?? ""}" to "${a.to ?? ""}"`;
    case "completed":
      return `${who} marked it done`;
    case "reopened":
      return `${who} reopened it`;
    case "priority":
      return !a.to ? `${who} removed the priority` : a.from ? `${who} changed the priority from ${cap(a.from)} to ${cap(a.to)}` : `${who} set the priority to ${cap(a.to)}`;
    case "due":
      return !a.to ? `${who} removed the due date` : `${who} set the due date to ${formatDeadline(a.to)}`;
    case "assigned":
      return !a.to ? `${who} unassigned it` : `${who} assigned it to ${a.to}`;
    case "moved":
      return `${who} moved it from ${a.from ?? "another quest"} to ${a.to ?? "this quest"}`;
    default:
      return `${who} changed it`;
  }
}

/** "just now", "5 min ago", "3 h ago", or the date for anything older than a day. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return then.toLocaleDateString();
}
