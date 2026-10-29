/**
 * Deadline reminder DMs. Kept apart from index.js so the timing and retry rules can be tested.
 *
 * Each hour the job looks at lists that might need a message (one candidate per person who should hear about it: the owner
 * and every member of a shared list with automation on, each with their own marker) and decides, in the
 * recipient's own time zone and at their chosen reminder hour, whether to send one:
 *
 *   due      the deadline is today (or the bot missed it, up to 3 days ago)
 *   overdue  one notice, the day after the deadline, if tasks are still open
 *   snooze   the user pressed "Snooze 1 day" on an earlier reminder
 *
 * A list is marked as handled only when the DM went out or can never go out
 * (DMs closed, user gone); any other error leaves it for the next hourly run. The mark itself is retried a
 * few times (markWithRetry), because a failure there, after the DM went out, would repeat the DM at the next run.
 *
 * Tasks with their own due date follow the same rules (sendTaskReminders): one DM on the
 * due day (up to 3 days late) at the owner's reminder hour, plus the snooze button. A
 * task due on its list's deadline day is covered by the list reminder instead.
 *
 * Fan-out is capped: one person gets at most MAX_DMS_PER_USER_PER_RUN reminder DMs per run (a big shared list or a hostile one cannot
 * turn the bot into a spammer). The rest are collapsed into ONE digest DM ("N more reminders due: see /list") and then marked as
 * handled, so they are not repeated every hour. Names in every message are escaped (they can be written by other people), and no
 * reminder can ping anybody.
 *
 * When a push client is passed (WEB_PUSH_INTERNAL_URL set), every reminder that is decided on is also
 * offered to the web server as a web push, best effort and only once the reminder is final (sent, or
 * can never be sent), so a retried DM never repeats the push. The server skips users without subscriptions.
 */

'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { isPastDeadline, formatDeadline, todayInZone, hourInZone, escapeDiscord } = require('@taskquest/shared');

/** Title and body of the web push that mirrors a list reminder. */
function pushForList(list, kind, now = new Date()) {
    const today = todayInZone(list.timezone, now);
    const late = isPastDeadline(list.deadline, today);
    const title = kind === 'overdue' ? 'Overdue' : kind === 'snooze' ? 'Reminder' : late ? 'Deadline passed' : 'Deadline today';
    return { title, body: `${list.name}: ${Number(list.items_done)}/${Number(list.items_total)} tasks done`, url: '/tasks' };
}

/** Title and body of the web push that mirrors a task reminder. */
function pushForTask(task, kind, now = new Date()) {
    const today = todayInZone(task.timezone, now);
    const late = isPastDeadline(String(task.due_date).slice(0, 10), today);
    const title = kind === 'snooze' ? 'Task reminder' : late ? 'Task overdue' : 'Task due today';
    return { title, body: task.list_name ? `${task.name} (${task.list_name})` : String(task.name), url: '/tasks' };
}

/** Offer a reminder to the web push client, if there is one. Never throws and never waits on a broken server for long. */
async function pushReminder(push, discordId, message) {
    if (!push?.enabled) return;
    try {
        await push.notify(discordId, message);
    } catch {
        /* best effort: the DM path is the reminder */
    }
}

/** Discord error codes where retrying cannot help. */
const PERMANENT_DM_ERRORS = new Set([50007 /* cannot DM this user */, 10013 /* unknown user */]);

const MAX_LATE_DAYS = 3;

const MARK_ATTEMPTS = 3;
const MARK_RETRY_MS = 50;

/**
 * Run a "this reminder is handled" write, trying again a couple of times. By then the DM has already gone out (sending first is
 * the safer failure), so a one-off database error here would otherwise repeat it at the next run; only a database that stays
 * down for the whole retry window still does.
 */
async function markWithRetry(mark, { attempts = MARK_ATTEMPTS, delayMs = MARK_RETRY_MS } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await mark();
        } catch (err) {
            if (attempt >= attempts) throw err;
            await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        }
    }
}

/** Reminder DMs one person may get in one run; everything past it becomes a single digest DM. */
const MAX_DMS_PER_USER_PER_RUN = 20;

/**
 * Counts what each person has been sent in this run and remembers, per person, the reminders that went over the cap (as the
 * function that marks each one handled). Share one budget between sendDeadlineReminders and sendTaskReminders so the cap is per
 * person, not per kind, then call flushOverflow once.
 */
function createBudget(max = MAX_DMS_PER_USER_PER_RUN) {
    const used = new Map();
    const overflow = new Map();
    return {
        max,
        /** True while the person is under the cap (and counts this reminder). */
        take(userId) {
            const n = used.get(String(userId)) || 0;
            if (n >= max) return false;
            used.set(String(userId), n + 1);
            return true;
        },
        defer(userId, mark) {
            const list = overflow.get(String(userId)) || [];
            list.push(mark);
            overflow.set(String(userId), list);
        },
        overflow
    };
}

/**
 * Send each person with overflow their one digest DM, then mark the collapsed reminders handled. A temporary DM failure leaves them
 * unmarked, so the next run tries again; closed DMs mark them (nothing could ever be delivered).
 * @returns {Promise<{ digests: number, collapsed: number }>}
 */
async function flushOverflow({ client, log, budget }) {
    const out = { digests: 0, collapsed: 0 };
    for (const [userId, marks] of budget.overflow) {
        const n = marks.length;
        try {
            const user = await client.users.fetch(userId);
            await user.send({ content: `📬 ${n} more reminder${n === 1 ? '' : 's'} due: see /list`, allowedMentions: { parse: [] } });
            out.digests++;
        } catch (err) {
            if (!PERMANENT_DM_ERRORS.has(err.code)) {
                log('⚠️', 'DEADLINE', `digest for ${userId}: ${err.message} (will retry)`);
                continue;
            }
        }
        for (const mark of marks) {
            try {
                await markWithRetry(mark);
            } catch (err) {
                // The digest went out; a reminder that could not be marked is repeated next run. The others still get their turn.
                log('⚠️', 'DEADLINE', `could not mark a collapsed reminder for ${userId}: ${err.message}`);
            }
        }
        out.collapsed += n;
    }
    budget.overflow.clear();
    return out;
}

/**
 * A candidate row is for a member (not the owner) of a shared list when the recipient (discord_id) differs from the owner_id the
 * shared package adds. Their sent/snooze state is their own, so it is marked for them; the owner's stays on the list.
 */
const isMemberRow = (row) => row.owner_id !== undefined && String(row.owner_id) !== String(row.discord_id);
const forMember = (row) => (isMemberRow(row) ? { recipientId: row.discord_id } : {});
const SNOOZE_MS = 24 * 60 * 60 * 1000;

const dayNumber = (ymd) => Math.floor(Date.parse(`${String(ymd).slice(0, 10)}T00:00:00Z`) / 86400e3);

/**
 * What (if anything) to send for a candidate list right now.
 * 'snooze_done' / 'due_done' mean the reminder is due but every task is already finished:
 * nothing is sent, the list is just marked handled (and its snooze cleared).
 * @returns {'snooze'|'due'|'overdue'|'snooze_done'|'due_done'|null}
 */
function decideReminder(list, now = new Date()) {
    const complete = Number(list.items_total) > 0 && Number(list.items_done) >= Number(list.items_total);
    if (list.remind_at && new Date(list.remind_at).getTime() <= now.getTime()) return complete ? 'snooze_done' : 'snooze';
    if (list.remind_at) return null; // snoozed: nothing else (not even the overdue notice) until the snooze ends

    const hour = Number.isInteger(Number(list.reminder_hour)) ? Number(list.reminder_hour) : 9;
    if (hourInZone(list.timezone, now) < hour) return null;
    if (!list.deadline) return null;
    const today = todayInZone(list.timezone, now);

    if (!list.deadline_notified && list.deadline <= today) {
        if (dayNumber(today) - dayNumber(list.deadline) > MAX_LATE_DAYS) return null;
        return complete ? 'due_done' : 'due';
    }
    const unfinished = Number(list.items_total) > Number(list.items_done);
    if (list.deadline_notified && !list.overdue_notified && list.deadline < today && unfinished) return 'overdue';
    return null;
}

/**
 * What (if anything) to send for a candidate task right now.
 * @returns {'snooze'|'due'|null}
 */
function decideTaskReminder(task, now = new Date()) {
    if (task.remind_at && new Date(task.remind_at).getTime() <= now.getTime()) return 'snooze';
    if (task.reminded_at || task.remind_at || !task.due_date) return null;
    const hour = Number.isInteger(Number(task.reminder_hour)) ? Number(task.reminder_hour) : 9;
    if (hourInZone(task.timezone, now) < hour) return null;
    const today = todayInZone(task.timezone, now);
    const due = String(task.due_date).slice(0, 10);
    if (due > today || dayNumber(today) - dayNumber(due) > MAX_LATE_DAYS) return null;
    return 'due';
}

function taskReminderMessage(task, kind, now = new Date()) {
    const today = todayInZone(task.timezone, now);
    const due = String(task.due_date).slice(0, 10);
    const late = isPastDeadline(due, today);
    const title = kind === 'snooze' ? '⏰ Task reminder' : late ? '⏰ Task overdue' : '⏰ Task due today';
    const when = late ? `was due on ${formatDeadline(due, today)}` : due === today ? 'is due today' : `is due ${formatDeadline(due, today)}`;
    return {
        embeds: [
            {
                color: 0xff6b6b,
                title,
                description: `Your task **${escapeDiscord(task.name, { max: 200 })}** ${when}.`,
                fields: [{ name: '📁 List', value: escapeDiscord(task.list_name, { max: 100 }) || 'None', inline: true }],
                footer: { text: 'TaskQuest • /timezone sets when reminders arrive' }
            }
        ],
        allowedMentions: { parse: [] },
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`task_remind_snooze_${task.id}`).setLabel('Snooze 1 day').setEmoji('😴').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('remind_off').setLabel('Stop reminders').setStyle(ButtonStyle.Secondary)
            )
        ]
    };
}

/**
 * DM the owners of tasks that are due. Same retry rules as the list reminders.
 * @returns {Promise<{ sent: number, skipped: number, retry: number }>}
 */
async function sendTaskReminders({ db, client, log, push, now = new Date(), budget: shared }) {
    const result = { sent: 0, skipped: 0, retry: 0 };
    const budget = shared || createBudget();
    for (const task of await db.tasks.getTaskReminderCandidates(now)) {
        try {
            const kind = decideTaskReminder(task, now);
            if (!kind) continue;
            if (!budget.take(task.discord_id)) {
                budget.defer(task.discord_id, () => db.tasks.markTaskReminderSent(task.id, now, ...(isMemberRow(task) ? [task.discord_id] : [])));
                continue;
            }
            try {
                const user = await client.users.fetch(task.discord_id);
                await user.send(taskReminderMessage(task, kind, now));
                result.sent++;
                log('📬', 'DEADLINE', `Sent a ${kind} reminder to ${task.discord_id} for task ${task.id}`);
            } catch (err) {
                if (PERMANENT_DM_ERRORS.has(err.code)) {
                    result.skipped++;
                } else {
                    result.retry++;
                    log('⚠️', 'DEADLINE', `task ${task.id}: ${err.message} (will retry)`);
                    continue;
                }
            }
            await pushReminder(push, task.discord_id, pushForTask(task, kind, now));
            await markWithRetry(() => db.tasks.markTaskReminderSent(task.id, now, ...(isMemberRow(task) ? [task.discord_id] : [])));
        } catch (err) {
            // One bad row (a lost DB connection while marking, say) must not stop everyone after it.
            result.retry++;
            log('⚠️', 'DEADLINE', `task ${task.id}: ${err.message} (will retry)`);
        }
    }
    if (!shared) await flushOverflow({ client, log, budget });
    return result;
}

function reminderMessage(list, kind, now = new Date()) {
    const today = todayInZone(list.timezone, now);
    const late = isPastDeadline(list.deadline, today);
    const done = Number(list.items_done);
    const total = Number(list.items_total);
    const name = escapeDiscord(list.name, { max: 100 });
    let title = '⏰ Deadline Today!';
    let description = `Your list **${name}** is due today!`;
    if (kind === 'overdue') {
        title = '⚠️ Overdue';
        description = `Your list **${name}** was due on ${formatDeadline(list.deadline, today)} and still has open tasks.`;
    } else if (kind === 'snooze') {
        title = '⏰ Reminder';
        description = late
            ? `Your list **${name}** was due on ${formatDeadline(list.deadline, today)}.`
            : `Your list **${name}** is due ${list.deadline ? formatDeadline(list.deadline, today) : 'soon'}.`;
    } else if (late) {
        title = '⏰ Deadline Passed';
        description = `Your list **${name}** was due on ${formatDeadline(list.deadline, today)}.`;
    }
    return {
        embeds: [
            {
                color: 0xff6b6b,
                title,
                description,
                fields: [
                    { name: '📊 Progress', value: `${done}/${total} tasks`, inline: true },
                    { name: '📁 Category', value: escapeDiscord(list.category, { max: 100 }) || 'None', inline: true }
                ],
                footer: { text: 'TaskQuest • /timezone sets when reminders arrive' }
            }
        ],
        allowedMentions: { parse: [] },
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
async function sendDeadlineReminders({ db, client, log, push, now = new Date(), budget: shared }) {
    const result = { sent: 0, skipped: 0, retry: 0 };
    const budget = shared || createBudget();
    for (const list of await db.tasks.getReminderCandidates(now)) {
        try {
            const kind = decideReminder(list, now);
            if (!kind) continue;
            const today = todayInZone(list.timezone, now);
            const late = (kind === 'due' || kind === 'due_done' || kind === 'snooze') && isPastDeadline(list.deadline, today);
            const pastDeadline = Boolean(list.deadline) && String(list.deadline).slice(0, 10) <= today;
            if (kind.endsWith('_done')) {
                // Everything is finished: no DM, but stop the list from being picked up again.
                await db.tasks.markReminderSent(list.id, kind === 'due_done' ? 'due' : 'snooze', { late, pastDeadline, ...forMember(list) });
                result.skipped++;
                continue;
            }
            if (!budget.take(list.discord_id)) {
                budget.defer(list.discord_id, () => db.tasks.markReminderSent(list.id, kind, { late, pastDeadline, ...forMember(list) }));
                continue;
            }
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
            await pushReminder(push, list.discord_id, pushForList(list, kind, now));
            await markWithRetry(() => db.tasks.markReminderSent(list.id, kind, { late, pastDeadline, ...forMember(list) }));
        } catch (err) {
            // One bad row (a lost DB connection while marking, say) must not stop everyone after it.
            result.retry++;
            log('⚠️', 'DEADLINE', `list ${list.id}: ${err.message} (will retry)`);
        }
    }
    if (!shared) await flushOverflow({ client, log, budget });
    return result;
}

/** Buttons on a reminder DM: remind_snooze_<listId>, task_remind_snooze_<itemId> and remind_off. */
async function handleButton(interaction, { db, now = new Date() } = {}) {
    const database = db || require('@taskquest/shared/db');
    const userId = interaction.user.id;
    if (interaction.customId === 'remind_off') {
        await database.users.updateSettings(userId, { automation_enabled: false });
        return interaction.update({ components: [], content: '🔕 Reminders are off. Turn them back on with `/automation`.' });
    }
    const isTask = interaction.customId.startsWith('task_remind_snooze_');
    const targetId = interaction.customId.slice((isTask ? 'task_remind_snooze_' : 'remind_snooze_').length);
    try {
        const until = new Date(now.getTime() + SNOOZE_MS);
        if (isTask) await database.tasks.snoozeTask(userId, targetId, until);
        else await database.tasks.snoozeList(userId, targetId, until);
    } catch (err) {
        // Only a list or task that is really gone strips the buttons; a temporary failure (a database blip) keeps them so
        // the player can press Snooze again.
        if (['NOT_FOUND', 'FORBIDDEN', 'VALIDATION'].includes(err?.code)) {
            return interaction.update({ components: [], content: `That ${isTask ? 'task' : 'list'} no longer exists.` });
        }
        console.error('Snooze failed:', err);
        return interaction.reply({ content: 'Could not snooze that right now. Try the button again in a moment.', flags: MessageFlags.Ephemeral });
    }
    // No flags: an edit may only change SUPPRESS_EMBEDS, and Discord refuses the whole edit for any other.
    return interaction.update({ components: [], content: '😴 Snoozed. I will remind you again in about 24 hours.' });
}

module.exports = { createBudget, flushOverflow, markWithRetry, pushReminder, MAX_DMS_PER_USER_PER_RUN, sendDeadlineReminders, sendTaskReminders, pushForList, pushForTask, decideReminder, decideTaskReminder, taskReminderMessage, reminderMessage, handleButton, PERMANENT_DM_ERRORS, SNOOZE_MS };
