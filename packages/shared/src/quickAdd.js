/**
 * Quick add: turn one line like "Finish report fri !high #work every week" into
 * a task. Pure and forgiving: whatever it does not recognise stays in the name.
 *
 *   dates       today, tomorrow, mon..sun (the next one), in 3 days/weeks, 2030-05-04, jan 5, 5 jan
 *   priority    !high !h  !medium !med !m  !low !l
 *   tags        #work #home (up to 5)
 *   repeat      daily, every day, weekly, every week, monthly, every month
 *   estimate    ~30m ~1h ~1h30m ~1.5h (1 minute to 10 hours)
 *
 * A copy lives in apps/web/src/lib/quickAdd.ts (the browser cannot load this CommonJS file);
 * both are tested against the same examples.
 */

'use strict';

const { LIMITS } = require('./constants');

// Only whole words count ("sun" and "sat" are left alone: "buy sun cream" is not a date).
const WEEKDAYS = {
    sunday: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6
};
const MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
    jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11
};
const PRIORITIES = { h: 'HIGH', high: 'HIGH', m: 'MEDIUM', med: 'MEDIUM', medium: 'MEDIUM', l: 'LOW', low: 'LOW' };
const REPEATS = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' };
const EVERY = { day: 'daily', week: 'weekly', month: 'monthly' };

const pad = (n) => String(n).padStart(2, '0');

/** "~30m", "~2h", "~1h30m" or "~1.5h" in minutes, or null when the word is not an estimate (or out of range). */
function parseEstimate(word) {
    const m = /^~(?:(\d{1,2}(?:\.\d)?)h)?(?:(\d{1,3})m)?$/.exec(word);
    if (!m || (m[1] === undefined && m[2] === undefined)) return null;
    const minutes = Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0);
    return minutes >= 1 && minutes <= LIMITS.ESTIMATE_MAX_MINUTES ? minutes : null;
}
const ymd = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (date, n) => new Date(date.getTime() + n * 86400e3);

/** A real calendar date, or null (rejects Feb 30 and friends). */
function realDate(y, m, d) {
    const date = new Date(Date.UTC(y, m, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m && date.getUTCDate() === d ? date : null;
}

/**
 * @param {string} input
 * @param {string} today  YYYY-MM-DD "today" for the person typing (their own time zone)
 * @returns {{ name: string, due_date: string|null, priority: string|null, tags: string[], recurrence: string|null, estimate_minutes: number|null }}
 */
function parseQuickAdd(input, today) {
    const base = new Date(`${today}T00:00:00Z`);
    const words = String(input || '').trim().split(/\s+/).filter(Boolean);
    const keep = [];
    const out = { name: '', due_date: null, priority: null, tags: [], recurrence: null, estimate_minutes: null };

    for (let i = 0; i < words.length; i++) {
        const raw = words[i];
        const w = raw.toLowerCase().replace(/[.,;:]+$/, '');
        const next = (words[i + 1] || '').toLowerCase().replace(/[.,;:]+$/, '');
        const after = (words[i + 2] || '').toLowerCase().replace(/[.,;:]+$/, '');

        if (/^!(high|h|medium|med|m|low|l)$/.test(w) && !out.priority) {
            out.priority = PRIORITIES[w.slice(1)];
            continue;
        }
        if (out.estimate_minutes === null && w.startsWith('~')) {
            const minutes = parseEstimate(w);
            if (minutes !== null) {
                out.estimate_minutes = minutes;
                continue;
            }
        }
        if (/^#[\p{L}\p{N}_-]{1,20}$/u.test(w) && out.tags.length < 5) {
            const tag = w.slice(1);
            if (!out.tags.includes(tag)) out.tags.push(tag);
            continue;
        }
        if (!out.recurrence) {
            if (Object.hasOwn(REPEATS, w)) {
                out.recurrence = REPEATS[w];
                continue;
            }
            if (w === 'every' && Object.hasOwn(EVERY, next)) {
                out.recurrence = EVERY[next];
                i += 1;
                continue;
            }
        }
        if (!out.due_date) {
            let due = null;
            let used = 0;
            if (w === 'today') due = base;
            else if (w === 'tomorrow' || w === 'tmr') due = addDays(base, 1);
            else if (Object.hasOwn(WEEKDAYS, w)) {
                const target = WEEKDAYS[w];
                const ahead = ((target - base.getUTCDay() + 7) % 7) || 7; // "fri" on a Friday means next Friday
                due = addDays(base, ahead);
            } else if (w === 'in' && /^\d{1,3}$/.test(next) && /^(day|days|week|weeks)$/.test(after)) {
                due = addDays(base, Number(next) * (after.startsWith('week') ? 7 : 1));
                used = 2;
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
                const [y, m, d] = w.split('-').map(Number);
                due = realDate(y, m - 1, d);
            } else if (Object.hasOwn(MONTHS, w) && /^\d{1,2}$/.test(next)) {
                due = monthDay(base, MONTHS[w], Number(next));
                used = due ? 1 : 0;
            } else if (/^\d{1,2}$/.test(w) && Object.hasOwn(MONTHS, next)) {
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
    out.name = keep.join(' ').trim();
    return out;
}

/** The next occurrence of month/day on or after `base`: Feb 29 can be up to four years away; Feb 30 never comes. */
function monthDay(base, month, day) {
    const y = base.getUTCFullYear();
    for (let year = y; year <= y + 4; year++) {
        const date = realDate(year, month, day);
        if (date && date.getTime() >= base.getTime()) return date;
    }
    return null;
}

module.exports = { parseQuickAdd, parseEstimate };
