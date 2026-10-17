/**
 * Weekly digest DM: a short look back at the last 7 days, sent on Monday at the
 * user's reminder hour (in their time zone) to users who opted in with /weekly.
 *
 * The numbers always come from the database. When the AI service is on and the
 * user hasn't opted out of it, its weekly recap is added; if that call fails the
 * digest is still sent without it. When a recap was written and web push is set up, the headline is also offered as a web push
 * (best effort, once the digest is final: sent, or its DM can never be sent), so it reaches players who do not read their DMs.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const { hourInZone, weekdayInZone } = require('@taskquest/shared');
const { PERMANENT_DM_ERRORS, pushReminder } = require('./reminders');

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

/** The web push that mirrors an AI recap, or null when there is none to show. */
function pushForRecap(recap) {
    if (!recap || typeof recap.headline !== 'string' || !recap.headline.trim()) return null;
    return { title: 'Your weekly recap', body: recap.headline.trim().slice(0, 140), url: '/stats' };
}

/**
 * @param {object} deps { db, client, log, ai?, push?, now? }
 * @returns {Promise<{ sent: number, skipped: number, retry: number }>}
 */
async function sendWeeklyDigests({ db, client, log, ai, push, now = new Date() }) {
    const result = { sent: 0, skipped: 0, retry: 0 };
    const aiClient = ai === undefined ? defaultAi() : ai;
    for (const user of await db.users.getDigestCandidates(now)) {
        if (!isDigestTime(user, now)) continue;
        // Claim the week first (atomic UPDATE) so overlapping runs cannot both send it.
        if (!(await db.users.claimDigest(user.discord_id, now))) continue;
        let recap = null;
        try {
            const [stats, found] = await Promise.all([db.users.getWeeklyStats(user.discord_id, now), tryRecap(aiClient, user)]);
            recap = found;
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
                // Give the claim back so the next hourly run tries again (and the push waits for that run, so it is sent once).
                await db.users.releaseDigest(user.discord_id, now, user.last_digest_at ?? null).catch(() => {});
                continue;
            }
        }
        const message = pushForRecap(recap);
        if (message) await pushReminder(push, user.discord_id, message);
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

module.exports = { sendWeeklyDigests, isDigestTime, digestEmbed, pushForRecap };
