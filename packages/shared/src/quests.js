/** Quest periods (pure). Every period is UTC, like every other daily limit. */

'use strict';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * The period containing `now`: daily = the UTC day, weekly = Monday 00:00 UTC to the next Monday,
 * monthly = the first of the UTC month to the first of the next.
 * @returns {{ start: string, startsAt: Date, endsAt: Date }} `start` is the YYYY-MM-DD used as the claim key.
 */
function questPeriod(kind, now = new Date()) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let startsAt = day;
    let length = 1;
    if (kind === 'weekly') {
        const sinceMonday = (day.getUTCDay() + 6) % 7;
        startsAt = new Date(day.getTime() - sinceMonday * 86400e3);
        length = 7;
    }
    if (kind === 'monthly') {
        startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return { start: ymd(startsAt), startsAt, endsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
    }
    return { start: ymd(startsAt), startsAt, endsAt: new Date(startsAt.getTime() + length * 86400e3) };
}

/** ISO 8601 week number (1-53): the week belongs to the year that holds its Thursday. */
function isoWeek(now = new Date()) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const thursday = new Date(day.getTime() + (3 - ((day.getUTCDay() + 6) % 7)) * 86400e3);
    const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
    return Math.floor((thursday.getTime() - jan1) / (7 * 86400e3)) + 1;
}

/** The rotating weekly quest that is live at `now` (its key), chosen by ISO week number mod 4. */
function activeRotatingQuest(rotation, now = new Date()) {
    return rotation[isoWeek(now) % rotation.length];
}

module.exports = { questPeriod, isoWeek, activeRotatingQuest };
