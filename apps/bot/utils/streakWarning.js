/**
 * Streak-at-risk warning: a DM (and a web push, when that is set up) on the evening of the last day a streak of 3 or more days can
 * still be saved by claiming the daily reward. At most one a day per person; players with reminders or XP off never get it.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const { PERMANENT_DM_ERRORS } = require('./reminders');

function warningEmbed(streak) {
    return new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`🔥 Your ${streak}-day streak ends today`)
        .setDescription('You have not claimed today\'s daily reward yet. Use **/daily** (or the dashboard) before midnight to keep it going.')
        .setFooter({ text: 'TaskQuest • /automation turns reminders off' });
}

/**
 * @param {object} deps { db, client, log, push?, now? }
 * @returns {Promise<{ sent: number, skipped: number, retry: number }>}
 */
async function sendStreakWarnings({ db, client, log, push, now = new Date() }) {
    const result = { sent: 0, skipped: 0, retry: 0 };
    for (const w of await db.today.getStreakWarnings(now)) {
        // Claim the day first (atomic UPDATE) so overlapping runs cannot both send it.
        if (!(await db.today.claimStreakWarning(w.discord_id, w.day))) continue;
        try {
            const user = await client.users.fetch(w.discord_id);
            await user.send({ embeds: [warningEmbed(w.streak)] });
            result.sent++;
            log('🔥', 'STREAK', `Warned ${w.discord_id} about a ${w.streak}-day streak`);
        } catch (err) {
            if (PERMANENT_DM_ERRORS.has(err.code)) {
                result.skipped++;
            } else {
                result.retry++;
                log('⚠️', 'STREAK', `${w.discord_id}: ${err.message} (will retry)`);
                await db.today.releaseStreakWarning(w.discord_id, w.day).catch(() => {});
                continue;
            }
        }
        if (push?.enabled) {
            try {
                await push.notify(w.discord_id, { title: `Your ${w.streak}-day streak ends today`, body: 'Claim your daily reward before midnight to keep it.', url: '/today' });
            } catch {
                /* best effort: the DM is the warning */
            }
        }
    }
    return result;
}

module.exports = { sendStreakWarnings, warningEmbed };
