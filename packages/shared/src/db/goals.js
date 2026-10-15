/**
 * Daily reflection and weekly goal: two small, player-driven XP sources (migration 024).
 *
 *  - Reflection: one short note a day (your day, your time zone) pays a flat bonus once. The unique (user, day) row is what
 *    makes it pay once. The note is kept even when XP is off; only the XP is skipped.
 *  - Weekly goal: pick how many tasks you will finish this week (3 to 60). Finish them and claim a flat reward of
 *    10 + 2 XP per task (at most 80), once a week. The goal has to be above what you have already finished this week,
 *    so it cannot be set after the fact.
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser } = require('./users');
const { awardFlat, requireGamification, unlockAchievements } = require('./progression');
const { completedThisWeek } = require('./review');
const { errors } = require('../errors');
const { REWARDS, LIMITS } = require('../constants');
const { questPeriod } = require('../quests');
const { todayInZone } = require('../dates');
const v = require('../validation');

// ─── Reflection ──────────────────────────────────────────────────────────────

/** Today's reflection (your day) or null. */
async function getReflection(discordId, now = new Date()) {
    const conn = await getPool().getConnection();
    try {
        const [[user]] = await conn.query('SELECT timezone FROM users WHERE discord_id = ?', [String(discordId)]);
        const day = todayInZone(user ? user.timezone : null, now);
        const [[row]] = await conn.query('SELECT day, note, created_at FROM reflections WHERE discord_id = ? AND day = ?', [String(discordId), day]);
        return {
            day,
            reflection: row ? { day: String(row.day).slice(0, 10), note: row.note, createdAt: row.created_at } : null,
            reward: REWARDS.REFLECTION,
            maxLength: LIMITS.REFLECTION_MAX_LENGTH
        };
    } finally {
        conn.release();
    }
}

/** Write today's reflection (once a day). */
async function writeReflection(discordId, note, now = new Date()) {
    const text = v.reflection(note);
    if (!text.ok) throw errors.validation(text.error);
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const day = todayInZone(user.timezone, now);
        const [res] = await conn.query('INSERT IGNORE INTO reflections (discord_id, day, note) VALUES (?, ?, ?)', [user.discord_id, day, text.value]);
        if (res.affectedRows !== 1) throw errors.conflict("You already wrote today's reflection.");
        const previousLevel = Number(user.player_level);
        const paid = await awardFlat(conn, user, 'reflection', REWARDS.REFLECTION, { referenceId: res.insertId });
        const achievements = paid ? await unlockAchievements(conn, user) : [];
        return {
            day,
            note: text.value,
            xp: paid ? paid.xp : 0,
            balance: Number(user.player_xp),
            level: Number(user.player_level),
            leveledUp: Number(user.player_level) > previousLevel,
            achievements
        };
    });
}

// ─── Weekly goal ─────────────────────────────────────────────────────────────

/** The reward for a goal of `target` tasks. */
function goalReward(target) {
    return Math.min(LIMITS.WEEKLY_GOAL_MAX_XP, REWARDS.WEEKLY_GOAL_BASE + REWARDS.WEEKLY_GOAL_PER_TASK * target);
}

async function goalState(conn, user, now) {
    const period = questPeriod('weekly', now, user.timezone);
    const [[row]] = await conn.query('SELECT target, claimed_at FROM weekly_goals WHERE discord_id = ? AND week_key = ?', [user.discord_id, period.start]);
    const progress = await completedThisWeek(conn, user.discord_id, period);
    const target = row ? Number(row.target) : null;
    const claimed = Boolean(row && row.claimed_at);
    return {
        period,
        weekStart: period.start,
        resetsAt: period.endsAt.toISOString(),
        target,
        progress,
        claimed,
        claimable: Boolean(target) && !claimed && progress >= target && Boolean(user.gamification_enabled),
        reward: target ? goalReward(target) : null,
        min: LIMITS.WEEKLY_GOAL_MIN,
        max: LIMITS.WEEKLY_GOAL_MAX
    };
}

/** The goal state without the internal period. */
function publicGoal(s) {
    const { period, ...rest } = s; // eslint-disable-line no-unused-vars
    return rest;
}

/** This week's goal, how far along it is and whether it can be claimed. */
async function getGoal(discordId, now = new Date()) {
    const conn = await getPool().getConnection();
    try {
        const [[user]] = await conn.query('SELECT discord_id, timezone, gamification_enabled FROM users WHERE discord_id = ?', [String(discordId)]);
        const state = publicGoal(await goalState(conn, user || { discord_id: String(discordId), gamification_enabled: 1 }, now));
        return state;
    } finally {
        conn.release();
    }
}

/** Set (or raise or lower) this week's target. It must be above what is already finished, and not yet claimed. */
async function setGoal(discordId, target, now = new Date()) {
    const n = Number(target);
    if (!Number.isInteger(n) || n < LIMITS.WEEKLY_GOAL_MIN || n > LIMITS.WEEKLY_GOAL_MAX) {
        throw errors.validation(`The goal must be a whole number from ${LIMITS.WEEKLY_GOAL_MIN} to ${LIMITS.WEEKLY_GOAL_MAX} tasks.`);
    }
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const s = await goalState(conn, user, now);
        if (s.claimed) throw errors.conflict("This week's goal is already claimed.");
        if (n <= s.progress) throw errors.validation(`You have already finished ${s.progress} tasks this week: set a goal above that.`);
        await conn.query(
            'INSERT INTO weekly_goals (discord_id, week_key, target) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE target = VALUES(target)',
            [user.discord_id, s.weekStart, n]
        );
        const state = publicGoal(await goalState(conn, user, now));
        return state;
    });
}

/** Claim this week's goal reward (flat XP: no class or skill modifiers). */
async function claimGoal(discordId, now = new Date()) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        const s = await goalState(conn, user, now);
        if (!s.target) throw errors.validation('Set a goal for this week first.');
        if (s.claimed) throw errors.conflict("You already claimed this week's goal.");
        if (s.progress < s.target) throw errors.validation(`Finish ${s.target - s.progress} more tasks to reach your goal of ${s.target}.`);
        const [res] = await conn.query('UPDATE weekly_goals SET claimed_at = UTC_TIMESTAMP() WHERE discord_id = ? AND week_key = ? AND claimed_at IS NULL', [user.discord_id, s.weekStart]);
        if (res.affectedRows !== 1) throw errors.conflict("You already claimed this week's goal.");
        const previousLevel = Number(user.player_level);
        const paid = await awardFlat(conn, user, 'weekly_goal', goalReward(s.target), { referenceId: Number(String(s.weekStart).replace(/-/g, '')) });
        const achievements = await unlockAchievements(conn, user);
        return {
            weekStart: s.weekStart,
            target: s.target,
            xp: paid ? paid.xp : 0,
            balance: Number(user.player_xp),
            level: Number(user.player_level),
            leveledUp: Number(user.player_level) > previousLevel,
            achievements
        };
    });
}

module.exports = { getReflection, writeReflection, getGoal, setGoal, claimGoal, goalReward };
