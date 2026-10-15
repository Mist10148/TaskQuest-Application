'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mayDelete, completionContext } = require('../src/db/tasks');
const { parseImport } = require('../src/db/transfer');

test('an editor cannot delete a task somebody else finished, a manager can', () => {
    const task = { created_by: '10', first_completed_by: '20', completed_by: '20' };
    assert.equal(mayDelete('editor', task, '10'), false, 'the creator is an editor and another member finished it');
    assert.equal(mayDelete('manager', task, '30'), true);
    assert.equal(mayDelete('editor', { created_by: '10', first_completed_by: null, completed_by: null }, '10'), true, 'their own open task');
    assert.equal(mayDelete('editor', { created_by: '10', first_completed_by: '10', completed_by: '10' }, '10'), true, 'their own finished task');
    assert.equal(mayDelete('editor', { created_by: '20', first_completed_by: null, completed_by: null }, '10'), false, 'somebody else\'s task');
});

const list = (completed) => ({ lists: [{ name: 'L', items: [{ name: 'T', completed }] }] });

test('an import reads the completed flag strictly', () => {
    const flag = (v) => parseImport(list(v))[0].items[0].completed;
    for (const yes of [true, 1, 'true', 'yes', '1', 'done']) assert.equal(flag(yes), true, String(yes));
    for (const no of [false, 0, undefined, null, 'false', 'no', '0', '']) assert.equal(flag(no), false, String(no));
    assert.throws(() => flag('maybe'), /completed must be true or false/);
    assert.throws(() => flag({}), /completed must be true or false/);
});

test('an imported task never pays the list-cleared bonus', async () => {
    const conn = {
        query: async (sql) => {
            if (sql.includes('COUNT(*) AS total')) return [[{ total: 3, open: 0 }]];
            if (sql.includes('SELECT cleared_at')) return [[{ cleared_at: null }]];
            if (sql.includes('xp_transactions')) return [[{ n: 1 }]];
            if (sql.includes('timezone')) return [[{ timezone: null }]];
            throw new Error(`unexpected query: ${sql}`);
        }
    };
    const user = { discord_id: '1', player_class: 'DEFAULT', timezone: 'UTC' };
    const real = await completionContext(conn, { id: 1, list_id: 1, counts_for_quests: 1, priority: 'MEDIUM' }, user);
    const imported = await completionContext(conn, { id: 1, list_id: 1, counts_for_quests: 0, priority: 'MEDIUM' }, user);
    assert.equal(real.listCleared, true);
    assert.equal(imported.listCleared, false);
});

test('publicUser never carries the calendar token', () => {
    const { publicUser } = require('../src/db/users');
    const row = { discord_id: '1', player_class: 'HERO', calendar_token: 'secret-token' };
    const out = publicUser(row);
    assert.equal('calendar_token' in out, false);
    assert.equal(out.has_calendar_token, true);
    assert.equal(publicUser({ discord_id: '1', calendar_token: null }).has_calendar_token, false);
    assert.equal(out.player_class, 'HERO');
    assert.equal(row.calendar_token, 'secret-token', 'the row itself is not changed');
});
