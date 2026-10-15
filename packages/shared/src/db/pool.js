/**
 * PostgreSQL connection pool shared by the bot and the web API.
 *
 * Configuration (environment):
 *   DB_URL                      postgresql://user:pass@host:port/db  (takes precedence)
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *   DB_SSL=true                 enable TLS (also applies to DB_URL)
 *   DB_SSL_CA                   optional PEM CA bundle (contents, not a path)
 *   DB_SSL_REJECT_UNAUTHORIZED  default true; only set to false for local testing
 *   DB_POOL_SIZE                default 10
 *
 * All connections use UTC (session TimeZone 'UTC'), DATE columns are returned as
 * 'YYYY-MM-DD' strings, and BIGINTs (COUNT, SUM) come back as numbers, or as strings
 * beyond 2^53 instead of silently losing precision.
 *
 * The data layer was written for mysql2 and keeps its calling convention, which this
 * module provides on top of node-postgres:
 *   - `?` placeholders (rewritten to $1, $2, ...; quoted text and comments are left alone)
 *   - query() resolves to [rows, fields] for a SELECT, and to [header] for INSERT / UPDATE / DELETE,
 *     where header = { affectedRows, insertId, rows }. insertId is the `id` of the first row a
 *     RETURNING clause gave back, so an insert that needs its new id ends in `RETURNING id`.
 *   - boolean parameters are sent as 1 / 0 (flag columns are SMALLINT) and undefined as NULL.
 */

'use strict';

const pg = require('pg');

// BIGINT (COUNT, SUM, BIGINT columns): a number while it is exact, else the string.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v;
});
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => parseFloat(v));
// DATE stays 'YYYY-MM-DD': a calendar day, not an instant.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

let pool = null;

function isTrue(value) {
    return /^(true|1|yes)$/i.test(String(value || '').trim());
}

function buildConfig(env = process.env) {
    const config = {
        max: parseInt(env.DB_POOL_SIZE, 10) || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
        // Date logic assumes UTC sessions, so a connection that cannot switch is dropped rather than used.
        // (Set per connection rather than as a startup option, which connection poolers may not pass on.)
        onConnect: (client) => client.query("SET TIME ZONE 'UTC'")
    };

    if (env.DB_URL) {
        config.connectionString = env.DB_URL;
    } else {
        config.host = env.DB_HOST || 'localhost';
        config.port = parseInt(env.DB_PORT, 10) || 5432;
        config.user = env.DB_USER || 'postgres';
        config.password = env.DB_PASSWORD || '';
        config.database = env.DB_NAME || 'taskquest';
        if (env.NODE_ENV === 'production' && !env.DB_USER && !env.DB_PASSWORD) {
            console.warn('⚠️  No DB_URL, DB_USER or DB_PASSWORD set in production: connecting as postgres with an empty password.');
        }
    }

    if (isTrue(env.DB_SSL)) {
        config.ssl = { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
        if (env.DB_SSL_CA) config.ssl.ca = env.DB_SSL_CA;
        if (config.ssl.rejectUnauthorized === false) {
            console.warn('⚠️  DB_SSL_REJECT_UNAUTHORIZED=false: database TLS certificates are NOT verified.');
        }
    }

    return config;
}

// ─── mysql2-style placeholders ──────────────────────────────────────────────────

const translated = new Map();
const TRANSLATION_CACHE_SIZE = 2000;

/**
 * Rewrite `?` placeholders to `$1..$n`, skipping string literals ('...', E'...', $tag$...$tag$),
 * quoted identifiers and comments.
 * @returns {{ text: string, count: number }}
 */
function toPositional(sql) {
    const cached = translated.get(sql);
    if (cached) return cached;

    let out = '';
    let count = 0;
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const c = sql[i];
        if (c === "'") {
            // E'...' strings treat backslash as an escape; standard strings only double the quote.
            const escapes = i > 0 && /[eE]/.test(sql[i - 1]) && (i < 2 || !/[\w$]/.test(sql[i - 2]));
            let j = i + 1;
            while (j < n) {
                if (escapes && sql[j] === '\\') j += 2;
                else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
                else if (sql[j] === "'") break;
                else j++;
            }
            out += sql.slice(i, j + 1);
            i = j + 1;
        } else if (c === '"') {
            let j = i + 1;
            while (j < n && !(sql[j] === '"' && sql[j + 1] !== '"')) j += sql[j] === '"' ? 2 : 1;
            out += sql.slice(i, j + 1);
            i = j + 1;
        } else if (c === '-' && sql[i + 1] === '-') {
            const j = sql.indexOf('\n', i);
            const end = j === -1 ? n : j;
            out += sql.slice(i, end);
            i = end;
        } else if (c === '/' && sql[i + 1] === '*') {
            const j = sql.indexOf('*/', i + 2);
            const end = j === -1 ? n : j + 2;
            out += sql.slice(i, end);
            i = end;
        } else if (c === '$' && /[A-Za-z_$]/.test(sql[i + 1] || '') && (i === 0 || !/[\w$]/.test(sql[i - 1]))) {
            const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
            if (m) {
                const j = sql.indexOf(m[0], i + m[0].length);
                const end = j === -1 ? n : j + m[0].length;
                out += sql.slice(i, end);
                i = end;
            } else {
                out += c;
                i++;
            }
        } else if (c === '?') {
            out += `$${++count}`;
            i++;
        } else {
            out += c;
            i++;
        }
    }

    const result = { text: out, count };
    if (translated.size >= TRANSLATION_CACHE_SIZE) translated.clear();
    translated.set(sql, result);
    return result;
}

function toParam(value) {
    if (value === undefined) return null;
    if (value === true) return 1;
    if (value === false) return 0;
    return value;
}

const WRITE_COMMANDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE']);

/** Shape a pg result like mysql2: [rows, fields] for reads, [{ affectedRows, insertId, rows }] for writes. */
function shape(result) {
    if (Array.isArray(result)) return [result.map((r) => shape(r)[0])];
    if (WRITE_COMMANDS.has(result.command)) {
        const first = result.rows && result.rows[0];
        return [{ affectedRows: result.rowCount || 0, insertId: first && first.id != null ? first.id : 0, rows: result.rows || [] }];
    }
    return [result.rows || [], result.fields || []];
}

async function run(client, sql, params) {
    if (params === undefined || params === null || (Array.isArray(params) && !params.length)) {
        return shape(await client.query(sql));
    }
    const values = (Array.isArray(params) ? params : [params]).map(toParam);
    const { text } = toPositional(sql);
    return shape(await client.query(text, values));
}

/** A checked-out connection with the mysql2 connection methods the data layer uses. */
class Connection {
    constructor(client) {
        this.client = client;
        this.inTransaction = false;
    }

    query(sql, params) {
        return run(this.client, sql, params);
    }

    execute(sql, params) {
        return run(this.client, sql, params);
    }

    async beginTransaction() {
        await this.client.query('BEGIN');
        this.inTransaction = true;
    }

    async commit() {
        this.inTransaction = false;
        await this.client.query('COMMIT');
    }

    async rollback() {
        this.inTransaction = false;
        await this.client.query('ROLLBACK');
    }

    async ping() {
        await this.client.query('SELECT 1');
    }

    release(err) {
        this.client.release(err);
    }
}

/** The pool, with mysql2's query / execute / getConnection / end. `pool.pg` is the node-postgres pool. */
class Pool {
    constructor(config) {
        this.pg = new pg.Pool(config);
        // An idle client that loses its connection must not crash the process.
        this.pg.on('error', (err) => console.error('Database connection error:', err.message));
    }

    query(sql, params) {
        return run(this.pg, sql, params);
    }

    execute(sql, params) {
        return run(this.pg, sql, params);
    }

    async getConnection() {
        return new Connection(await this.pg.connect());
    }

    end() {
        return this.pg.end();
    }
}

/** Lazily create the pool. Safe to call many times. */
function getPool() {
    if (!pool) pool = new Pool(buildConfig());
    return pool;
}

/** Check connectivity (used at startup and by health checks). */
async function ping() {
    const conn = await getPool().getConnection();
    try {
        await conn.ping();
    } finally {
        conn.release();
    }
}

async function closePool() {
    if (pool) {
        const p = pool;
        pool = null;
        await p.end();
    }
}

/** Postgres chose this transaction as a deadlock or serialization victim; nothing it did was kept, so it is safe to run again. */
function isDeadlock(err) {
    return Boolean(err) && (err.code === '40P01' || err.code === '40001');
}

/** A UNIQUE or PRIMARY KEY constraint rejected the row. */
function isUniqueViolation(err) {
    return Boolean(err) && err.code === '23505';
}

/** The table does not exist (yet). */
function isUndefinedTable(err) {
    return Boolean(err) && err.code === '42P01';
}

const DEADLOCK_ATTEMPTS = 3;

/**
 * Run `fn(conn)` inside a transaction. Commits on success, rolls back on any
 * thrown error (which is re-thrown). A deadlock victim (and only that) is retried on a fresh
 * connection, up to 3 attempts in all, so `fn` must keep its side effects inside the transaction.
 * Lock order everywhere is: the user row first, then the list or item rows, so this stays rare.
 */
async function withTransaction(fn) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await runTransaction(fn);
        } catch (err) {
            if (!isDeadlock(err) || attempt >= DEADLOCK_ATTEMPTS) throw err;
            await new Promise((resolve) => setTimeout(resolve, attempt * 10 + Math.floor(Math.random() * 20)));
        }
    }
}

async function runTransaction(fn) {
    const conn = await getPool().getConnection();
    let broken = null;
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    } catch (err) {
        try {
            await conn.rollback();
        } catch (rollbackErr) {
            // The connection is unusable; drop it instead of returning it to the pool.
            broken = rollbackErr;
        }
        throw err;
    } finally {
        conn.release(broken || undefined);
    }
}

let savepoints = 0;

/**
 * Run `fn()` so that an error it throws (and catches, e.g. a duplicate key to retry) does not abort the
 * surrounding transaction: Postgres refuses every statement after a failed one until the transaction ends,
 * so inside a transaction this wraps `fn` in a SAVEPOINT and rolls back to it on error. Outside a
 * transaction (`conn` is the pool, or missing) it simply runs `fn`.
 */
async function savepoint(conn, fn) {
    if (!(conn instanceof Connection) || !conn.inTransaction) return fn();
    const name = `tq_sp_${++savepoints}`;
    await conn.client.query(`SAVEPOINT ${name}`);
    try {
        const result = await fn();
        await conn.client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
    } catch (err) {
        await conn.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw err;
    }
}

/** Convenience: run a query on the pool and return rows. */
async function query(sql, params = []) {
    const [rows] = await getPool().execute(sql, params);
    return rows;
}

module.exports = {
    buildConfig,
    getPool,
    ping,
    closePool,
    withTransaction,
    isDeadlock,
    isUniqueViolation,
    isUndefinedTable,
    savepoint,
    query,
    toPositional
};
