/**
 * Calendar-date helpers. Deadlines are plain dates ("YYYY-MM-DD") with no time
 * or zone, so they are compared and shown as strings. Parsing them with
 * `new Date('2030-01-05')` yields UTC midnight, which makes a list look overdue
 * on its own due date and shifts the displayed day for users west of UTC.
 */

'use strict';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** True when `tz` is an IANA zone name this runtime understands. */
function isValidTimeZone(tz) {
    if (!tz || typeof tz !== 'string') return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** The calendar date ("YYYY-MM-DD") it is right now in `tz` (UTC when omitted or unknown). */
function todayInZone(tz, now = new Date()) {
    if (!isValidTimeZone(tz)) return now.toISOString().slice(0, 10);
    // The en-CA locale formats dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
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

/**
 * The next due date for a repeating task, as YYYY-MM-DD.
 * Monthly repeats keep the day of month but clamp to short months (Jan 31 -> Feb 28/29).
 * @param {string} date    the date being repeated from (YYYY-MM-DD)
 * @param {'daily'|'weekly'|'monthly'} rule
 */
function nextOccurrence(date, rule) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (rule === 'daily' || rule === 'weekly') {
        const next = new Date(Date.UTC(y, mo - 1, d + (rule === 'daily' ? 1 : 7)));
        return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
    }
    if (rule === 'monthly') {
        const target = new Date(Date.UTC(y, mo, 1)); // first of next month
        const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, lastDay))}`;
    }
    return null;
}

/** Repeat until the date is `today` or later, so completing a task late doesn't spawn an already-overdue copy. */
function nextDueOnOrAfter(date, rule, today) {
    let next = nextOccurrence(date, rule);
    for (let i = 0; next && next < today && i < 400; i++) next = nextOccurrence(next, rule);
    return next;
}

module.exports = { isValidTimeZone, hourInZone, weekdayInZone, todayInZone, isPastDeadline, formatDeadline, nextOccurrence, nextDueOnOrAfter };
