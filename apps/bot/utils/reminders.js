/**
 * Deadline reminder DMs. Kept apart from index.js so the retry rules can be tested.
 *
 * A list is reminded on its due date, or up to a few days later if the bot was
 * down or Discord was failing at the time. It is marked as notified only when
 * the DM went out or can never go out (DMs closed, user gone); any other error
 * leaves it unmarked so the next hourly run tries again.
 */

'use strict';

const { isPastDeadline, formatDeadline } = require('@taskquest/shared');

/** Discord error codes where retrying cannot help. */
const PERMANENT_DM_ERRORS = new Set([50007 /* cannot DM this user */, 10013 /* unknown user */]);

function reminderEmbed(list, items, today) {
    const done = items.filter((i) => i.completed).length;
    const late = isPastDeadline(list.deadline, today);
    return {
        color: 0xff6b6b,
        title: late ? '⏰ Deadline Passed' : '⏰ Deadline Today!',
        description: late
            ? `Your list **${list.name}** was due on ${formatDeadline(list.deadline, today)}.`
            : `Your list **${list.name}** is due today!`,
        fields: [
            { name: '📊 Progress', value: `${done}/${items.length} tasks`, inline: true },
            { name: '📁 Category', value: list.category || 'None', inline: true }
        ],
        footer: { text: 'TaskQuest • /automation to turn reminders off' }
    };
}

/**
 * @param {object} deps { db, client, log, now? }
 * @returns {Promise<{ sent: number, skipped: number, retry: number }>}
 */
async function sendDeadlineReminders({ db, client, log, now = new Date() }) {
    const today = now.toISOString().slice(0, 10);
    const result = { sent: 0, skipped: 0, retry: 0 };
    for (const list of await db.tasks.getListsDueBy(today)) {
        try {
            const user = await client.users.fetch(list.discord_id);
            const items = (await db.tasks.getItems(list.discord_id, list.id)) || [];
            await user.send({ embeds: [reminderEmbed(list, items, today)] });
            result.sent++;
            log('📬', 'DEADLINE', `Reminded ${list.discord_id} about list ${list.id}`);
        } catch (err) {
            if (PERMANENT_DM_ERRORS.has(err.code)) {
                result.skipped++; // never going to work: stop trying
            } else {
                result.retry++;
                log('⚠️', 'DEADLINE', `list ${list.id}: ${err.message} (will retry)`);
                continue; // leave it unmarked
            }
        }
        await db.tasks.markDeadlineNotified(list.id);
    }
    return result;
}

module.exports = { sendDeadlineReminders, reminderEmbed, PERMANENT_DM_ERRORS };
