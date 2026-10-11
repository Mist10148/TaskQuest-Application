/**
 * Weekly review: once per week in the user's own time zone (Monday 00:00 to Monday, like quests) a user who finished at least one task
 * can claim a flat bonus. The claim lives in quest_claims under a fixed key, so the unique
 * (user, key, week) row is what makes it pay once.
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser } = require('./users');
const { awardFlat, requireGamification, unlockAchievements } = require('./progression');
const { errors } = require('../errors');
const { REWARDS, LIMITS, WEEKLY_REVIEW_KEY, WEEKLY_XP_SOURCES } = require('../constants');
const { questPeriod } = require('../quests');
const { actorSql } = require('./access');

/** Tasks the user first completed (and was paid for) in the week, on any list they can use, never imported or auto-spawned copies. */
async function completedThisWeek(conn, discordId, period) {
    const [[row]] = await conn.query(
        `SELECT COUNT(*) AS n FROM items i
         WHERE ${actorSql('first_completed_by')} AND i.counts_for_quests = 1 AND i.first_completed_at >= ? AND i.first_completed_at < ?`,
        [discordId, discordId, period.startsAt, period.endsAt]
    );
    return Number(row.n);
}

async function reviewState(conn, user, now) {
    const period = questPeriod('weekly', now, user.timezone);
    const completed = await completedThisWeek(conn, user.discord_id, period);
    const marks = WEEKLY_XP_SOURCES.map(() => '?').join(', ');
    const [[xp]] = await conn.query(
        `SELECT COALESCE(SUM(amount), 0) AS n FROM xp_transactions
         WHERE discord_id = ? AND amount > 0 AND created_at >= ? AND created_at < ? AND source IN (${marks})`,
        [user.discord_id, period.startsAt, period.endsAt, ...WEEKLY_XP_SOURCES]
    );
    const [[claim]] = await conn.query('SELECT id FROM quest_claims WHERE discord_id = ? AND quest_key = ? AND period_start = ?', [
        user.discord_id,
        WEEKLY_REVIEW_KEY,
        period.start
    ]);
    return {
        period,
        completed,
        xpEarned: Number(xp.n),
        claimed: Boolean(claim),
        claimable: !claim && Boolean(user.gamification_enabled) && completed >= LIMITS.WEEKLY_REVIEW_MIN_COMPLETED,
        streak: Number(user.streak_count) || 0
    };
}

/** This week's numbers and whether the review bonus can be claimed. */
async function getReview(discordId, now = new Date()) {
    const conn = await getPool().getConnection();
    try {
        const [[user]] = await conn.query('SELECT discord_id, gamification_enabled, streak_count, timezone FROM users WHERE discord_id = ?', [String(discordId)]);
        const s = await reviewState(conn, user || { discord_id: String(discordId), gamification_enabled: 1, streak_count: 0 }, now);
        return {
            weekStart: s.period.start,
            resetsAt: s.period.endsAt.toISOString(),
            completed: s.completed,
            xpEarned: s.xpEarned,
            claimed: s.claimed,
            claimable: s.claimable,
            streak: s.streak,
            reward: REWARDS.WEEKLY_REVIEW
        };
    } finally {
        conn.release();
    }
}

/** Claim this week's review bonus (flat XP: no class or skill modifiers). */
async function claimReview(discordId, now = new Date()) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        const s = await reviewState(conn, user, now);
        if (s.completed < LIMITS.WEEKLY_REVIEW_MIN_COMPLETED) throw errors.validation('Finish at least one task this week to claim your review.');
        const [res] = await conn.query('INSERT IGNORE INTO quest_claims (discord_id, quest_key, period_start, reward_xp) VALUES (?, ?, ?, ?)', [
            user.discord_id,
            WEEKLY_REVIEW_KEY,
            s.period.start,
            REWARDS.WEEKLY_REVIEW
        ]);
        if (res.affectedRows !== 1) throw errors.conflict('You already claimed this week\'s review.');
        const previousLevel = Number(user.player_level);
        const paid = await awardFlat(conn, user, 'weekly_review', REWARDS.WEEKLY_REVIEW, { referenceId: res.insertId });
        const achievements = await unlockAchievements(conn, user);
        return {
            weekStart: s.period.start,
            xp: paid ? paid.xp : 0,
            balance: Number(user.player_xp),
            level: Number(user.player_level),
            leveledUp: Number(user.player_level) > previousLevel,
            achievements
        };
    });
}

module.exports = { getReview, claimReview };
