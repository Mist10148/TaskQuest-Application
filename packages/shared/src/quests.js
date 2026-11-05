/** Quest periods (pure). Daily, weekly and monthly periods all follow the user's own time zone. */

'use strict';

const tz = require('./tz');

/**
 * The period containing `now` in `zone` (an IANA name; UTC when omitted or unknown): daily = the local day,
 * weekly = Monday 00:00 local to the next Monday, monthly = the first of the local month to the first of the next.
 * @returns {{ start: string, startsAt: Date, endsAt: Date }} `start` is the local YYYY-MM-DD used as the claim key.
 */
function questPeriod(kind, now = new Date(), zone = null) {
    if (kind === 'weekly') return { start: tz.periodKey(zone, 'weekly', now), startsAt: tz.weekStart(zone, now), endsAt: tz.nextWeekStart(zone, now) };
    if (kind === 'monthly') return { start: tz.periodKey(zone, 'monthly', now), startsAt: tz.monthStart(zone, now), endsAt: tz.nextMonthStart(zone, now) };
    return { start: tz.periodKey(zone, 'daily', now), startsAt: tz.dayStart(zone, now), endsAt: tz.nextDayStart(zone, now) };
}

/** ISO 8601 week number (1-53) of the local date at `now` in `zone`: the week belongs to the year that holds its Thursday. */
function isoWeek(now = new Date(), zone = null) {
    const [y, m, d] = tz.dayKey(zone, now).split('-').map(Number);
    const day = new Date(Date.UTC(y, m - 1, d));
    const thursday = new Date(day.getTime() + (3 - ((day.getUTCDay() + 6) % 7)) * 86400e3);
    const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
    return Math.floor((thursday.getTime() - jan1) / (7 * 86400e3)) + 1;
}

/** Monday 2025-12-29, the first day of ISO week 1 of 2026. */
const WEEK_EPOCH = Date.UTC(2025, 11, 29);

/**
 * A running week count for rotations: equal to the ISO week number for every week of 2026, and then simply counting on
 * (2027's first week is 54). An ISO week number would give week 53 and the next week 1 the same slot in a rotation of 4.
 */
function rotationWeek(now = new Date(), zone = null) {
    const [y, m, d] = tz.dayKey(zone, now).split('-').map(Number);
    const day = Date.UTC(y, m - 1, d);
    const monday = day - ((new Date(day).getUTCDay() + 6) % 7) * 86400e3;
    return Math.round((monday - WEEK_EPOCH) / (7 * 86400e3)) + 1;
}

const slot = (list, week) => list[((week % list.length) + list.length) % list.length];

/** The rotating weekly quest that is live at `now` (its key): one step along the rotation each local week. */
function activeRotatingQuest(rotation, now = new Date(), zone = null) {
    return slot(rotation, rotationWeek(now, zone));
}

/** The weekly modifier that is live at `now` (the UTC week, the same for everybody): see SEASONS in constants. */
function currentSeason(seasons, now = new Date()) {
    return slot(seasons, rotationWeek(now, null));
}

module.exports = { questPeriod, isoWeek, rotationWeek, activeRotatingQuest, currentSeason };
