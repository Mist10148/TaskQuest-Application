/** Filters and groups for a quest's task list (what to show, and under which headings). Pure, so it can be tested. */

import type { Item, Priority } from "./api";
import { parseTags } from "./tags";
import { addDays, effectivePriority } from "./taskViews";

export type DueWindow = "any" | "overdue" | "today" | "week" | "none";

export interface TaskFilter {
  status: "all" | "open" | "done";
  priority: "any" | "none" | Priority;
  due: DueWindow;
  /** A tag, or "" for any. */
  tag: string;
  assignee: "any" | "me" | "unassigned";
  /** Words to find in a task's name or description (not remembered between visits). */
  text: string;
}

export type GroupBy = "none" | "priority" | "due" | "tag";

export const DEFAULT_FILTER: TaskFilter = { status: "all", priority: "any", due: "any", tag: "", assignee: "any", text: "" };

export const isFiltering = (f: TaskFilter): boolean => f.status !== "all" || f.priority !== "any" || f.due !== "any" || f.tag !== "" || f.assignee !== "any" || f.text.trim() !== "";

const dueDay = (item: Pick<Item, "due_date">): string | null => (item.due_date ? String(item.due_date).slice(0, 10) : null);

/** Which due window a task falls in. Only open tasks are ever overdue. */
export function dueWindowOf(item: Pick<Item, "due_date" | "completed">, today: string): Exclude<DueWindow, "any"> | "later" {
  const due = dueDay(item);
  if (!due) return "none";
  if (due < today) return item.completed ? "later" : "overdue";
  if (due === today) return "today";
  if (due <= addDays(today, 6)) return "week";
  return "later";
}

/** True when one task passes every part of the filter. */
export function matchesFilter(item: Item, f: TaskFilter, listPriority: Priority | null | undefined, today: string): boolean {
  if (f.status === "open" && item.completed) return false;
  if (f.status === "done" && !item.completed) return false;
  if (f.priority !== "any") {
    const p = effectivePriority(item, listPriority);
    if (f.priority === "none" ? p !== null : p !== f.priority) return false;
  }
  if (f.due !== "any") {
    const w = dueWindowOf(item, today);
    // "This week" includes today and anything overdue, like most task apps' "next 7 days".
    if (f.due === "week" ? !["overdue", "today", "week"].includes(w) : w !== f.due) return false;
  }
  if (f.tag && !parseTags(item.tags).includes(f.tag)) return false;
  if (f.assignee === "me" && !item.assignee?.isYou) return false;
  if (f.assignee === "unassigned" && item.assignee) return false;
  const words = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const haystack = `${item.name} ${item.description ?? ""}`.toLowerCase();
    if (!words.every((w) => haystack.includes(w))) return false;
  }
  return true;
}

/**
 * The tasks to show: a parent stays when it or any of its subtasks matches (so a matching subtask keeps its context);
 * a matching parent shows all its subtasks, otherwise only the matching ones.
 */
export function filterTasks(
  topLevel: readonly Item[],
  childrenOf: ReadonlyMap<number, readonly Item[]>,
  f: TaskFilter,
  listPriority: Priority | null | undefined,
  today: string
): { topLevel: Item[]; childrenOf: Map<number, Item[]> } {
  const top: Item[] = [];
  const kids = new Map<number, Item[]>();
  for (const parent of topLevel) {
    const children = childrenOf.get(parent.id) ?? [];
    const parentHit = matchesFilter(parent, f, listPriority, today);
    const shown = parentHit ? [...children] : children.filter((c) => matchesFilter(c, f, listPriority, today));
    if (!parentHit && shown.length === 0) continue;
    top.push(parent);
    if (shown.length) kids.set(parent.id, shown);
  }
  return { topLevel: top, childrenOf: kids };
}

/** Every tag used in the quest, sorted, for the tag filter. */
export const tagsIn = (items: readonly Item[]): string[] => [...new Set(items.flatMap((i) => parseTags(i.tags)))].sort();

export interface TaskGroup {
  key: string;
  label: string;
  items: Item[];
}

const PRIORITY_GROUPS: Array<[string, string]> = [["HIGH", "High priority"], ["MEDIUM", "Medium priority"], ["LOW", "Low priority"], ["none", "No priority"]];
const DUE_GROUPS: Array<[string, string]> = [["overdue", "Overdue"], ["today", "Due today"], ["week", "Next 7 days"], ["later", "Later"], ["none", "No due date"]];

/** Top-level tasks under headings, in a fixed order; empty groups are left out. A task goes under its first tag. */
export function groupTasks(topLevel: readonly Item[], by: GroupBy, listPriority: Priority | null | undefined, today: string): TaskGroup[] {
  if (by === "none") return [{ key: "all", label: "", items: [...topLevel] }];
  const keyOf = (item: Item): string =>
    by === "priority" ? effectivePriority(item, listPriority) ?? "none"
    : by === "due" ? dueWindowOf(item, today)
    : parseTags(item.tags)[0] ?? "";
  const order: Array<[string, string]> =
    by === "priority" ? PRIORITY_GROUPS
    : by === "due" ? DUE_GROUPS
    : [...[...new Set(topLevel.map(keyOf).filter(Boolean))].sort().map((t): [string, string] => [t, `#${t}`]), ["", "No tag"]];
  return order
    .map(([key, label]) => ({ key, label, items: topLevel.filter((i) => keyOf(i) === key) }))
    .filter((g) => g.items.length > 0);
}

const PREFS_KEY = "taskquest:task-filter";
const STATUS = ["all", "open", "done"];
const PRIORITY = ["any", "none", "HIGH", "MEDIUM", "LOW"];
const DUE = ["any", "overdue", "today", "week", "none"];
const GROUPS = ["none", "priority", "due", "tag"];
const ASSIGNEE = ["any", "me", "unassigned"];

/** The filter and grouping last used in this browser (a convenience: anything unreadable falls back to the defaults). */
export function loadFilterPrefs(): { filter: TaskFilter; groupBy: GroupBy } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<TaskFilter> & { groupBy?: string };
    const pick = <T extends string>(value: unknown, allowed: string[], fallback: T): T => (typeof value === "string" && allowed.includes(value) ? (value as T) : fallback);
    return {
      filter: {
        status: pick(saved.status, STATUS, DEFAULT_FILTER.status),
        priority: pick(saved.priority, PRIORITY, DEFAULT_FILTER.priority),
        due: pick(saved.due, DUE, DEFAULT_FILTER.due),
        tag: typeof saved.tag === "string" ? saved.tag : "",
        assignee: pick(saved.assignee, ASSIGNEE, DEFAULT_FILTER.assignee),
        text: "",
      },
      groupBy: pick(saved.groupBy, GROUPS, "none"),
    };
  } catch {
    return { filter: DEFAULT_FILTER, groupBy: "none" };
  }
}

export function saveFilterPrefs(filter: TaskFilter, groupBy: GroupBy): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...filter, text: "", groupBy }));
  } catch {
    /* the choice just is not remembered */
  }
}
