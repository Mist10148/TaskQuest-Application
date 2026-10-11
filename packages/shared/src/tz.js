/**
 * Per-user "days": instants of local midnights in an IANA zone (pure, Intl only, no dependencies).
 *
 * Every daily/weekly/monthly window in the app is [start, end) in the user's own zone, with a day
 * starting 00:00 local and a week starting Monday 00:00 local. An unknown or empty zone means UTC.
 * Daylight-saving days are 23 or 25 hours long; a midnight that does not exist (a spring-forward gap
 * at 00:00) starts the day at the first instant after the gap.
 */

'use strict';

const { isValidTimeZone } = require('./dates');

const DAY = 86400e3;
const formatters = new Map();

/** The zone to use for `zone`: itself when valid, else 'UTC'. */
function resolveZone(zone) {
    return isValidTimeZone(zone) ? zone : 'UTC';
}

function formatter(zone) {
    let f = formatters.get(zone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: zone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        });
        formatters.set(zone, f);
    }
    return f;
}

const ms = (instant) => (instant instanceof Date ? instant.getTime() : Number(instant === undefined ? Date.now() : instant));

/** Wall-clock fields of `instant` in `zone`. */
function localParts(zone, instant) {
    const z = resolveZone(zone);
    const out = {};
    for (const p of formatter(z).formatToParts(new Date(ms(instant)))) if (p.type !== 'literal') out[p.type] = Number(p.value);
    out.hour %= 24;
    return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}

/** Zone offset from UTC at `instant`, in ms (east is positive). */
function offsetMs(zone, instant) {
    const t = Math.floor(ms(instant) / 1000) * 1000;
    const p = localParts(zone, t);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
}

/**
 * The UTC instant (ms) of local midnight on calendar day y-m-d in `zone`. Month/day may overflow
 * (day 32, month 13); they are normalised like Date.UTC. DST-safe via offset correction.
 */
function localMidnight(zone, y, m, d) {
    const z = resolveZone(zone);
    const wall = Date.UTC(y, m - 1, d); // the wall-clock time read as if it were UTC
    const target = new Date(wall);
    const matches = (t) => {
        const p = localParts(z, t);
        return p.year === target.getUTCFullYear() && p.month === target.getUTCMonth() + 1 && p.day === target.getUTCDate() && p.hour === 0 && p.minute === 0 && p.second === 0;
    };
    const candidates = [...new Set([wall - offsetMs(z, wall - DAY), wall - offsetMs(z, wall), wall - offsetMs(z, wall + DAY)])].filter(matches);
    if (candidates.length) return Math.min(...candidates); // earliest when the midnight happens twice
    // No such midnight (clocks jumped over it): the day starts at the first instant after the gap.
    return wall - offsetMs(z, wall - DAY);
}

const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** The local calendar date ("YYYY-MM-DD") of `instant` in `zone`. */
function dayKey(zone, instant = Date.now()) {
    const p = localParts(zone, instant);
    return key(p.year, p.month, p.day);
}

/** Start (00:00 local) of the local day containing `instant`, as a Date. */
function dayStart(zone, instant = Date.now()) {
    const p = localParts(zone, instant);
    return new Date(localMidnight(zone, p.year, p.month, p.day));
}

/** Start of the day after the one containing `instant`. */
function nextDayStart(zone, instant = Date.now()) {
    const p = localParts(zone, instant);
    return new Date(localMidnight(zone, p.year, p.month, p.day + 1));
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date. */
function isoWeekday(y, m, d) {
    return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Monday 00:00 local of the week containing `instant`. */
function weekStart(zone, instant = Date.now()) {
    const p = localParts(zone, instant);
    return new Date(localMidnight(zone, p.year, p.month, p.day - (isoWeekday(p.year, p.month, p.day) - 1)));
}

/** Monday 00:00 local after the week containing `instant`. */
function nextWeekStart(zone, instant = Date.now()) {
    const p = localParts(zone, instant);
    return new Date(localMidnight(zone, p.year, p.month, p.day - (isoWeekday(p.year, p.month, p.day) - 1) + 7));
}

/** The 1st 00:00 local of the month containing `instant`. */
function monthStart(zone, instant = Date.now()) {
    const p = localParts(zone, instant);
    return new Date(localMidnight(zone, p.year, p.month, 1));
}

/** The 1st 00:00 local of the month after the one containing `instant`. */
function nextMonthStart(zone, instant = Date.now()) {
    const p = localParts(zone, instant);
    return new Date(localMidnight(zone, p.year, p.month + 1, 1));
}

/** Local date key ("YYYY-MM-DD") of the week's Monday, month's first day, or the day, for `kind`. */
function periodKey(zone, kind, instant = Date.now()) {
    const start = kind === 'weekly' ? weekStart(zone, instant) : kind === 'monthly' ? monthStart(zone, instant) : dayStart(zone, instant);
    return dayKey(zone, start);
}

module.exports = {
    resolveZone,
    localParts,
    offsetMs,
    dayKey,
    dayStart,
    nextDayStart,
    weekStart,
    nextWeekStart,
    monthStart,
    nextMonthStart,
    periodKey
};
