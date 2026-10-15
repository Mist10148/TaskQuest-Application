'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pg = require('pg');

const WORDS = { BEGIN: 'begin', COMMIT: 'commit', ROLLBACK: 'rollback' };

/** A node-postgres pool whose clients only record what was asked of them. */
function fakePgPool(log, calls) {
    let n = 0;
    return class FakePool {
        on() {}
        async connect() {
            const id = ++n;
            return {
                id,
                async query(text, values) {
                    calls.push({ text, values });
                    if (WORDS[text]) log.push(`${WORDS[text]} ${id}`);
                    return { command: 'SELECT', rows: [], fields: [] };
                },
                release: () => log.push(`release ${id}`)
            };
        }
        async query(text, values) {
            calls.push({ text, values });
            return text.startsWith('INSERT')
                ? { command: 'INSERT', rowCount: 1, rows: [{ id: 42 }] }
                : { command: 'SELECT', rows: [{ n: 1 }], fields: [] };
        }
        async end() {}
    };
}

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });

function load(log = [], calls = []) {
    const original = pg.Pool;
    pg.Pool = fakePgPool(log, calls);
    delete require.cache[require.resolve('../src/db/pool')];
    const pool = require('../src/db/pool');
    pool.getPool(); // create it now, while pg.Pool is faked
    pg.Pool = original;
    return pool;
}

test('withTransaction retries a deadlock victim on a fresh connection', async () => {
    const log = [];
    const { withTransaction } = load(log);
    let calls = 0;
    const result = await withTransaction(async (conn) => {
        calls++;
        if (calls < 3) throw deadlock();
        return `done on ${conn.client.id}`;
    });
    assert.equal(calls, 3);
    assert.equal(result, 'done on 3');
    assert.deepEqual(log, ['begin 1', 'rollback 1', 'release 1', 'begin 2', 'rollback 2', 'release 2', 'begin 3', 'commit 3', 'release 3']);
});

test('withTransaction gives up after three deadlocks and re-throws', async () => {
    const log = [];
    const { withTransaction } = load(log);
    let calls = 0;
    await assert.rejects(
        withTransaction(async () => {
            calls++;
            throw deadlock();
        }),
        { code: '40P01' }
    );
    assert.equal(calls, 3);
    assert.equal(log.filter((l) => l.startsWith('rollback')).length, 3);
    assert.equal(log.filter((l) => l.startsWith('release')).length, 3, 'every connection goes back to the pool');
});

test('withTransaction does not retry other errors, including a lock timeout', async () => {
    const { withTransaction } = load();
    for (const err of [Object.assign(new Error('x'), { code: '55P03' }), new Error('boom')]) {
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

test('withTransaction retries a serialization failure', async () => {
    const { withTransaction } = load();
    let calls = 0;
    await withTransaction(async () => {
        if (++calls === 1) throw Object.assign(new Error('s'), { code: '40001' });
    });
    assert.equal(calls, 2);
});

test('toPositional numbers ? placeholders and leaves quoted text and comments alone', () => {
    const { toPositional } = load();
    assert.deepEqual(toPositional('SELECT * FROM t WHERE a = ? AND b IN (?, ?)'), { text: 'SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)', count: 3 });
    assert.equal(toPositional("SELECT '?', 'it''s ?', E'\\'?', \"col?\" FROM t WHERE x = ?").text, "SELECT '?', 'it''s ?', E'\\'?', \"col?\" FROM t WHERE x = $1");
    assert.equal(toPositional('SELECT 1 -- why?\n, ? /* what? */').text, 'SELECT 1 -- why?\n, $1 /* what? */');
    assert.equal(toPositional('SELECT $$a?b$$, ?').text, 'SELECT $$a?b$$, $1');
    assert.equal(toPositional("SELECT name LIKE ? ESCAPE '\\' FROM t WHERE id = ?").text, "SELECT name LIKE $1 ESCAPE '\\' FROM t WHERE id = $2");
});

test('query shapes results like mysql2 and converts booleans and undefined', async () => {
    const calls = [];
    const { getPool } = load([], calls);
    const [rows] = await getPool().query('SELECT ? AS n, ? AS m, ? AS u', [true, false, undefined]);
    assert.deepEqual(rows, [{ n: 1 }]);
    assert.deepEqual(calls.at(-1), { text: 'SELECT $1 AS n, $2 AS m, $3 AS u', values: [1, 0, null] });
    const [header] = await getPool().query('INSERT INTO t (a) VALUES (?) RETURNING id', ['x']);
    assert.equal(header.insertId, 42);
    assert.equal(header.affectedRows, 1);
});

test('error helpers recognise Postgres SQLSTATEs', () => {
    const { isUniqueViolation, isUndefinedTable, isDeadlock } = load();
    assert.equal(isUniqueViolation({ code: '23505' }), true);
    assert.equal(isUniqueViolation({ code: '23503' }), false);
    assert.equal(isUndefinedTable({ code: '42P01' }), true);
    assert.equal(isDeadlock({ code: '40P01' }), true);
    assert.equal(isDeadlock(null), false);
});
