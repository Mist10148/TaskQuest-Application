/**
 * Read-only statistics for the web "Stats" page: XP and completed tasks per UTC day, and a 30 day summary.
 * Every query is scoped by discord_id and bounded by a capped date range. Nothing here writes.
 */

'use strict';

const { getPool } = require('./pool');
const { WEEKLY_XP_SOURCES } = require('../constants');

const DAY = 86400e3;
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
    weekly_review: 'Weekly review'
};

function sourceLabel(source) {
    if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
    const text = String(source).replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

const startOfUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const isoDay = (date) => date.toISOString().slice(0, 10);
const marks = () => WEEKLY_XP_SOURCES.map(() => '?').join(', ');

/** A positive whole number of days from the allowed ranges; anything else throws a RangeError. */
function checkDays(days) {
    const n = Number(days);
    if (!HISTORY_RANGES.includes(n)) throw new RangeError(`days must be one of ${HISTORY_RANGES.join(', ')}`);
    return n;
}

/**
 * XP earned and tasks first completed on each of the last `days` UTC days (today included), oldest first.
 * Days without activity are present with zeros. Only earning sources count (spending never lowers a day).
 * @returns {Promise<Array<{ date: string, xp: number, tasksCompleted: number }>>}
 */
async function getXPHistory(discordId, days = 30, now = new Date()) {
    const n = checkDays(days);
    const id = String(discordId);
    const today = startOfUtcDay(now);
    const from = new Date(today.getTime() - (n - 1) * DAY);
    const to = new Date(today.getTime() + DAY);
    const pool = getPool();
    const [[xpRows], [taskRows]] = await Promise.all([
        pool.query(
            `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COALESCE(SUM(amount), 0) AS xp
             FROM xp_transactions
             WHERE discord_id = ? AND amount > 0 AND created_at >= ? AND created_at < ? AND source IN (${marks()})
             GROUP BY d`,
            [id, from, to, ...WEEKLY_XP_SOURCES]
        ),
        pool.query(
            `SELECT DATE_FORMAT(i.first_completed_at, '%Y-%m-%d') AS d, COUNT(*) AS n
             FROM items i JOIN lists l ON l.id = i.list_id
             WHERE l.discord_id = ? AND i.first_completed_at >= ? AND i.first_completed_at < ?
             GROUP BY d`,
            [id, from, to]
        )
    ]);
    const xpByDay = new Map(xpRows.map((r) => [r.d, Number(r.xp)]));
    const tasksByDay = new Map(taskRows.map((r) => [r.d, Number(r.n)]));
    const out = [];
    for (let i = 0; i < n; i++) {
        const date = isoDay(new Date(from.getTime() + i * DAY));
        out.push({ date, xp: xpByDay.get(date) || 0, tasksCompleted: tasksByDay.get(date) || 0 });
    }
    return out;
}

/**
 * Headline numbers: the current streak, tasks completed in the last 7 days, XP earned per source in the last 30
 * (largest first) and the weekday with the most completions over the last 90 days (null with no history).
 */
async function getStatsSummary(discordId, now = new Date()) {
    const id = String(discordId);
    const today = startOfUtcDay(now);
    const end = new Date(today.getTime() + DAY);
    const since = (n) => new Date(today.getTime() - (n - 1) * DAY);
    const pool = getPool();
    const [[[user]], [[done]], [sources], [weekdays]] = await Promise.all([
        pool.query('SELECT streak_count FROM users WHERE discord_id = ?', [id]),
        pool.query(
            `SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.id = i.list_id
             WHERE l.discord_id = ? AND i.first_completed_at >= ? AND i.first_completed_at < ?`,
            [id, since(7), end]
        ),
        pool.query(
            `SELECT source, SUM(amount) AS xp FROM xp_transactions
             WHERE discord_id = ? AND amount > 0 AND created_at >= ? AND created_at < ? AND source IN (${marks()})
             GROUP BY source ORDER BY xp DESC, source ASC`,
            [id, since(30), end, ...WEEKLY_XP_SOURCES]
        ),
        pool.query(
            `SELECT DAYOFWEEK(i.first_completed_at) AS dow, COUNT(*) AS n
             FROM items i JOIN lists l ON l.id = i.list_id
             WHERE l.discord_id = ? AND i.first_completed_at >= ? AND i.first_completed_at < ?
             GROUP BY dow ORDER BY n DESC, dow ASC LIMIT 1`,
            [id, since(90), end]
        )
    ]);
    const top = weekdays[0];
    return {
        streak: user ? Number(user.streak_count) : 0,
        tasksCompleted7d: Number(done.n),
        xpBySource30d: sources.map((r) => ({ source: r.source, label: sourceLabel(r.source), xp: Number(r.xp) })),
        busiestWeekday: top ? { index: Number(top.dow) - 1, name: WEEKDAYS[Number(top.dow) - 1], count: Number(top.n) } : null
    };
}

module.exports = { getXPHistory, getStatsSummary, sourceLabel, HISTORY_RANGES };
