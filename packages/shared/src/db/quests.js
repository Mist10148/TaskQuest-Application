/**
 * Daily and weekly quests. Progress is derived from data that already exists
 * (completed tasks, XP log), so there is nothing to keep in sync; the only
 * stored state is the claim. The unique key (user, quest, period start) makes
 * a claim atomic: two clicks cannot both pay out.
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser, progressFloor } = require('./users');
const { applyXP, claimedSince, requireGamification, unlockAchievements, userZone } = require('./progression');
const { errors } = require('../errors');
const { QUESTS, ROTATING_QUESTS } = require('../constants');
const { questPeriod, activeRotatingQuest } = require('../quests');
const { actorSql } = require('./access');

const PERIOD_NOUN = { daily: 'day', weekly: 'week', monthly: 'month' };

/** Quests that can be listed and claimed at `now`: every fixed quest, and only the live rotating one. */
function liveQuests(now, zone) {
    const live = activeRotatingQuest(ROTATING_QUESTS, now, zone);
    return Object.entries(QUESTS).filter(([key, q]) => !q.rotating || key === live);
}

/** How far along a user is on one metric within [from, to). */
async function metricProgress(conn, discordId, metric, windowFrom, to) {
    const from = await progressFloor(conn, discordId, windowFrom); // nothing from before the last progress reset counts
    const params = [discordId, discordId, from, to];
    const count = async (sql, p = params) => Number((await conn.query(sql, p))[0][0].n);
    switch (metric) {
        // Quests count what the user themselves did (items.first_completed_by / created_by, lists.cleared_by), whoever owns the list,
        // recorded at the moment of first (XP-paid) completion or creation, never query-time state, so re-checking, editing priority, importing or recurring copies can't farm them.
        case 'completions':
            return count(
                `SELECT COUNT(*) AS n FROM items i
                 WHERE ${actorSql('first_completed_by')} AND i.counts_for_quests = 1 AND i.first_completed_at >= ? AND i.first_completed_at < ?`
            );
        case 'high_completions':
            return count(
                `SELECT COUNT(*) AS n FROM items i
                 WHERE ${actorSql('first_completed_by')} AND i.counts_for_quests = 1 AND i.first_completed_at >= ? AND i.first_completed_at < ?
                   AND i.first_completed_high = 1`
            );
        case 'adds':
            return count(
                `SELECT COUNT(*) AS n FROM items i
                 WHERE ${actorSql('created_by')} AND i.counts_for_quests = 1 AND i.created_at >= ? AND i.created_at < ?`
            );
        case 'early_completions':
            return count(
                `SELECT COUNT(*) AS n FROM items i
                 WHERE ${actorSql('first_completed_by')} AND i.counts_for_quests = 1 AND i.first_completed_at >= ? AND i.first_completed_at < ?
                   AND i.first_completed_early = 1`
            );
        case 'overdue_completions':
            return count(
                `SELECT COUNT(*) AS n FROM items i
                 WHERE ${actorSql('first_completed_by')} AND i.counts_for_quests = 1 AND i.first_completed_at >= ? AND i.first_completed_at < ?
                   AND i.first_completed_overdue = 1`
            );
        case 'lists_cleared':
            return count('SELECT COUNT(*) AS n FROM lists WHERE (cleared_by = ? OR (cleared_by IS NULL AND discord_id = ?)) AND cleared_at >= ? AND cleared_at < ?');
        case 'dated_adds':
            return count(
                `SELECT COUNT(*) AS n FROM items i
                 WHERE ${actorSql('created_by')} AND i.counts_for_quests = 1 AND i.due_date IS NOT NULL AND i.created_at >= ? AND i.created_at < ?`
            );
        case 'daily_claims':
            return count(
                `SELECT COUNT(*) AS n FROM xp_transactions
                 WHERE discord_id = ? AND source = 'daily' AND created_at >= ? AND created_at < ?`,
                [discordId, from, to]
            );
        default:
            return 0;
    }
}

async function questState(conn, discordId, now = new Date(), zone = null) {
    const weekly = questPeriod('weekly', now, zone);
    const monthly = questPeriod('monthly', now, zone);
    // A time zone change re-keys the period, so a claim made since the period's real start counts too (claimQuest refuses it).
    const [claims] = await conn.query('SELECT quest_key, period_start, claimed_at FROM quest_claims WHERE discord_id = ? AND (period_start >= ? OR claimed_at >= ?)', [
        discordId,
        [weekly.start, monthly.start].sort()[0],
        new Date(Math.min(weekly.startsAt.getTime(), monthly.startsAt.getTime()))
    ]);
    const claimed = new Set(claims.map((c) => `${c.quest_key}@${String(c.period_start).slice(0, 10)}`));
    const claimedAfter = (key, startsAt) => claims.some((c) => c.quest_key === key && new Date(c.claimed_at) >= startsAt);

    const out = [];
    for (const [key, q] of liveQuests(now, zone)) {
        const period = questPeriod(q.period, now, zone);
        const progress = Math.min(q.target, await metricProgress(conn, discordId, q.metric, period.startsAt, period.endsAt));
        const isClaimed = claimed.has(`${key}@${period.start}`) || claimedAfter(key, period.startsAt);
        out.push({
            key,
            name: q.name,
            emoji: q.emoji,
            description: q.description,
            period: q.period,
            rotating: Boolean(q.rotating),
            target: q.target,
            reward: q.reward,
            progress,
            claimed: isClaimed,
            claimable: !isClaimed && progress >= q.target,
            periodStart: period.start,
            resetsAt: period.endsAt.toISOString()
        });
    }
    return out;
}

/** All quests with this period's progress and claim state. */
async function getQuests(discordId, now = new Date()) {
    const conn = await getPool().getConnection();
    try {
        return await questState(conn, String(discordId), now, await userZone(conn, discordId));
    } finally {
        conn.release();
    }
}

/** Claim a finished quest's XP (flat reward: no class or skill modifiers). */
async function claimQuest(discordId, rawKey, now = new Date()) {
    const key = String(rawKey || '').toUpperCase();
    const quest = Object.prototype.hasOwnProperty.call(QUESTS, key) ? QUESTS[key] : null;
    if (!quest) throw errors.notFound('Quest not found.');

    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        // Periods are the user's own day, week and month; a rotating quest is live by their local ISO week.
        if (!liveQuests(now, user.timezone).some(([k]) => k === key)) throw errors.notFound('Quest not found.');
        const period = questPeriod(quest.period, now, user.timezone);
        const progress = await metricProgress(conn, user.discord_id, quest.metric, period.startsAt, period.endsAt);
        if (progress < quest.target) throw errors.validation(`${quest.name} isn't finished yet (${progress}/${quest.target}).`);

        // Changing time zone moves the period boundaries and its key; the claim must still pay once per real period.
        if (await claimedSince(conn, user.discord_id, key, period.startsAt)) throw errors.conflict(`You already claimed ${quest.name} this ${PERIOD_NOUN[quest.period]}.`);
        const [res] = await conn.query('INSERT INTO quest_claims (discord_id, quest_key, period_start, reward_xp) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id', [
            user.discord_id,
            key,
            period.start,
            quest.reward
        ]);
        if (res.affectedRows !== 1) throw errors.conflict(`You already claimed ${quest.name} this ${PERIOD_NOUN[quest.period]}.`);

        const tx = await applyXP(conn, user, quest.reward, 'quest_reward', { referenceId: res.insertId });
        const achievements = await unlockAchievements(conn, user);
        return { key, name: quest.name, reward: quest.reward, balance: Number(user.player_xp), level: Number(user.player_level), leveledUp: Number(user.player_level) > tx.previousLevel, achievements };
    });
}

module.exports = { getQuests, claimQuest };
