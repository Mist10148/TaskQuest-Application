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

test('a due snooze or first due reminder is skipped when every task is already done', () => {
    const done = { items_done: 2, items_total: 2 };
    assert.equal(decideReminder(list({ ...done, deadline_notified: 1, overdue_notified: 1, remind_at: '2030-03-09T03:00:00Z' }), NOW), 'snooze_done');
    assert.equal(decideReminder(list(done), NOW), 'due_done');
    assert.equal(decideReminder(list({ items_done: 0, items_total: 0 }), NOW), 'due', 'an empty list is still reminded');
});

test('finished lists get no DM but are marked handled so they are not picked up every hour', async () => {
    const ctx = setup({
        lists: [list({ items_done: 2, items_total: 2 }), list({ id: 2, items_done: 2, items_total: 2, deadline_notified: 1, overdue_notified: 1, remind_at: '2030-03-09T00:00:00Z' })]
    });
    const res = await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.equal(ctx.sent.length, 0);
    assert.equal(res.sent, 0);
    assert.deepEqual(ctx.marked.map(([id, kind]) => [id, kind]), [[1, 'due'], [2, 'snooze']]);
});

test('a snooze that fires after the deadline also marks the deadline as notified', async () => {
    const ctx = setup({ lists: [list({ deadline: '2030-03-08', deadline_notified: 1, overdue_notified: 1, remind_at: '2030-03-09T00:00:00Z' })] });
    const calls = [];
    ctx.db.tasks.markReminderSent = async (id, kind, opts) => calls.push([id, kind, opts]);
    await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.deepEqual(calls, [[1, 'snooze', { late: true, pastDeadline: true }]]);

    const today = setup({ lists: [list({ remind_at: '2030-03-09T00:00:00Z' })] });
    const t = [];
    today.db.tasks.markReminderSent = async (id, kind, opts) => t.push(opts);
    await sendDeadlineReminders({ ...today, now: NOW });
    assert.deepEqual(t, [{ late: false, pastDeadline: true }], 'due today: counts as the due notice only');
});

// ─── Per-task reminders ──────────────────────────────────────────────────────

const { sendTaskReminders, decideTaskReminder, taskReminderMessage } = require('../utils/reminders');

const task = (over = {}) => ({
    id: 5,
    discord_id: '42',
    name: 'Pay rent',
    list_name: 'Home',
    due_date: '2030-03-10',
    timezone: null,
    reminder_hour: 9,
    remind_at: null,
    reminded_at: null,
    ...over
});

test('a task due today is reminded at the reminder hour in the owner\'s zone, once', () => {
    const t = task({ timezone: 'Asia/Manila' });
    assert.equal(decideTaskReminder(t, at('2030-03-10T00:30:00Z')), null, '08:30 in Manila');
    assert.equal(decideTaskReminder(t, at('2030-03-10T01:00:00Z')), 'due');
    assert.equal(decideTaskReminder(task({ due_date: '2030-03-11' }), NOW), null, 'not due yet');
    assert.equal(decideTaskReminder(task({ reminded_at: '2030-03-10T09:00:00Z' }), NOW), null, 'already sent');
});

test('a missed task reminder is still sent for 3 days, then dropped', () => {
    assert.equal(decideTaskReminder(task({ due_date: '2030-03-07' }), NOW), 'due');
    assert.equal(decideTaskReminder(task({ due_date: '2030-03-06' }), NOW), null);
});

test('a task snooze fires once it has ended, regardless of the hour', () => {
    const t = task({ reminded_at: '2030-03-10T09:00:00Z', remind_at: '2030-03-11T03:00:00Z' });
    assert.equal(decideTaskReminder(t, at('2030-03-11T02:59:00Z')), null);
    assert.equal(decideTaskReminder(t, at('2030-03-11T03:00:00Z')), 'snooze');
});

test('task reminders DM with task_remind_snooze_<id> and the shared stop button, then mark the task', async () => {
    const marked = [];
    const sent = [];
    const db = { tasks: { getTaskReminderCandidates: async () => [task(), task({ id: 6, due_date: '2030-03-12' })], markTaskReminderSent: async (id) => marked.push(id) } };
    const client = { users: { fetch: async () => ({ send: async (m) => sent.push(m) }) } };
    const res = await sendTaskReminders({ db, client, log: () => {}, now: NOW });
    assert.deepEqual(res, { sent: 1, skipped: 0, retry: 0 });
    assert.deepEqual(marked, [5]);
    assert.match(sent[0].embeds[0].description, /Pay rent/);
    assert.deepEqual(sent[0].components[0].toJSON().components.map((c) => c.custom_id), ['task_remind_snooze_5', 'remind_off']);
});

test('task reminders: closed DMs are marked, temporary errors are retried', async () => {
    const run = async (code) => {
        const marked = [];
        const db = { tasks: { getTaskReminderCandidates: async () => [task()], markTaskReminderSent: async (id) => marked.push(id) } };
        const client = { users: { fetch: async () => ({ send: async () => { throw Object.assign(new Error('x'), { code }); } }) } };
        return [await sendTaskReminders({ db, client, log: () => {}, now: NOW }), marked];
    };
    assert.deepEqual(await run(50007), [{ sent: 0, skipped: 1, retry: 0 }, [5]]);
    assert.deepEqual(await run(0), [{ sent: 0, skipped: 0, retry: 1 }, []]);
});

test('an overdue task reminder says so; the snooze button snoozes the task, not a list', async () => {
    assert.match(taskReminderMessage(task({ due_date: '2030-03-08' }), 'due', NOW).embeds[0].title, /overdue/);
    const calls = [];
    const db = { tasks: { snoozeTask: async (u, id, until) => calls.push([u, id, until.getTime()]), snoozeList: async () => calls.push('list') } };
    const replies = [];
    await handleButton({ customId: 'task_remind_snooze_5', user: { id: '42' }, update: async (r) => replies.push(r) }, { db, now: NOW });
    assert.deepEqual(calls, [['42', '5', NOW.getTime() + SNOOZE_MS]]);
    assert.match(replies[0].content, /Snoozed/);
});

// ─── Web push mirror (best effort) ───────────────────────────────────────────

const { pushForList, pushForTask } = require('../utils/reminders');

const fakePush = (over = {}) => {
    const calls = [];
    return { calls, enabled: true, notify: async (id, msg) => (calls.push([id, msg]), true), ...over };
};

test('a list reminder is also pushed once the DM is final, and not for finished lists', async () => {
    const push = fakePush();
    const ctx = setup({ lists: [list(), list({ id: 2, name: 'Done', items_done: 2, items_total: 2 })] });
    await sendDeadlineReminders({ ...ctx, push, now: NOW });
    assert.equal(push.calls.length, 1, 'the finished list sends nothing, so it pushes nothing');
    assert.equal(push.calls[0][0], '42');
    assert.deepEqual(push.calls[0][1], { title: 'Deadline today', body: 'Taxes: 1/2 tasks done', url: '/tasks' });
});

test('a temporary DM failure retries without pushing; a permanent one still pushes once', async () => {
    const retry = fakePush();
    await sendDeadlineReminders({ ...setup({ lists: [list()], sendError: Object.assign(new Error('x'), { code: 0 }) }), push: retry, now: NOW });
    assert.equal(retry.calls.length, 0);
    const closed = fakePush();
    await sendDeadlineReminders({ ...setup({ lists: [list()], sendError: Object.assign(new Error('x'), { code: 50007 }) }), push: closed, now: NOW });
    assert.equal(closed.calls.length, 1);
});

test('a broken or disabled push client never breaks the reminder', async () => {
    const throwing = fakePush({ notify: async () => { throw new Error('boom'); } });
    const ctx = setup({ lists: [list()] });
    const res = await sendDeadlineReminders({ ...ctx, push: throwing, now: NOW });
    assert.deepEqual(res, { sent: 1, skipped: 0, retry: 0 });
    assert.deepEqual(ctx.marked, [[1, 'due', false]]);
    const off = fakePush({ enabled: false });
    await sendDeadlineReminders({ ...setup({ lists: [list()] }), push: off, now: NOW });
    assert.equal(off.calls.length, 0);
    const res2 = await sendDeadlineReminders({ ...setup({ lists: [list()] }), now: NOW });
    assert.equal(res2.sent, 1, 'no push client at all is fine');
});

test('task reminders push too, titled by lateness', async () => {
    const push = fakePush();
    const db = { tasks: { getTaskReminderCandidates: async () => [task()], markTaskReminderSent: async () => {} } };
    const client = { users: { fetch: async () => ({ send: async () => {} }) } };
    await sendTaskReminders({ db, client, log: () => {}, push, now: NOW });
    assert.equal(push.calls.length, 1);
    assert.match(push.calls[0][1].body, /Pay rent/);
    assert.equal(pushForTask(task({ due_date: '2030-03-08' }), 'due', NOW).title, 'Task overdue');
    assert.equal(pushForTask(task(), 'snooze', NOW).title, 'Task reminder');
    assert.equal(pushForList(list({ deadline: '2030-03-08' }), 'overdue', NOW).title, 'Overdue');
});

test('a member of a shared list is marked for themselves; the owner keeps the list-level marker', async () => {
    const ctx = setup({ lists: [list({ id: 1, owner_id: '42', discord_id: '42' }), list({ id: 1, owner_id: '42', discord_id: '77' })] });
    const calls = [];
    ctx.db.tasks.markReminderSent = async (id, kind, opts) => calls.push([id, kind, opts]);
    await sendDeadlineReminders({ ...ctx, now: new Date('2030-03-10T10:00:00Z') });
    assert.deepEqual(calls.map(([, , opts]) => opts.recipientId), [undefined, '77'], 'only the member row carries a recipient');
    assert.equal(ctx.sent.length, 2, 'each of them is messaged once');

    const marked = [];
    const db = {
        tasks: {
            getTaskReminderCandidates: async () => [task({ id: 5, owner_id: '42', discord_id: '42' }), task({ id: 5, owner_id: '42', discord_id: '77' })],
            markTaskReminderSent: async (...args) => marked.push(args.slice(2))
        }
    };
    await sendTaskReminders({ db, client: ctx.client, log: () => {}, now: new Date('2030-03-10T10:00:00Z') });
    assert.deepEqual(marked, [[], ['77']]);
});
