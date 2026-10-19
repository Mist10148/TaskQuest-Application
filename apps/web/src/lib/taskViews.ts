/** Pure helpers for the board and calendar views of a quest. */

import type { Item, Priority } from "./api";

export type TaskView = "list" | "board" | "calendar";
export const TASK_VIEWS: Array<{ value: TaskView; label: string }> = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
  { value: "calendar", label: "Calendar" },
];

export interface BoardColumn {
  key: Priority | "NONE";
  label: string;
  open: Item[];
  done: Item[];
}

const COLUMNS: Array<{ key: BoardColumn["key"]; label: string }> = [
  { key: "HIGH", label: "High" },
  { key: "MEDIUM", label: "Medium" },
  { key: "LOW", label: "Low" },
  { key: "NONE", label: "No priority" },
];

/** The task's own priority, else the quest's. */
export const effectivePriority = (item: Pick<Item, "priority">, listPriority?: Priority | null): Priority | null => item.priority ?? listPriority ?? null;

/** Top-level tasks in priority columns (open ones first in list order, finished ones after). Empty columns are kept so the board does not jump. */
export function boardColumns(items: readonly Item[], listPriority?: Priority | null): BoardColumn[] {
  const columns: BoardColumn[] = COLUMNS.map((c) => ({ ...c, open: [], done: [] }));
  for (const item of items) {
    if (item.parent_id) continue;
    const key = effectivePriority(item, listPriority) ?? "NONE";
    const column = columns.find((c) => c.key === key)!;
    (item.completed ? column.done : column.open).push(item);
  }
  return columns;
}

export interface DayCell {
  /** YYYY-MM-DD */
  date: string;
  inMonth: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** The weeks (Monday first) that cover a month, as 7-day rows of dates. `month` is 1 to 12. */
export function monthGrid(year: number, month: number): DayCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(Date.UTC(year, month - 1, 1 - offset));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = Math.ceil((offset + daysInMonth) / 7);
  const weeks: DayCell[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < rows; w++) {
    const row: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      row.push({ date: iso(cursor), inMonth: cursor.getUTCMonth() === month - 1 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

/** Month and year `delta` months from a given one. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** Top-level tasks with a due date, by date. */
export function tasksByDate(items: readonly Item[]): Map<string, Item[]> {
  const map = new Map<string, Item[]>();
  for (const item of items) {
    if (item.parent_id || !item.due_date) continue;
    const date = String(item.due_date).slice(0, 10);
    map.set(date, [...(map.get(date) ?? []), item]);
  }
  return map;
}

/** `date` moved by whole days (UTC calendar arithmetic, so no time zone can skip or repeat a day). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/**
 * The day a key moves to in the calendar grid (the keys of the WAI-ARIA date-grid pattern), or null for any
 * other key: arrows move by a day or a week, Home/End go to the week's Monday/Sunday, PageUp/PageDown move a
 * month (the day is clamped, so 31 March goes back to 28 or 29 February).
 */
export function calendarKeyTarget(date: string, key: string): string | null {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  switch (key) {
    case "ArrowLeft": return addDays(date, -1);
    case "ArrowRight": return addDays(date, 1);
    case "ArrowUp": return addDays(date, -7);
    case "ArrowDown": return addDays(date, 7);
    case "Home": return addDays(date, -weekday);
    case "End": return addDays(date, 6 - weekday);
    case "PageUp":
    case "PageDown": {
      const { year, month } = shiftMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)), key === "PageUp" ? -1 : 1);
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return `${year}-${pad(month)}-${pad(Math.min(Number(date.slice(8, 10)), last))}`;
    }
    default: return null;
  }
}

/** The priority a task gets when it is moved to a board column ("No priority" clears it). */
export const columnPriority = (key: BoardColumn["key"]): Priority | null => (key === "NONE" ? null : key);

/**
 * Whether a task may be moved to a column. "No priority" is closed while the quest has a priority of its own: a task
 * without one shows under the quest's priority, so it would bounce straight back.
 */
export const canMoveToColumn = (key: BoardColumn["key"], listPriority?: Priority | null): boolean => key !== "NONE" || !listPriority;
