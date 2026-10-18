/**
 * Calendar-date helpers. Deadlines are plain dates ("YYYY-MM-DD") with no time
 * or zone, so they are compared and shown as strings. Parsing them with
 * `new Date('2030-01-05')` yields UTC midnight, which makes a list look overdue
 * on its own due date and shifts the displayed day for users west of UTC.
 */

'use strict';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const validZones = new Map(); // zone string -> canonical name or null; bounded because the strings can come from user input
const dayFormatters = new Map(); // valid zone -> Intl.DateTimeFormat
const CACHE_LIMIT = 500;

/**
 * The canonical spelling of an IANA zone name ("europe/paris" becomes "Europe/Paris"), or null when `tz` is not one.
 * Offset zones ("+05:30") are refused: they are valid for Intl but are not zone names, and the AI service (Python
 * zoneinfo) would not understand them, nor a lower-case name.
 */
function canonicalTimeZone(tz) {
    if (!tz || typeof tz !== 'string') return null;
    if (validZones.has(tz)) return validZones.get(tz);
    let canonical = null;
    try {
        const resolved = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
        if (resolved && !/^[+-]/.test(resolved)) canonical = resolved;
    } catch {
        canonical = null;
    }
    if (validZones.size >= CACHE_LIMIT) validZones.clear();
    validZones.set(tz, canonical);
    return canonical;
}

/** True when `tz` is an IANA zone name this runtime understands (any capitalisation; see canonicalTimeZone). */
function isValidTimeZone(tz) {
    return canonicalTimeZone(tz) !== null;
}

/** The calendar date ("YYYY-MM-DD") it is right now in `tz` (UTC when omitted or unknown). */
function todayInZone(tz, now = new Date()) {
    if (!isValidTimeZone(tz)) return now.toISOString().slice(0, 10);
    let fmt = dayFormatters.get(tz);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        if (dayFormatters.size >= CACHE_LIMIT) dayFormatters.clear();
        dayFormatters.set(tz, fmt);
    }
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A deadline is past only once its whole day is over: due today is not overdue. */
function isPastDeadline(deadline, today = todayInZone()) {
    return Boolean(deadline) && String(deadline).slice(0, 10) < today;
}

/**
 * "Dec 26", or "Jan 15, 2026" when the year differs from `today`'s year.
 * Formatted from the string parts, so no time zone can move the day.
 */
function formatDeadline(deadline, today = todayInZone()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(deadline || ''));
    if (!m) return '';
    const label = `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
    return m[1] === today.slice(0, 4) ? label : `${label}, ${m[1]}`;
}

/** The hour (0-23) it is right now in `tz` (UTC when omitted or unknown). */
function hourInZone(tz, now = new Date()) {
    if (!isValidTimeZone(tz)) return now.getUTCHours();
    const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).find((p) => p.type === 'hour');
    return Number(h.value) % 24;
}

const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** ISO weekday (1 = Monday ... 7 = Sunday) it is right now in `tz` (UTC when omitted or unknown). */
function weekdayInZone(tz, now = new Date()) {
    const options = isValidTimeZone(tz) ? { timeZone: tz, weekday: 'short' } : { timeZone: 'UTC', weekday: 'short' };
    return WEEKDAYS[new Intl.DateTimeFormat('en-US', options).format(now)];
}

const pad = (n) => String(n).padStart(2, '0');

const DAY_MS = 86400e3;
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parts = (date) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
/** `day` clamped into month `mo` (1-12) of year `y`: Jan 31 -> Feb 28/29. */
const clampedDay = (y, mo, day) => Math.min(day, new Date(Date.UTC(y, mo, 0)).getUTCDate());

/**
 * The next due date for a repeating task, as YYYY-MM-DD.
 * Monthly repeats aim for `anchorDay` (default: the day of `date`) and clamp to short
 * months, so passing the original day keeps Jan 31 -> Feb 28 -> Mar 31.
 * @param {string} date    the date being repeated from (YYYY-MM-DD)
 * @param {'daily'|'weekly'|'monthly'} rule
 * @param {number|null} [anchorDay]  the day of month a monthly repeat should return to
 */
function nextOccurrence(date, rule, anchorDay = null) {
    const p = parts(date);
    if (!p) return null;
    const [y, mo, d] = p;
    if (rule === 'daily' || rule === 'weekly') return fmt(new Date(Date.UTC(y, mo - 1, d + (rule === 'daily' ? 1 : 7))));
    if (rule === 'monthly') {
        const target = new Date(Date.UTC(y, mo, 1)); // first of next month
        const ty = target.getUTCFullYear();
        const tm = target.getUTCMonth() + 1;
        return `${ty}-${pad(tm)}-${pad(clampedDay(ty, tm, anchorDay || d))}`;
    }
    return null;
}

/**
 * Repeat until the date is `today` or later, so completing a task late doesn't spawn an
 * already-overdue copy. Computed arithmetically, so any amount of lateness is handled.
 */
function nextDueOnOrAfter(date, rule, today, anchorDay = null) {
    const first = nextOccurrence(date, rule, anchorDay);
    const p = parts(first);
    const t = parts(today);
    if (!p || !t || first >= today) return first;
    if (rule === 'daily' || rule === 'weekly') {
        const step = rule === 'daily' ? 1 : 7;
        const gap = Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(p[0], p[1] - 1, p[2])) / DAY_MS);
        return fmt(new Date(Date.UTC(p[0], p[1] - 1, p[2] + Math.ceil(gap / step) * step)));
    }
    // Monthly: jump to today's month, then step at most once more.
    const anchor = anchorDay || p[2];
    let [y, mo] = [t[0], t[1]];
    let next = `${y}-${pad(mo)}-${pad(clampedDay(y, mo, anchor))}`;
    if (next < today) {
        mo += 1;
        if (mo > 12) [y, mo] = [y + 1, 1];
        next = `${y}-${pad(mo)}-${pad(clampedDay(y, mo, anchor))}`;
    }
    return next;
}

/** Whole days from one YYYY-MM-DD date to another (positive when `to` is later). Zone-free. */
function daysBetween(from, to) {
    const parse = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
    return Math.round((parse(String(to)) - parse(String(from))) / 86400e3);
}

module.exports = { daysBetween, canonicalTimeZone, isValidTimeZone, hourInZone, weekdayInZone, todayInZone, isPastDeadline, formatDeadline, nextOccurrence, nextDueOnOrAfter };
