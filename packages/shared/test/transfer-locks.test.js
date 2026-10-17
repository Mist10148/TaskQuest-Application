/**
 * Handing a list over locks the new owner's account BEFORE the list row, the same order every other writer uses
 * (user row, then list; see access.js), so it can count that person's lists and tasks without a concurrent add
 * slipping past the limit and without a lock cycle. No database: a fake pg pool records the queries.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('pg');

const O = '100000000000000911';
const N = '100000000000000912';
const KEY = 'abcdefabcdef';

/** Rows the fake database answers with, by what the query is about. */
function answer(text, { memberRow = { discord_id: N, public_id: KEY, role: 'editor' }, items = 0 } = {}) {
    if (text.includes('FROM lists l LEFT JOIN list_members')) return [{ id: 7, name: 'Handover', discord_id: O, owner_id: O, member_role: null }];
    if (text.startsWith('SELECT discord_id FROM list_members')) return memberRow ? [{ discord_id: memberRow.discord_id }] : [];
    if (text.startsWith('SELECT * FROM list_members')) return memberRow ? [memberRow] : [];
    if (text.startsWith('SELECT * FROM users')) return [{ discord_id: N }];
    if (text.includes('COUNT(*)')) return [{ n: items }];
    return [];
}

function load(calls, options) {
    const original = pg.Pool;
    pg.Pool = class FakePool {
        on() {}
        async connect() {
            return {
                async query(text, values) {
                    calls.push({ text: String(text).replace(/\s+/g, ' ').trim(), values });
                    const command = /^(INSERT|UPDATE|DELETE)/.exec(String(text).trim())?.[1] || 'SELECT';
                    return { command, rowCount: 1, rows: command === 'SELECT' ? answer(String(text).trim(), options) : [], fields: [] };
                },
                release() {}
            };
        }
        async end() {}
    };
    for (const m of ['../src/db/pool', '../src/db/access', '../src/db/users', '../src/db/sharing']) delete require.cache[require.resolve(m)];
    const pool = require('../src/db/pool');
    pool.getPool(); // create it now, while pg.Pool is faked
    pg.Pool = original;
    return require('../src/db/sharing');
}

const indexOfQuery = (calls, pattern) => calls.findIndex((c) => pattern.test(c.text));

test('the new owner is locked before the list, then the list and member are re-checked', async () => {
    const calls = [];
    const sharing = load(calls);
    const result = await sharing.transferOwnership(O, 7, KEY);
    assert.equal(result.role, 'manager');

    const lockNewOwner = indexOfQuery(calls, /^SELECT \* FROM users WHERE discord_id = \$1 FOR UPDATE$/);
    const lockList = indexOfQuery(calls, /FOR UPDATE OF l$/);
    const updateOwner = indexOfQuery(calls, /^UPDATE lists SET discord_id/);
    assert.ok(lockNewOwner >= 0, 'the new owner\'s account was locked');
    assert.deepEqual(calls[lockNewOwner].values, [N], 'it is the new owner who is locked, not the actor');
    assert.ok(lockList > lockNewOwner, 'the list row is locked after the user row');
    assert.ok(updateOwner > lockList, 'the list moves only once both are locked');

    const counts = calls.map((c, i) => [c, i]).filter(([c]) => c.text.includes('COUNT(*)'));
    assert.ok(counts.length >= 2 && counts.every(([, i]) => i > lockNewOwner), 'limits are counted under the user lock');
});

test('a member key that is not a member is refused before anything is locked', async () => {
    const calls = [];
    const sharing = load(calls, { memberRow: null });
    await assert.rejects(sharing.transferOwnership(O, 7, KEY), { code: 'NOT_FOUND' });
    assert.equal(indexOfQuery(calls, /^SELECT \* FROM users/), -1, 'no account was locked');
    assert.equal(indexOfQuery(calls, /FOR UPDATE OF l$/), -1, 'the list was not locked');

    const bad = load([], undefined);
    await assert.rejects(bad.transferOwnership(O, 7, 'owner'), { code: 'NOT_FOUND' });
});

test('only the owner can start a hand-over, and a limit still stops it', async () => {
    const calls = [];
    const notOwner = load(calls);
    await assert.rejects(notOwner.transferOwnership(N, 7, KEY), { code: 'FORBIDDEN' });
    assert.equal(indexOfQuery(calls, /^SELECT \* FROM users/), -1, 'a non-owner locks nothing');

    const full = load([], { items: 5000 });
    await assert.rejects(full.transferOwnership(O, 7, KEY), { code: 'VALIDATION' });
});
