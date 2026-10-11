'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

/** A pool whose connections only record what was asked of them. */
function fakePool(log) {
    let n = 0;
    return {
        pool: { on() {} },
        async getConnection() {
            const id = ++n;
            return {
                id,
                beginTransaction: async () => log.push(`begin ${id}`),
                commit: async () => log.push(`commit ${id}`),
                rollback: async () => log.push(`rollback ${id}`),
                release: () => log.push(`release ${id}`)
            };
        },
        end: async () => {}
    };
}

const deadlock = () => Object.assign(new Error('Deadlock found when trying to get lock'), { code: 'ER_LOCK_DEADLOCK', errno: 1213 });

async function load(log) {
    const original = mysql.createPool;
    mysql.createPool = () => fakePool(log);
    delete require.cache[require.resolve('../src/db/pool')];
    const pool = require('../src/db/pool');
    pool.getPool(); // create it now, while createPool is faked
    mysql.createPool = original;
    return pool;
}

test('withTransaction retries a deadlock victim on a fresh connection', async () => {
    const log = [];
    const { withTransaction } = await load(log);
    let calls = 0;
    const result = await withTransaction(async (conn) => {
        calls++;
        if (calls < 3) throw deadlock();
        return `done on ${conn.id}`;
    });
    assert.equal(calls, 3);
    assert.equal(result, 'done on 3');
    assert.deepEqual(log, ['begin 1', 'rollback 1', 'release 1', 'begin 2', 'rollback 2', 'release 2', 'begin 3', 'commit 3', 'release 3']);
});

test('withTransaction gives up after three deadlocks and re-throws', async () => {
    const log = [];
    const { withTransaction } = await load(log);
    let calls = 0;
    await assert.rejects(
        withTransaction(async () => {
            calls++;
            throw deadlock();
        }),
        { code: 'ER_LOCK_DEADLOCK' }
    );
    assert.equal(calls, 3);
    assert.equal(log.filter((l) => l.startsWith('rollback')).length, 3);
    assert.equal(log.filter((l) => l.startsWith('release')).length, 3, 'every connection goes back to the pool');
});

test('withTransaction does not retry other errors, including a lock wait timeout', async () => {
    const log = [];
    const { withTransaction } = await load(log);
    for (const err of [Object.assign(new Error('x'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 }), new Error('boom')]) {
        let calls = 0;
        await assert.rejects(
            withTransaction(async () => {
                calls++;
                throw err;
            }),
            (e) => e === err
        );
        assert.equal(calls, 1);
    }
});

test('withTransaction recognises a deadlock by errno alone', async () => {
    const { withTransaction } = await load([]);
    let calls = 0;
    await withTransaction(async () => {
        if (++calls === 1) throw Object.assign(new Error('d'), { errno: 1213 });
    });
    assert.equal(calls, 2);
});
