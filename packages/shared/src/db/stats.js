/**
 * Read-only statistics for the web "Stats" page: XP and completed tasks per day (in the user's own time zone), and a 30 day summary.
 * Every query is scoped by discord_id and bounded by a capped date range. Nothing here writes.
 */

'use strict';

const { getPool } = require('./pool');
const { userZone } = require('./progression');
const { getUserSkills } = require('./users');
const { liveStreak } = require('../xp');
const tz = require('../tz');
const { actorSql } = require('./access');
const { WEEKLY_XP_SOURCES } = require('../constants');

/** Ranges the API accepts (also the cap: nothing larger is ever queried). */
const HISTORY_RANGES = [7, 30, 90];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Display names for xp_transactions.source values (anything unknown is title-cased from its key). */
const SOURCE_LABELS = {
    list_create: 'Creating quests',
    item_add: 'Adding tasks',
    item_complete: 'Completing tasks',
    daily: 'Daily reward',
    game_reward: 'Games',
    quest_reward: 'Quests',
    first_of_day: 'First of the day',
    list_cleared: 'Cleared lists',
    early_finish: 'Early finishes',
    overdue_clear: 'Overdue clears',
    subtasks_done: 'Subtasks done',
    streak_chest: 'Streak chests',
    achievement_reward: 'Achievements',
    habit_bonus: 'Habit bonus',
    focus_session: 'Focus sessions',
    weekly_review: 'Weekly review',
    party_quest: 'Party quest',
    perfect_day: 'Perfect days',
    inbox_zero: 'Inbox zero',
    boss_defeated: 'Bosses defeated',
    comeback: 'Welcome back',
    reflection: 'Reflections',
    weekly_goal: 'Weekly goals',
    party_assist: 'Party assist',
    estimate_accuracy: 'Good estimates'
};

function sourceLabel(source) {
    if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
    const text = String(source).replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

const marks = () => WEEKLY_XP_SOURCES.map(() => '?').join(', ');

/** Start instants of the user's last `n` local days (today included), oldest first, plus the end of today. */
function dayStarts(zone, now, n) {
    const starts = [tz.dayStart(zone, now)];
    while (starts.length < n) starts.unshift(tz.dayStart(zone, new Date(starts[0].getTime() - 1))); // 1 ms earlier is the previous local day
    return { starts, end: tz.nextDayStart(zone, now) };
}

/**
 * Per-15-minute totals, so a day in any zone (offsets are whole quarter hours) can be summed in JS without
 * the database knowing the zone. `expr` is a timestamp column, `select` an aggregate over the rows.
 */
const QUARTER = 900;
const bucketSql = (column) => `FLOOR(EXTRACT(EPOCH FROM ${column}) / ${QUARTER})::bigint`;
const bucketTime = (b) => new Date(Number(b) * QUARTER * 1000);

/** A positive whole number of days from the allowed ranges; anything else throws a RangeError. */
function checkDays(days) {
    const n = Number(days);
    if (!HISTORY_RANGES.includes(n)) throw new RangeError(`days must be one of ${HISTORY_RANGES.join(', ')}`);
    return n;
}

/**
 * XP earned and tasks first completed on each of the last `days` days of the user's own time zone (today included),
 * oldest first. Days without activity are present with zeros. Only earning sources count (spending never lowers a day).
 * @returns {Promise<Array<{ date: string, xp: number, tasksCompleted: number }>>}
 */
async function getXPHistory(discordId, days = 30, now = new Date()) {
    const n = checkDays(days);
    const id = String(discordId);
    const pool = getPool();
    const zone = await userZone(pool, id);
    const { starts, end } = dayStarts(zone, now, n);
    const from = starts[0];
    const [[xpRows], [taskRows]] = await Promise.all([
        pool.query(
            `SELECT ${bucketSql('created_at')} AS b, COALESCE(SUM(amount), 0) AS xp
             FROM xp_transactions
             WHERE discord_id = ? AND amount > 0 AND created_at >= ? AND created_at < ? AND source IN (${marks()})
             GROUP BY b`,
            [id, from, end, ...WEEKLY_XP_SOURCES]
        ),
        pool.query(
            `SELECT ${bucketSql('i.first_completed_at')} AS b, COUNT(*) AS n
             FROM items i
             WHERE ${actorSql('first_completed_by')} AND i.first_completed_at >= ? AND i.first_completed_at < ?
             GROUP BY b`,
            [id, id, from, end]
        )
    ]);
    const sumByDay = (rows, field) => {
        const out = new Map();
        for (const r of rows) {
            const key = tz.dayKey(zone, bucketTime(r.b));
            out.set(key, (out.get(key) || 0) + Number(r[field]));
        }
        return out;
    };
    const xpByDay = sumByDay(xpRows, 'xp');
    const tasksByDay = sumByDay(taskRows, 'n');
    return starts.map((start) => {
        const date = tz.dayKey(zone, start);
        return { date, xp: xpByDay.get(date) || 0, tasksCompleted: tasksByDay.get(date) || 0 };
    });
}

/**
 * Headline numbers (all in the user's own time zone): the current streak, tasks completed in the last 7 days, XP earned
 * per source in the last 30 (largest first) and the weekday with the most completions over the last 90 days (null with no history).
 */
async function getStatsSummary(discordId, now = new Date()) {
    const id = String(discordId);
    const pool = getPool();
    const zone = await userZone(pool, id);
    const { starts, end } = dayStarts(zone, now, 90);
    const since = (n) => starts[starts.length - n];
    const [[[user]], skills, [[done]], [sources], [weekdayRows]] = await Promise.all([
        pool.query('SELECT timezone, player_class, streak_count, last_daily_claim FROM users WHERE discord_id = ?', [id]),
        getUserSkills(id),
        pool.query(
            `SELECT COUNT(*) AS n FROM items i
             WHERE ${actorSql('first_completed_by')} AND i.first_completed_at >= ? AND i.first_completed_at < ?`,
            [id, id, since(7), end]
        ),
        pool.query(
            `SELECT source, SUM(amount) AS xp FROM xp_transactions
             WHERE discord_id = ? AND amount > 0 AND created_at >= ? AND created_at < ? AND source IN (${marks()})
             GROUP BY source ORDER BY xp DESC, source ASC`,
            [id, since(30), end, ...WEEKLY_XP_SOURCES]
        ),
        pool.query(
            `SELECT ${bucketSql('i.first_completed_at')} AS b, COUNT(*) AS n
             FROM items i
             WHERE ${actorSql('first_completed_by')} AND i.first_completed_at >= ? AND i.first_completed_at < ?
             GROUP BY b`,
            [id, id, since(90), end]
        )
    ]);
    const perWeekday = new Array(7).fill(0); // 0 = Sunday
    for (const r of weekdayRows) {
        const [y, m, d] = tz.dayKey(zone, bucketTime(r.b)).split('-').map(Number);
        perWeekday[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] += Number(r.n);
    }
    const best = Math.max(...perWeekday);
    const index = perWeekday.indexOf(best); // ties go to the earliest weekday, Sunday first
    return {
        // The live streak, as Today shows it: 0 once it has lapsed, even before a claim resets the stored count.
        streak: user ? liveStreak(user, skills, now.getTime()) : 0,
        tasksCompleted7d: Number(done.n),
        xpBySource30d: sources.map((r) => ({ source: r.source, label: sourceLabel(r.source), xp: Number(r.xp) })),
        busiestWeekday: best > 0 ? { index, name: WEEKDAYS[index], count: best } : null
    };
}

module.exports = { getXPHistory, getStatsSummary, sourceLabel, HISTORY_RANGES };
