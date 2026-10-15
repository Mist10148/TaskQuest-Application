/**
 * The Today screen in one read: what needs doing now, how the day is going, the weekly modifier, your streak and the
 * reflection and goal cards. Read only; nothing here changes XP.
 */

'use strict';

const { getPool } = require('./pool');
const { getUserSkills } = require('./users');
const { dayWindow } = require('./progression');
const { getReflection, getGoal } = require('./goals');
const { SEASONS } = require('../constants');
const { currentSeason } = require('../quests');
const { todayInZone, daysBetween } = require('../dates');
const { liveStreak, getSkillBonuses, streakWindowDays, claimGapDays } = require('../xp');

const TASK_LIMIT = 6;

/** The streak as the Today card needs it: is it alive, was today's reward claimed, is today the last day to keep it. */
function streakState(user, skills, now) {
    const count = Number(user.streak_count) || 0;
    const last = user.last_daily_claim ? new Date(user.last_daily_claim).getTime() : 0;
    const live = liveStreak(user, skills, now.getTime());
    const bonuses = getSkillBonuses(skills);
    const claimedToday = Boolean(last) && claimGapDays(user, last, now.getTime()) === 0;
    // Unstoppable never lapses; otherwise the claim has `windowDays - gap` days left, today included at zero.
    const daysLeft = bonuses.streakUnstoppable || !last ? null : streakWindowDays(user, bonuses) - claimGapDays(user, last, now.getTime());
    return { count, live, claimedToday, daysLeft, atRisk: live >= 2 && !claimedToday && daysLeft === 0 };
}

async function getToday(discordId, now = new Date()) {
    const id = String(discordId);
    const pool = getPool();
    const [[user]] = await pool.query(
        'SELECT discord_id, timezone, streak_count, last_daily_claim, player_class, prestige, gamification_enabled FROM users WHERE discord_id = ?',
        [id]
    );
    const u = user || { discord_id: id, timezone: null, streak_count: 0, last_daily_claim: null, player_class: 'DEFAULT', gamification_enabled: 1 };
    const today = todayInZone(u.timezone, now);
    const { from, to } = await dayWindow(pool, u, now);
    const skills = await getUserSkills(id);

    // What needs doing: open top-level tasks on your own lists that are overdue, due today or HIGH priority.
    const [rows] = await pool.query(
        `SELECT i.id, i.name, i.list_id, l.name AS list_name, i.due_date, COALESCE(i.priority, l.priority) AS priority, i.estimate_minutes
           FROM items i JOIN lists l ON l.id = i.list_id
          WHERE l.discord_id = ? AND i.completed = 0 AND i.parent_id IS NULL
            AND (i.due_date <= ? OR COALESCE(i.priority, l.priority) = 'HIGH')
          ORDER BY (i.due_date IS NULL), i.due_date ASC, FIELD(COALESCE(i.priority, l.priority), 'HIGH', 'MEDIUM', 'LOW'), i.id
          LIMIT ${TASK_LIMIT}`,
        [id, today]
    );
    const [[counts]] = await pool.query(
        `SELECT COALESCE(SUM(i.due_date = ?), 0) AS dueToday, COALESCE(SUM(i.due_date < ?), 0) AS overdue
           FROM items i JOIN lists l ON l.id = i.list_id
          WHERE l.discord_id = ? AND i.completed = 0 AND i.parent_id IS NULL`,
        [today, today, id]
    );
    const [[done]] = await pool.query('SELECT COUNT(*) AS n FROM items WHERE first_completed_by = ? AND first_completed_at >= ? AND first_completed_at < ?', [id, from, to]);

    const season = currentSeason(SEASONS, now);
    return {
        day: today,
        season: { key: season.key, name: season.name, blurb: season.blurb, doubles: season.doubles, enabled: process.env.XP_WEEKLY_MODIFIER !== 'off' },
        streak: streakState(u, skills, now),
        counts: { dueToday: Number(counts.dueToday), overdue: Number(counts.overdue), doneToday: Number(done.n) },
        tasks: rows.map((r) => {
            const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
            return {
                id: r.id,
                name: r.name,
                listId: r.list_id,
                listName: r.list_name,
                dueDate: due,
                priority: r.priority || null,
                estimateMinutes: r.estimate_minutes === null || r.estimate_minutes === undefined ? null : Number(r.estimate_minutes),
                overdueDays: due && due < today ? daysBetween(due, today) : 0
            };
        }),
        reflection: await getReflection(id, now),
        goal: await getGoal(id, now),
        xpEnabled: Boolean(u.gamification_enabled)
    };
}

module.exports = { getToday, streakState };
