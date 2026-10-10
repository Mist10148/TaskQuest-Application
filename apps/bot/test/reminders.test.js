/** Deadline reminders: due or overdue lists are DMed, and only unrecoverable failures are marked as done. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendDeadlineReminders } = require('../utils/reminders');

const NOW = new Date('2030-03-10T09:00:00Z');

function setup({ lists, sendError }) {
    const marked = [];
    const sent = [];
    const db = {
        tasks: {
            getListsDueBy: async () => lists,
            getItems: async () => [{ completed: 1 }, { completed: 0 }],
            markDeadlineNotified: async (id) => marked.push(id)
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

const list = (over = {}) => ({ id: 1, discord_id: '42', name: 'Taxes', deadline: '2030-03-10', category: 'Home', ...over });

test('a list due today gets a DM and is marked as notified', async () => {
    const ctx = setup({ lists: [list()] });
    const res = await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.deepEqual(res, { sent: 1, skipped: 0, retry: 0 });
    assert.deepEqual(ctx.marked, [1]);
    assert.match(ctx.sent[0].embeds[0].title, /Today/);
});

test('a missed reminder is sent late with an overdue message', async () => {
    const ctx = setup({ lists: [list({ deadline: '2030-03-08' })] });
    await sendDeadlineReminders({ ...ctx, now: NOW });
    const embed = ctx.sent[0].embeds[0];
    assert.match(embed.title, /Passed/);
    assert.match(embed.description, /Mar 8/);
});

test('closed DMs (50007) are marked so they are not retried every hour', async () => {
    const ctx = setup({ lists: [list()], sendError: Object.assign(new Error('Cannot send'), { code: 50007 }) });
    const res = await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.deepEqual(res, { sent: 0, skipped: 1, retry: 0 });
    assert.deepEqual(ctx.marked, [1]);
});

test('a temporary failure leaves the list unmarked so the next run retries it', async () => {
    const ctx = setup({ lists: [list(), list({ id: 2 })], sendError: Object.assign(new Error('Service unavailable'), { code: 0 }) });
    const res = await sendDeadlineReminders({ ...ctx, now: NOW });
    assert.deepEqual(res, { sent: 0, skipped: 0, retry: 2 });
    assert.deepEqual(ctx.marked, []);
});
