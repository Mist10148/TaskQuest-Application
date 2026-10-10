/** Quest periods (pure). Both periods are UTC, like every other daily limit. */

'use strict';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * The period containing `now`: daily = the UTC day, weekly = Monday 00:00 UTC to the next Monday.
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
    return { start: ymd(startsAt), startsAt, endsAt: new Date(startsAt.getTime() + length * 86400e3) };
}

module.exports = { questPeriod };
