/**
 * Daily and weekly quests. Progress is derived from data that already exists
 * (completed tasks, XP log), so there is nothing to keep in sync; the only
 * stored state is the claim. The unique key (user, quest, period start) makes
 * a claim atomic: two clicks cannot both pay out.
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser } = require('./users');
const { applyXP, requireGamification, unlockAchievements } = require('./progression');
const { errors } = require('../errors');
const { QUESTS } = require('../constants');
const { questPeriod } = require('../quests');

/** How far along a user is on one metric within [from, to). */
async function metricProgress(conn, discordId, metric, from, to) {
    const params = [discordId, from, to];
    const count = async (sql) => Number((await conn.query(sql, params))[0][0].n);
    switch (metric) {
        // Quests count what was recorded at the moment of first (XP-paid) completion or creation,
        // never query-time state, so re-checking, editing priority, importing or recurring copies can't farm them.
        case 'completions':
            return count(
                `SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.id = i.list_id
                 WHERE l.discord_id = ? AND i.counts_for_quests = 1 AND i.first_completed_at >= ? AND i.first_completed_at < ?`
            );
        case 'high_completions':
            return count(
                `SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.id = i.list_id
                 WHERE l.discord_id = ? AND i.counts_for_quests = 1 AND i.first_completed_at >= ? AND i.first_completed_at < ?
                   AND i.first_completed_high = 1`
            );
        case 'adds':
            return count(
                `SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.id = i.list_id
                 WHERE l.discord_id = ? AND i.counts_for_quests = 1 AND i.created_at >= ? AND i.created_at < ?`
            );
        case 'daily_claims':
            return count(
                `SELECT COUNT(*) AS n FROM xp_transactions
                 WHERE discord_id = ? AND source = 'daily' AND created_at >= ? AND created_at < ?`
            );
        default:
            return 0;
    }
}

async function questState(conn, discordId, now = new Date()) {
    const [claims] = await conn.query('SELECT quest_key, period_start FROM quest_claims WHERE discord_id = ? AND period_start >= ?', [
        discordId,
        questPeriod('weekly', now).start
    ]);
    const claimed = new Set(claims.map((c) => `${c.quest_key}@${String(c.period_start).slice(0, 10)}`));

    const out = [];
    for (const [key, q] of Object.entries(QUESTS)) {
        const period = questPeriod(q.period, now);
        const progress = Math.min(q.target, await metricProgress(conn, discordId, q.metric, period.startsAt, period.endsAt));
        const isClaimed = claimed.has(`${key}@${period.start}`);
        out.push({
            key,
            name: q.name,
            emoji: q.emoji,
            description: q.description,
            period: q.period,
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
        return await questState(conn, String(discordId), now);
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
        const period = questPeriod(quest.period, now);
        const progress = await metricProgress(conn, user.discord_id, quest.metric, period.startsAt, period.endsAt);
        if (progress < quest.target) throw errors.validation(`${quest.name} isn't finished yet (${progress}/${quest.target}).`);

        const [res] = await conn.query('INSERT IGNORE INTO quest_claims (discord_id, quest_key, period_start, reward_xp) VALUES (?, ?, ?, ?)', [
            user.discord_id,
            key,
            period.start,
            quest.reward
        ]);
        if (res.affectedRows !== 1) throw errors.conflict(`You already claimed ${quest.name} this ${quest.period === 'daily' ? 'day' : 'week'}.`);

        const tx = await applyXP(conn, user, quest.reward, 'quest_reward', { referenceId: res.insertId });
        const achievements = await unlockAchievements(conn, user);
        return { key, name: quest.name, reward: quest.reward, balance: Number(user.player_xp), level: Number(user.player_level), leveledUp: Number(user.player_level) > tx.previousLevel, achievements };
    });
}

module.exports = { getQuests, claimQuest };
