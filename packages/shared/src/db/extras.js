/**
 * Engagement bonuses paid on a task's first, paid completion (see completionBonuses in tasks.js): perfect day,
 * inbox zero, a boss defeated, a welcome back, a good estimate and a party assist. Like the other task bonuses they are flat XP
 * (no class or skill modifiers), each has its own cap, and they never repeat for the same thing.
 */

'use strict';

const { REWARDS, LIMITS, BONUS_LABELS } = require('../constants');
const tz = require('../tz');
const { awardFlat, countToday } = require('./progression');

const DAY_MS = 86400e3;
/** A focus session counts as the one a task was done in when it ended at most this long before the completion. */
const ESTIMATE_WINDOW_MINUTES = 10;

/** Rows of `source` the user earned in their current week (Monday to Monday in their zone). */
async function countThisWeek(conn, user, source, now) {
    const [[row]] = await conn.query(
        'SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = ? AND created_at >= ? AND created_at < ?',
        [user.discord_id, source, tz.weekStart(user.timezone, now), tz.nextWeekStart(user.timezone, now)]
    );
    return Number(row.n);
}

/**
 * @param {object} item the completed task row
 * @param {object} ctx  completionContext (today, overdueDays ...)
 * @returns {Promise<Array<{ key: string, label: string, xp: number }>>}
 */
async function completionExtras(conn, user, item, ctx, now = new Date()) {
    const out = [];
    const pay = async (key, amount, opts = {}) => {
        const r = await awardFlat(conn, user, key, amount, opts);
        if (r) out.push({ key, label: BONUS_LABELS[key], xp: r.xp });
        return r;
    };
    // A due date only counts once it was set at least DUE_DATE_MIN_AGE_HOURS ago (as for the early and overdue bonuses), so three
    // tasks given today's date and ticked off at once are not a perfect day.
    const plannedBy = new Date(now.getTime() - LIMITS.DUE_DATE_MIN_AGE_HOURS * 3600e3);
    const dueToday = item.due_date && String(item.due_date).slice(0, 10) === ctx.today;

    // Perfect day: every top-level task due today on your own lists is done (at least 3 of them planned ahead), once a day.
    if (dueToday && (await countToday(conn, user, 'perfect_day', now)) === 0) {
        const [[due]] = await conn.query(
            `SELECT COUNT(*) FILTER (WHERE i.due_date_set_at <= ?) AS planned, COUNT(*) FILTER (WHERE i.completed = 0) AS open
               FROM items i JOIN lists l ON l.id = i.list_id
              WHERE l.discord_id = ? AND i.parent_id IS NULL AND i.due_date = ?`,
            [plannedBy, user.discord_id, ctx.today]
        );
        if (Number(due.planned) >= LIMITS.PERFECT_DAY_MIN_TASKS && Number(due.open) === 0) await pay('perfect_day', REWARDS.PERFECT_DAY, { referenceId: item.id });
    }

    // Inbox zero: this completion cleared the last overdue task, after at least 3 overdue ones this week, once a week.
    if (ctx.overdueDays > 0 && (await countThisWeek(conn, user, 'inbox_zero', now)) === 0) {
        const [[open]] = await conn.query(
            `SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.id = i.list_id
              WHERE l.discord_id = ? AND i.parent_id IS NULL AND i.completed = 0 AND i.due_date < ?`,
            [user.discord_id, ctx.today]
        );
        if (Number(open.n) === 0) {
            const [[done]] = await conn.query(
                'SELECT COUNT(*) AS n FROM items WHERE first_completed_by = ? AND first_completed_overdue = 1 AND first_completed_at >= ?',
                [user.discord_id, tz.weekStart(user.timezone, now)]
            );
            if (Number(done.n) >= LIMITS.INBOX_ZERO_MIN_OVERDUE) await pay('inbox_zero', REWARDS.INBOX_ZERO, { referenceId: item.id });
        }
    }

    // Boss defeated: finishing the last open subtask of a task with at least 4 subtasks, once per boss.
    if (item.parent_id) {
        const [[subs]] = await conn.query('SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE completed = 0) AS open FROM items WHERE parent_id = ?', [item.parent_id]);
        if (Number(subs.total) >= LIMITS.BOSS_MIN_SUBTASKS && Number(subs.open) === 0) {
            const [[paid]] = await conn.query("SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'boss_defeated' AND reference_id = ?", [user.discord_id, item.parent_id]);
            if (Number(paid.n) === 0) await pay('boss_defeated', REWARDS.BOSS_DEFEATED, { dailyCap: LIMITS.BOSS_XP_PER_DAY, referenceId: item.parent_id });
        }
    }

    // Welcome back: the first completion after 3 idle days (the previous paid completion is older), at most once a week.
    const [recent] = await conn.query("SELECT created_at FROM xp_transactions WHERE discord_id = ? AND source = 'item_complete' ORDER BY id DESC LIMIT 2", [user.discord_id]);
    if (recent.length === 2 && now.getTime() - new Date(recent[1].created_at).getTime() >= LIMITS.COMEBACK_AFTER_DAYS * DAY_MS) {
        const [[again]] = await conn.query(
            "SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = 'comeback' AND created_at >= ?",
            [user.discord_id, new Date(now.getTime() - LIMITS.COMEBACK_COOLDOWN_DAYS * DAY_MS)]
        );
        if (Number(again.n) === 0) await pay('comeback', REWARDS.COMEBACK, { referenceId: item.id });
    }

    // Good estimate: you guessed the task's length within 25% and finished it right after a focus session of about that length.
    if (item.estimate_minutes) {
        const [[session]] = await conn.query(
            "SELECT minutes_credited FROM focus_sessions WHERE discord_id = ? AND state = 'finished' AND finished_at <= ? AND finished_at >= ? ORDER BY finished_at DESC LIMIT 1",
            [user.discord_id, now, new Date(now.getTime() - ESTIMATE_WINDOW_MINUTES * 60e3)]
        );
        const estimate = Number(item.estimate_minutes);
        if (session && Number(session.minutes_credited) > 0 && (Math.abs(estimate - Number(session.minutes_credited)) * 100) / estimate <= LIMITS.ESTIMATE_TOLERANCE_PERCENT) {
            await pay('estimate_accuracy', REWARDS.ESTIMATE_ACCURACY, { dailyCap: LIMITS.ESTIMATE_XP_PER_DAY, referenceId: item.id });
        }
    }

    // Party assist: a few XP for every completion while you are in a party of two or more, 15 a day.
    const [[party]] = await conn.query(
        'SELECT (SELECT COUNT(*) FROM party_members x WHERE x.party_id = pm.party_id) AS people FROM party_members pm WHERE pm.discord_id = ?',
        [user.discord_id]
    );
    if (party && Number(party.people) >= 2) await pay('party_assist', REWARDS.PARTY_ASSIST, { dailyCap: LIMITS.PARTY_ASSIST_XP_PER_DAY, referenceId: item.id });

    return out;
}

module.exports = { completionExtras };
