/**
 * Deadline reminder DMs. Kept apart from index.js so the timing and retry rules can be tested.
 *
 * Each hour the job looks at lists that might need a message and decides, in the
 * owner's own time zone and at their chosen reminder hour, whether to send one:
 *
 *   due      the deadline is today (or the bot missed it, up to 3 days ago)
 *   overdue  one notice, the day after the deadline, if tasks are still open
 *   snooze   the user pressed "Snooze 1 day" on an earlier reminder
 *
 * A list is marked as handled only when the DM went out or can never go out
 * (DMs closed, user gone); any other error leaves it for the next hourly run.
 */

'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { isPastDeadline, formatDeadline, todayInZone, hourInZone } = require('@taskquest/shared');

/** Discord error codes where retrying cannot help. */
const PERMANENT_DM_ERRORS = new Set([50007 /* cannot DM this user */, 10013 /* unknown user */]);

const MAX_LATE_DAYS = 3;
const SNOOZE_MS = 24 * 60 * 60 * 1000;

const dayNumber = (ymd) => Math.floor(Date.parse(`${String(ymd).slice(0, 10)}T00:00:00Z`) / 86400e3);

/**
 * What (if anything) to send for a candidate list right now.
 * @returns {'snooze'|'due'|'overdue'|null}
 */
function decideReminder(list, now = new Date()) {
    if (list.remind_at && new Date(list.remind_at).getTime() <= now.getTime()) return 'snooze';

    const hour = Number.isInteger(Number(list.reminder_hour)) ? Number(list.reminder_hour) : 9;
    if (hourInZone(list.timezone, now) < hour) return null;
    if (!list.deadline) return null;
    const today = todayInZone(list.timezone, now);

    if (!list.deadline_notified && list.deadline <= today) {
        return dayNumber(today) - dayNumber(list.deadline) <= MAX_LATE_DAYS ? 'due' : null;
    }
    const unfinished = Number(list.items_total) > Number(list.items_done);
    if (list.deadline_notified && !list.overdue_notified && list.deadline < today && unfinished) return 'overdue';
    return null;
}

function reminderMessage(list, kind, now = new Date()) {
    const today = todayInZone(list.timezone, now);
    const late = isPastDeadline(list.deadline, today);
    const done = Number(list.items_done);
    const total = Number(list.items_total);
    let title = '⏰ Deadline Today!';
    let description = `Your list **${list.name}** is due today!`;
    if (kind === 'overdue') {
        title = '⚠️ Overdue';
        description = `Your list **${list.name}** was due on ${formatDeadline(list.deadline, today)} and still has open tasks.`;
    } else if (kind === 'snooze') {
        title = '⏰ Reminder';
        description = late
            ? `Your list **${list.name}** was due on ${formatDeadline(list.deadline, today)}.`
            : `Your list **${list.name}** is due ${list.deadline ? formatDeadline(list.deadline, today) : 'soon'}.`;
    } else if (late) {
        title = '⏰ Deadline Passed';
        description = `Your list **${list.name}** was due on ${formatDeadline(list.deadline, today)}.`;
    }
    return {
        embeds: [
            {
                color: 0xff6b6b,
                title,
                description,
                fields: [
                    { name: '📊 Progress', value: `${done}/${total} tasks`, inline: true },
                    { name: '📁 Category', value: list.category || 'None', inline: true }
                ],
                footer: { text: 'TaskQuest • /timezone sets when reminders arrive' }
            }
        ],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`remind_snooze_${list.id}`).setLabel('Snooze 1 day').setEmoji('😴').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('remind_off').setLabel('Stop reminders').setStyle(ButtonStyle.Secondary)
            )
        ]
    };
}

/**
 * @param {object} deps { db, client, log, now? }
 * @returns {Promise<{ sent: number, skipped: number, retry: number }>}
 */
async function sendDeadlineReminders({ db, client, log, now = new Date() }) {
    const result = { sent: 0, skipped: 0, retry: 0 };
    for (const list of await db.tasks.getReminderCandidates(now)) {
        const kind = decideReminder(list, now);
        if (!kind) continue;
        const late = kind === 'due' && isPastDeadline(list.deadline, todayInZone(list.timezone, now));
        try {
            const user = await client.users.fetch(list.discord_id);
            await user.send(reminderMessage(list, kind, now));
            result.sent++;
            log('📬', 'DEADLINE', `Sent a ${kind} reminder to ${list.discord_id} for list ${list.id}`);
        } catch (err) {
            if (PERMANENT_DM_ERRORS.has(err.code)) {
                result.skipped++; // never going to work: stop trying
            } else {
                result.retry++;
                log('⚠️', 'DEADLINE', `list ${list.id}: ${err.message} (will retry)`);
                continue; // leave it unmarked
            }
        }
        await db.tasks.markReminderSent(list.id, kind, { late });
    }
    return result;
}

/** Buttons on a reminder DM: remind_snooze_<listId> and remind_off. */
async function handleButton(interaction, { db, now = new Date() } = {}) {
    const database = db || require('@taskquest/shared/db');
    const userId = interaction.user.id;
    if (interaction.customId === 'remind_off') {
        await database.users.updateSettings(userId, { automation_enabled: false });
        return interaction.update({ components: [], content: '🔕 Reminders are off. Turn them back on with `/automation`.' });
    }
    const listId = interaction.customId.slice('remind_snooze_'.length);
    try {
        await database.tasks.snoozeList(userId, listId, new Date(now.getTime() + SNOOZE_MS));
    } catch {
        return interaction.update({ components: [], content: 'That list no longer exists.' });
    }
    return interaction.update({ components: [], content: '😴 Snoozed. I will remind you again in about 24 hours.', flags: MessageFlags.SuppressNotifications });
}

module.exports = { sendDeadlineReminders, decideReminder, reminderMessage, handleButton, PERMANENT_DM_ERRORS, SNOOZE_MS };
