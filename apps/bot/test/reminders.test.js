/**
 * Deadline reminders: timing in the user's own time zone, one overdue notice,
 * snooze, and retry rules (only unrecoverable failures are marked as done).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendDeadlineReminders, decideReminder, handleButton, SNOOZE_MS } = require('../utils/reminders');

const list = (over = {}) => ({
    id: 1,
    discord_id: '42',
    name: 'Taxes',
    deadline: '2030-03-10',
    category: 'Home',
    timezone: null,
    reminder_hour: 9,
    deadline_notified: 0,
    overdue_notified: 0,
    remind_at: null,
    items_total: 2,
    items_done: 1,
    ...over
});

const at = (iso) => new Date(iso);

test('due reminders wait for the reminder hour in the user\'s time zone', () => {
    const l = list({ timezone: 'Asia/Manila', reminder_hour: 9 }); // Manila = UTC+8
    assert.equal(decideReminder(l, at('2030-03-10T00:30:00Z')), null, '08:30 in Manila: too early');
    assert.equal(decideReminder(l, at('2030-03-10T01:00:00Z')), 'due', '09:00 in Manila');
    assert.equal(decideReminder(l, at('2030-03-09T20:00:00Z')), null, 'still March 9 in the UTC-minus-world, March 10 04:00 in Manila');
});

test('west of UTC the due day starts later, not earlier', () => {
    const l = list({ timezone: 'America/New_York' }); // DST began that morning, so New York is UTC-4
    assert.equal(decideReminder(l, at('2030-03-10T12:00:00Z')), null, '08:00 in New York');
    assert.equal(decideReminder(l, at('2030-03-10T14:00:00Z')), 'due', '10:00 in New York');
    assert.equal(decideReminder(list({ deadline: '2030-03-11', timezone: 'America/New_York' }), at('2030-03-10T23:00:00Z')), null, 'not due yet');
});

test('a missed reminder is still sent for up to 3 days, then dropped', () => {
    assert.equal(decideReminder(list({ deadline: '2030-03-07' }), at('2030-03-10T10:00:00Z')), 'due');
    assert.equal(decideReminder(list({ deadline: '2030-03-06' }), at('2030-03-10T10:00:00Z')), null);
});

test('one overdue notice the day after, only when tasks are still open', () => {
    const base = { deadline_notified: 1 };
    const next = at('2030-03-11T10:00:00Z');
    assert.equal(decideReminder(list(base), at('2030-03-10T10:00:00Z')), null, 'not overdue on the due date');
    assert.equal(decideReminder(list(base), next), 'overdue');
    assert.equal(decideReminder(list({ ...base, overdue_notified: 1 }), next), null, 'only once');
    assert.equal(decideReminder(list({ ...base, items_done: 2 }), next), null, 'everything is done');
});

test('a snooze fires once it has ended, regardless of the hour', () => {
    const l = list({ deadline_notified: 1, overdue_notified: 1, remind_at: '2030-03-11T03:00:00Z' });
    assert.equal(decideReminder(l, at('2030-03-11T02:59:00Z')), null);
    assert.equal(decideReminder(l, at('2030-03-11T03:00:00Z')), 'snooze');
});

function setup({ lists, sendError }) {
    const marked = [];
    const sent = [];
    const db = {
        tasks: {
            getReminderCandidates: async () => lists,
            markReminderSent: async (id, kind, opts) => marked.push([id, kind, Boolean(opts && opts.late)])
        }
    };
    const client = {
        users: {
            fetch: async () => ({
                send: async (msg) => {
                    if (sendError) throw sendError;
                    sent.push(msg);
                }
            })
        }
    };
    return { db, client, marked, sent, log: () => {} };
}

const NOW = at('2030-03-10T09:00:00Z');

test('a list due today gets a DM with snooze buttons and is marked', async () => {
    const ctx = setup({ lists: [list()] });
    const res = await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.deepEqual(res, { sent: 1, skipped: 0, retry: 0 });
    assert.deepEqual(ctx.marked, [[1, 'due', false]]);
    assert.match(ctx.sent[0].embeds[0].title, /Today/);
    const ids = ctx.sent[0].components[0].toJSON().components.map((c) => c.custom_id);
    assert.deepEqual(ids, ['remind_snooze_1', 'remind_off']);
});

test('a late reminder says so and also counts as the overdue notice', async () => {
    const ctx = setup({ lists: [list({ deadline: '2030-03-08' })] });
    await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.match(ctx.sent[0].embeds[0].description, /Mar 8/);
    assert.deepEqual(ctx.marked, [[1, 'due', true]]);
});

test('lists that are not due yet are skipped', async () => {
    const ctx = setup({ lists: [list({ deadline: '2030-03-12' })] });
    const res = await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.deepEqual(res, { sent: 0, skipped: 0, retry: 0 });
    assert.equal(ctx.sent.length, 0);
});

test('closed DMs (50007) are marked so they are not retried every hour', async () => {
    const ctx = setup({ lists: [list()], sendError: Object.assign(new Error('Cannot send'), { code: 50007 }) });
    const res = await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.deepEqual(res, { sent: 0, skipped: 1, retry: 0 });
    assert.equal(ctx.marked.length, 1);
});

test('a temporary failure leaves the list unmarked so the next run retries it', async () => {
    const ctx = setup({ lists: [list(), list({ id: 2 })], sendError: Object.assign(new Error('Service unavailable'), { code: 0 }) });
    const res = await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.deepEqual(res, { sent: 0, skipped: 0, retry: 2 });
    assert.deepEqual(ctx.marked, []);
});

test('the snooze button defers 24 hours; stop turns reminders off', async () => {
    const calls = [];
    const db = {
        tasks: { snoozeList: async (user, id, until) => calls.push(['snooze', user, id, until.getTime()]) },
        users: { updateSettings: async (user, s) => calls.push(['settings', user, s]) }
    };
    const replies = [];
    const interaction = (customId) => ({ customId, user: { id: '42' }, update: async (r) => replies.push(r) });
    await handleButton(interaction('remind_snooze_7'), { db, now: NOW });
    assert.deepEqual(calls[0], ['snooze', '42', '7', NOW.getTime() + SNOOZE_MS]);
    assert.match(replies[0].content, /Snoozed/);
    assert.deepEqual(replies[0].components, []);
    await handleButton(interaction('remind_off'), { db, now: NOW });
    assert.deepEqual(calls[1], ['settings', '42', { automation_enabled: false }]);
});
