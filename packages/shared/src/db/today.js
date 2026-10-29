/**
 * The Today screen in one read: what needs doing now, how the day is going, the weekly modifier, your streak and the
 * reflection and goal cards. Read only; nothing here changes XP.
 */

'use strict';

const { getPool } = require('./pool');
const { STREAK_WARNING, DAILY } = require('../constants');
const { getUserSkills } = require('./users');
const { actorSql } = require('./access');
const { dayWindow } = require('./progression');
const { getReflection, getGoal } = require('./goals');
const { SEASONS } = require('../constants');
const { currentSeason } = require('../quests');
const { todayInZone, daysBetween, hourInZone } = require('../dates');
const { liveStreak, getSkillBonuses, streakWindowDays, streakWindowMs, claimGapDays } = require('../xp');
const tz = require('../tz');

const TASK_LIMIT = 6;
/** The Upcoming list: open top-level tasks due in the next week (not already in the main list). */
const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 6;

/**
 * The tasks that are "mine" for Today: every task on a list I own, plus the tasks assigned to me on a list shared with me (the
 * membership is checked too, although leaving a list already clears its assignments). One row per task, so nothing counts twice.
 * Binds `me` three times. The item is aliased `i`, its list `l`.
 */
const MINE = `(l.discord_id = ? OR (i.assignee_id = ? AND EXISTS (SELECT 1 FROM list_members tm WHERE tm.list_id = l.id AND tm.discord_id = ?)))`;

/**
 * When a streak last claimed at `last` lapses: the later of the end of its calendar window and the end of its rolling window,
 * since a claim within either continues it (streakContinues).
 */
function streakExpiry(user, bonuses, last) {
    let calendarEnd = last;
    for (let i = 0; i <= streakWindowDays(user, bonuses); i++) calendarEnd = tz.nextDayStart(user.timezone, calendarEnd).getTime();
    return Math.max(calendarEnd, last + streakWindowMs(user, bonuses));
}

/**
 * The streak as the Today card needs it: is it alive, was today's reward claimed, is today the last day to keep it, and when
 * can it be claimed and when does it lapse. It is at risk only once the daily reward can actually be claimed again (the
 * 24 hour cooldown), so a warning never asks for a claim the cooldown would refuse.
 */
function streakState(user, skills, now) {
    const count = Number(user.streak_count) || 0;
    const last = user.last_daily_claim ? new Date(user.last_daily_claim).getTime() : 0;
    const live = liveStreak(user, skills, now.getTime());
    const bonuses = getSkillBonuses(skills);
    const claimedToday = Boolean(last) && claimGapDays(user, last, now.getTime()) === 0;
    // Unstoppable never lapses; otherwise the claim has `windowDays - gap` days left, today included at zero. Below zero the
    // streak is only alive through the rolling grace window (a late claim), which is just as much at risk.
    const lapses = !bonuses.streakUnstoppable && Boolean(last);
    const daysLeft = lapses ? Math.max(0, streakWindowDays(user, bonuses) - claimGapDays(user, last, now.getTime())) : null;
    const claimableAt = last ? last + DAILY.COOLDOWN_MS : null;
    const expiresAt = lapses ? streakExpiry(user, bonuses, last) : null;
    const claimable = !claimableAt || now.getTime() >= claimableAt;
    return {
        count,
        live,
        claimedToday,
        daysLeft,
        claimableAt: claimableAt ? new Date(claimableAt).toISOString() : null,
        expiresAt: live && expiresAt ? new Date(expiresAt).toISOString() : null,
        atRisk: live >= 2 && !claimedToday && daysLeft === 0 && claimable
    };
}

function shapeTask(r, today) {
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

    // What needs doing: open top-level tasks on your own lists, or assigned to you on a shared one, that are overdue, due today or HIGH priority.
    const [rows] = await pool.query(
        `SELECT i.id, i.name, i.list_id, l.name AS list_name, i.due_date, COALESCE(i.priority, l.priority) AS priority, i.estimate_minutes
           FROM items i JOIN lists l ON l.id = i.list_id
          WHERE ${MINE} AND i.completed = 0 AND i.parent_id IS NULL
            AND (i.due_date <= ? OR COALESCE(i.priority, l.priority) = 'HIGH')
          ORDER BY (i.due_date IS NULL), i.due_date ASC, CASE COALESCE(i.priority, l.priority) WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END, i.id
          LIMIT ${TASK_LIMIT}`,
        [id, id, id, today]
    );
    const [[counts]] = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE i.due_date = ?) AS "dueToday", COUNT(*) FILTER (WHERE i.due_date < ?) AS overdue
           FROM items i JOIN lists l ON l.id = i.list_id
          WHERE ${MINE} AND i.completed = 0 AND i.parent_id IS NULL`,
        [today, today, id, id, id]
    );
    // Counted like Stats, the review and quests: older rows with no recorded actor count for the list owner.
    const [upcomingRows] = await pool.query(
        `SELECT i.id, i.name, i.list_id, l.name AS list_name, i.due_date, COALESCE(i.priority, l.priority) AS priority, i.estimate_minutes
           FROM items i JOIN lists l ON l.id = i.list_id
          WHERE ${MINE} AND i.completed = 0 AND i.parent_id IS NULL AND i.due_date > ?::date AND i.due_date <= ?::date + ${UPCOMING_DAYS}
          ORDER BY i.due_date ASC, CASE COALESCE(i.priority, l.priority) WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END, i.id
          LIMIT ${TASK_LIMIT + UPCOMING_LIMIT}`,
        [id, id, id, today, today]
    );
    const [[done]] = await pool.query(`SELECT COUNT(*) AS n FROM items i WHERE ${actorSql('first_completed_by')} AND i.first_completed_at >= ? AND i.first_completed_at < ?`, [id, id, from, to]);

    const season = currentSeason(SEASONS, now);
    return {
        day: today,
        season: { key: season.key, name: season.name, blurb: season.blurb, doubles: season.doubles, enabled: process.env.XP_WEEKLY_MODIFIER !== 'off' },
        streak: streakState(u, skills, now),
        counts: { dueToday: Number(counts.dueToday), overdue: Number(counts.overdue), doneToday: Number(done.n) },
        tasks: rows.map((r) => shapeTask(r, today)),
        // A HIGH task due this week is already in `tasks`; it is not listed twice.
        upcoming: upcomingRows
            .filter((r) => !rows.some((t) => t.id === r.id))
            .slice(0, UPCOMING_LIMIT)
            .map((r) => shapeTask(r, today)),
        reflection: await getReflection(id, now),
        goal: await getGoal(id, now),
        xpEnabled: Boolean(u.gamification_enabled)
    };
}

/**
 * Players to warn right now: a streak of at least 3 days that is alive and unclaimed today, today is its last day, and it is
 * evening where they live. Only people with XP and reminders on, and not already warned today.
 * @returns {Promise<Array<{ discord_id: string, streak: number, day: string, timezone: string|null, expiresAt: string|null }>>}
 */
async function getStreakWarnings(now = new Date()) {
    const pool = getPool();
    const [rows] = await pool.query(
        `SELECT discord_id, timezone, streak_count, last_daily_claim, player_class, streak_warned_day FROM users
          WHERE gamification_enabled = 1 AND automation_enabled = 1 AND streak_count >= ? AND last_daily_claim >= ?`,
        [STREAK_WARNING.MIN_STREAK, new Date(now.getTime() - 6 * 86400e3)]
    );
    const out = [];
    for (const u of rows) {
        const day = todayInZone(u.timezone, now);
        if (hourInZone(u.timezone, now) < STREAK_WARNING.FROM_HOUR) continue;
        if (u.streak_warned_day && String(u.streak_warned_day).slice(0, 10) >= day) continue;
        const state = streakState(u, await getUserSkills(u.discord_id), now);
        if (state.atRisk && state.live >= STREAK_WARNING.MIN_STREAK) out.push({ discord_id: String(u.discord_id), streak: state.live, day, timezone: u.timezone, expiresAt: state.expiresAt });
    }
    return out;
}

/** Atomically mark the warning as sent for `day`: true for exactly one caller. */
async function claimStreakWarning(discordId, day) {
    const [res] = await getPool().query('UPDATE users SET streak_warned_day = ? WHERE discord_id = ? AND (streak_warned_day IS NULL OR streak_warned_day < ?)', [day, String(discordId), day]);
    return res.affectedRows > 0;
}

/** Give the mark back after a temporary send failure, so the next run tries again. */
async function releaseStreakWarning(discordId, day) {
    await getPool().query('UPDATE users SET streak_warned_day = NULL WHERE discord_id = ? AND streak_warned_day = ?', [String(discordId), day]);
}

module.exports = { getToday, streakState, getStreakWarnings, claimStreakWarning, releaseStreakWarning };
