/**
 * Quick add: turn one line like "Finish report fri !high #work every week" into
 * a task. Pure and forgiving: whatever it does not recognise stays in the name.
 *
 *   dates       today, tomorrow, mon..sat (the next one), in 3 days/weeks, 2030-05-04, jan 5, 5 jan
 *   priority    !high !h  !medium !med !m  !low !l
 *   tags        #work #home (up to 5)
 *   repeat      daily, every day, weekly, every week, monthly, every month
 *
 * Mirrors packages/shared/src/quickAdd.js (used by the Discord bot); both are
 * tested against the same examples.
 */

import type { Priority, Recurrence } from "@/lib/api";

export interface QuickAddResult {
  name: string;
  due_date: string | null;
  priority: Priority | null;
  tags: string[];
  recurrence: Recurrence | null;
}

// Only whole words count ("sun" and "sat" are left alone: "buy sun cream" is not a date).
const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6,
};
const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};
const PRIORITIES: Record<string, Priority> = { h: "HIGH", high: "HIGH", m: "MEDIUM", med: "MEDIUM", medium: "MEDIUM", l: "LOW", low: "LOW" };
const REPEATS: Record<string, Recurrence> = { daily: "daily", weekly: "weekly", monthly: "monthly" };
const EVERY: Record<string, Recurrence> = { day: "daily", week: "weekly", month: "monthly" };

const has = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (date: Date, n: number) => new Date(date.getTime() + n * 86400e3);

/** A real calendar date, or null (rejects Feb 30 and friends). */
function realDate(y: number, m: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, m, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m && date.getUTCDate() === d ? date : null;
}

/** The next occurrence of month/day on or after `base` (this year, else next year). */
function monthDay(base: Date, month: number, day: number): Date | null {
  const y = base.getUTCFullYear();
  const thisYear = realDate(y, month, day);
  if (thisYear && thisYear.getTime() >= base.getTime()) return thisYear;
  return realDate(y + 1, month, day);
}

const clean = (w: string | undefined) => (w || "").toLowerCase().replace(/[.,;:]+$/, "");

/** `today` is YYYY-MM-DD for the person typing (their own time zone). */
export function parseQuickAdd(input: string, today: string): QuickAddResult {
  const base = new Date(`${today}T00:00:00Z`);
  const words = String(input || "").trim().split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  const out: QuickAddResult = { name: "", due_date: null, priority: null, tags: [], recurrence: null };

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = clean(raw);
    const next = clean(words[i + 1]);
    const after = clean(words[i + 2]);

    if (/^!(high|h|medium|med|m|low|l)$/.test(w) && !out.priority) {
      out.priority = PRIORITIES[w.slice(1)];
      continue;
    }
    if (/^#[\p{L}\p{N}_-]{1,20}$/u.test(w) && out.tags.length < 5) {
      const tag = w.slice(1);
      if (!out.tags.includes(tag)) out.tags.push(tag);
      continue;
    }
    if (!out.recurrence) {
      if (has(REPEATS, w)) {
        out.recurrence = REPEATS[w];
        continue;
      }
      if (w === "every" && has(EVERY, next)) {
        out.recurrence = EVERY[next];
        i += 1;
        continue;
      }
    }
    if (!out.due_date) {
      let due: Date | null = null;
      let used = 0;
      if (w === "today") due = base;
      else if (w === "tomorrow" || w === "tmr") due = addDays(base, 1);
      else if (has(WEEKDAYS, w)) {
        const ahead = ((WEEKDAYS[w] - base.getUTCDay() + 7) % 7) || 7; // "fri" on a Friday means next Friday
        due = addDays(base, ahead);
      } else if (w === "in" && /^\d{1,3}$/.test(next) && /^(day|days|week|weeks)$/.test(after)) {
        due = addDays(base, Number(next) * (after.startsWith("week") ? 7 : 1));
        used = 2;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
        const [y, m, d] = w.split("-").map(Number);
        due = realDate(y, m - 1, d);
      } else if (has(MONTHS, w) && /^\d{1,2}$/.test(next)) {
        due = monthDay(base, MONTHS[w], Number(next));
        used = due ? 1 : 0;
      } else if (/^\d{1,2}$/.test(w) && has(MONTHS, next)) {
        due = monthDay(base, MONTHS[next], Number(w));
        used = due ? 1 : 0;
      }
      if (due) {
        out.due_date = ymd(due);
        i += used;
        continue;
      }
    }
    keep.push(raw);
  }
  out.name = keep.join(" ").trim();
  return out;
}
