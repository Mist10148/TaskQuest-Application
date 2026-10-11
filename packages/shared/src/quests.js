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

/** The rotating weekly quest that is live at `now` (its key), chosen by the local ISO week number mod 4. */
function activeRotatingQuest(rotation, now = new Date(), zone = null) {
    return rotation[isoWeek(now, zone) % rotation.length];
}

module.exports = { questPeriod, isoWeek, activeRotatingQuest };
