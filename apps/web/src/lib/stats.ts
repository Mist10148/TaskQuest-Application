/** Pure helpers behind the Stats page: heatmap grid, bar geometry and small formatters. */

import type { XPHistoryDay } from "@/lib/api";

const DAY_MS = 86_400_000;

export interface HeatCell {
  /** YYYY-MM-DD (UTC). */
  date: string;
  count: number;
  /** 0 = none, 1-4 = increasingly busy. */
  level: 0 | 1 | 2 | 3 | 4;
  /** After today: drawn as an empty slot, not as a quiet day. */
  future: boolean;
}

const toMs = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Monday-based weekday index of a YYYY-MM-DD date (Monday 0 ... Sunday 6). */
export function mondayIndex(date: string): number {
  return (new Date(toMs(date)).getUTCDay() + 6) % 7;
}

/** Heat level for a day's count, relative to the busiest day shown. */
export function heatLevel(count: number, max: number): HeatCell["level"] {
  if (!(count > 0) || !(max > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as HeatCell["level"];
}

/**
 * The completion heatmap as columns of 7 days (Monday first), `weeks` columns ending with the week of `today`.
 * Days missing from `history` count as zero. The last column is padded with `future` cells after today.
 */
export function buildHeatmap(history: readonly XPHistoryDay[], today: string, weeks = 12): HeatCell[][] {
  const counts = new Map(history.map((d) => [d.date, d.tasksCompleted]));
  const start = toMs(today) - mondayIndex(today) * DAY_MS - (weeks - 1) * 7 * DAY_MS;
  const end = toMs(today);
  let max = 0;
  for (let t = start; t <= end; t += DAY_MS) max = Math.max(max, counts.get(fromMs(t)) ?? 0);
  const columns: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const t = start + (w * 7 + d) * DAY_MS;
      const date = fromMs(t);
      const future = t > end;
      const count = future ? 0 : counts.get(date) ?? 0;
      column.push({ date, count, level: heatLevel(count, max), future });
    }
    columns.push(column);
  }
  return columns;
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bar rectangles for `values` inside a `width` x `height` box. The tallest bar fills the height; a non-zero value
 * is never thinner than 2px so a quiet day is still visible; zero values get no height.
 */
export function barLayout(values: readonly number[], width: number, height: number, gap = 2): Bar[] {
  if (values.length === 0) return [];
  const max = Math.max(...values, 0);
  const slot = width / values.length;
  const barWidth = Math.max(1, slot - gap);
  return values.map((v, i) => {
    const h = max > 0 && v > 0 ? Math.max(2, (v / max) * height) : 0;
    return { x: i * slot + gap / 2, y: height - h, width: barWidth, height: h };
  });
}

/** "Mar 5" from a YYYY-MM-DD date (formatted from the parts, no time zone can move the day). */
export function shortDate(date: string): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1] ?? "?"} ${d}`;
}

/** Sum of a numeric field across the days. */
export const sumBy = (days: readonly XPHistoryDay[], key: "xp" | "tasksCompleted"): number => days.reduce((n, d) => n + d[key], 0);

/** Today's UTC date as YYYY-MM-DD. */
export const utcToday = (now: Date = new Date()): string => now.toISOString().slice(0, 10);
