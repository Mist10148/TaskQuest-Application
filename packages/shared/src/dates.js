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

module.exports = { isValidTimeZone, todayInZone, isPastDeadline, formatDeadline };
