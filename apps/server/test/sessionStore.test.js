import test from 'node:test';
import assert from 'node:assert/strict';
import { DbSessionStore } from '../lib/sessionStore.js';

const fakePool = (handler) => ({ query: async (sql, params) => handler(sql, params) });
const call = (fn) => new Promise((resolve) => fn((err, value) => resolve({ err, value })));

test('get reads the stored session, and a missing one is null', async () => {
    const rows = { live: [{ data: JSON.stringify({ user: { discordId: '1' } }) }], gone: [] };
    const store = new DbSessionStore(fakePool((sql, [sid]) => [rows[sid]]), { ttlMs: 1000 });
    try {
        assert.deepEqual((await call((cb) => store.get('live', cb))).value, { user: { discordId: '1' } });
        assert.equal((await call((cb) => store.get('gone', cb))).value, null);
    } finally {
        store.close();
    }
});

test('a database error reaches the callback', async () => {
    const store = new DbSessionStore(
        fakePool(() => {
            throw new Error('down');
        }),
        { ttlMs: 1000 }
    );
    try {
        for (const run of [(cb) => store.get('x', cb), (cb) => store.set('x', {}, cb), (cb) => store.touch('x', {}, cb), (cb) => store.destroy('x', cb)]) {
            assert.equal((await call(run)).err.message, 'down');
        }
    } finally {
        store.close();
    }
});
