'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { completionContext } = require('../src/db/tasks');
const { LIMITS } = require('../src');

const NOW = new Date();
const DAY = 86400e3;
const day = (offset) => new Date(NOW.getTime() + offset * DAY).toISOString().slice(0, 10);

/** A connection that answers the queries completionContext makes; `dated` is the day's count of early or overdue first completions. */
const fakeConn = (dated) => ({
    query: async (sql) => {
        if (sql.includes('first_completed_early')) return [[{ n: dated }]];
        if (sql.includes('COUNT(*) AS total')) return [[{ total: 1, open: 1 }]];
        if (sql.includes('SELECT cleared_at')) return [[{ cleared_at: null }]];
        if (sql.includes('xp_transactions')) return [[{ n: 1 }]];
        if (sql.includes('timezone')) return [[{ timezone: null }]];
        throw new Error(`unexpected query: ${sql}`);
    }
});

const overdueItem = { id: 1, list_id: 1, due_date: day(-3), due_date_set_at: new Date(NOW.getTime() - 10 * DAY), priority: 'MEDIUM' };
const user = (cls) => ({ discord_id: '1', player_class: cls, timezone: 'UTC' });

test('the first CLASS_DEADLINE_PER_DAY early or overdue completions count for the Necromancer and Ranger, the rest do not', async () => {
    for (const cls of ['NECROMANCER', 'RANGER']) {
        const within = await completionContext(fakeConn(LIMITS.CLASS_DEADLINE_PER_DAY), overdueItem, user(cls), NOW);
        assert.equal(within.overdueDays, 3, `${cls} within the limit`);
        assert.equal(within.dueDate, day(-3));
        const over = await completionContext(fakeConn(LIMITS.CLASS_DEADLINE_PER_DAY + 1), overdueItem, user(cls), NOW);
        assert.equal(over.overdueDays, 0, `${cls} past the limit`);
        assert.equal(over.dueDate, null);
    }
});

test('other classes keep their context whatever the day count', async () => {
    const conn = { query: async (sql) => (sql.includes('first_completed_early') ? Promise.reject(new Error('must not run')) : fakeConn(0).query(sql)) };
    const ctx = await completionContext(conn, overdueItem, user('MONK'), NOW);
    assert.equal(ctx.overdueDays, 3);
});
