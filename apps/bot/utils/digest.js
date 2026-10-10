/**
 * Weekly digest DM: a short look back at the last 7 days, sent on Monday at the
 * user's reminder hour (in their time zone) to users who opted in with /weekly.
 *
 * The numbers always come from the database. When the AI service is on and the
 * user hasn't opted out of it, its weekly recap is added; if that call fails the
 * digest is still sent without it.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const { hourInZone, weekdayInZone } = require('@taskquest/shared');
const { PERMANENT_DM_ERRORS } = require('./reminders');

const AI_TIMEOUT_MS = 30000;

/** True on Monday, at or after the user's reminder hour, in their own time zone. */
function isDigestTime(user, now = new Date()) {
    const hour = Number.isInteger(Number(user.reminder_hour)) ? Number(user.reminder_hour) : 9;
    return weekdayInZone(user.timezone, now) === 1 && hourInZone(user.timezone, now) >= hour;
}

function digestEmbed(stats, recap) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📅 Your week in TaskQuest')
        .setDescription(
            stats.completed
                ? `You finished **${stats.completed}** task${stats.completed === 1 ? '' : 's'} and earned **${stats.xpEarned.toLocaleString()} XP** in the last 7 days.`
                : 'No tasks finished in the last 7 days. A fresh week is a good time to start.'
        )
        .addFields(
            { name: '🔥 Streak', value: `${stats.streak} day${stats.streak === 1 ? '' : 's'}`, inline: true },
            { name: '📂 Open lists', value: String(stats.listsOpen), inline: true },
            { name: '⚠️ Overdue', value: String(stats.listsOverdue), inline: true }
        )
        .setFooter({ text: 'TaskQuest • /weekly turns this off' });
    if (recap && recap.headline) {
        const lines = Array.isArray(recap.highlights) ? recap.highlights.slice(0, 3).map((l) => `• ${l}`).join('\n') : '';
        embed.addFields({ name: '✨ AI recap', value: `**${recap.headline}**${lines ? `\n${lines}` : ''}`.slice(0, 1024) });
    }
    return embed;
}

/** Best-effort AI recap: null when AI is off, the user opted out, or the call fails. */
async function tryRecap(ai, user) {
    if (!ai || !ai.enabled || Number(user.ai_enabled) === 0) return null;
    try {
        return await ai.post('/v1/summary', user.discord_id, { mode: 'recap', range: 'week' }, { timeoutMs: AI_TIMEOUT_MS });
    } catch {
        return null;
    }
}

/**
 * @param {object} deps { db, client, log, ai?, now? }
 * @returns {Promise<{ sent: number, skipped: number, retry: number }>}
 */
async function sendWeeklyDigests({ db, client, log, ai, now = new Date() }) {
    const result = { sent: 0, skipped: 0, retry: 0 };
    const aiClient = ai === undefined ? defaultAi() : ai;
    for (const user of await db.users.getDigestCandidates(now)) {
        if (!isDigestTime(user, now)) continue;
        try {
            const [stats, recap] = await Promise.all([db.users.getWeeklyStats(user.discord_id, now), tryRecap(aiClient, user)]);
            const discordUser = await client.users.fetch(user.discord_id);
            await discordUser.send({ embeds: [digestEmbed(stats, recap)] });
            result.sent++;
            log('📅', 'DIGEST', `Sent the weekly digest to ${user.discord_id}`);
        } catch (err) {
            if (PERMANENT_DM_ERRORS.has(err.code)) {
                result.skipped++;
            } else {
                result.retry++;
                log('⚠️', 'DIGEST', `${user.discord_id}: ${err.message} (will retry)`);
                continue;
            }
        }
        await db.users.markDigestSent(user.discord_id, now);
    }
    return result;
}

let shared;
function defaultAi() {
    try {
        shared ||= require('@taskquest/shared/ai').createAiClient();
        return shared;
    } catch {
        return null;
    }
}

module.exports = { sendWeeklyDigests, isDigestTime, digestEmbed };
