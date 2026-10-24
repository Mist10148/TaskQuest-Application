/**
 * Streak-at-risk warning: a DM (and a web push, when that is set up) on the evening of the last day a streak of 3 or more days can
 * still be saved by claiming the daily reward, once the claim cooldown is over, with the time it lapses. At most one a day per
 * person; players with reminders or XP off never get it.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const { todayInZone, tz } = require('@taskquest/shared');
const { PERMANENT_DM_ERRORS } = require('./reminders');

/**
 * "11:30 PM today" or "8:00 AM tomorrow": when the streak lapses, in the player's zone. A streak lasts until the later of its
 * calendar window and its rolling window, so this is often not midnight. Null when the expiry is unknown.
 */
function deadlineText(expiresAt, timezone, now = new Date()) {
    if (!expiresAt) return null;
    const at = new Date(expiresAt);
    const zone = tz.resolveZone(timezone);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(at);
    return `${time} ${todayInZone(zone, at) === todayInZone(zone, now) ? 'today' : 'tomorrow'}`;
}

function warningEmbed(streak, deadline = null) {
    return new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`🔥 Your ${streak}-day streak is about to end`)
        .setDescription(`You have not claimed your daily reward yet. Use **/daily** (or the dashboard) ${deadline ? `before ${deadline}` : 'soon'} to keep it going.`)
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
            await user.send({ embeds: [warningEmbed(w.streak, deadlineText(w.expiresAt, w.timezone, now))] });
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
                const deadline = deadlineText(w.expiresAt, w.timezone, now);
                await push.notify(w.discord_id, {
                    title: `Your ${w.streak}-day streak is about to end`,
                    body: `Claim your daily reward ${deadline ? `before ${deadline}` : 'soon'} to keep it.`,
                    url: '/today'
                });
            } catch {
                /* best effort: the DM is the warning */
            }
        }
    }
    return result;
}

module.exports = { sendStreakWarnings, warningEmbed, deadlineText };
