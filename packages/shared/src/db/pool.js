/**
 * MySQL connection pool shared by the bot and the web API.
 *
 * Configuration (environment):
 *   DB_URL                      mysql://user:pass@host:port/db  (takes precedence)
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 *   DB_SSL=true                 enable TLS (also applies to DB_URL)
 *   DB_SSL_CA                   optional PEM CA bundle (contents, not a path)
 *   DB_SSL_REJECT_UNAUTHORIZED  default true; only set to false for local testing
 *   DB_POOL_SIZE                default 10
 *
 * All connections use UTC (session time_zone '+00:00'), DATE columns are
 * returned as 'YYYY-MM-DD' strings, and BIGINTs beyond 2^53 come back as strings
 * instead of silently losing precision.
 */

'use strict';

const mysql = require('mysql2/promise');

let pool = null;

function buildConfig(env = process.env) {
    const config = {
        waitForConnections: true,
        connectionLimit: parseInt(env.DB_POOL_SIZE, 10) || 10,
        queueLimit: 0,
        timezone: 'Z',
        dateStrings: ['DATE'],
        supportBigNumbers: true,
        bigNumberStrings: false,
        decimalNumbers: true,
        charset: 'utf8mb4'
    };

    if (env.DB_URL) {
        config.uri = env.DB_URL;
    } else {
        config.host = env.DB_HOST || 'localhost';
        config.port = parseInt(env.DB_PORT, 10) || 3306;
        config.user = env.DB_USER || 'root';
        config.password = env.DB_PASSWORD || '';
        config.database = env.DB_NAME || 'taskquest';
    }

    if (env.DB_SSL === 'true') {
        config.ssl = { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
        if (env.DB_SSL_CA) config.ssl.ca = env.DB_SSL_CA;
        if (config.ssl.rejectUnauthorized === false) {
            console.warn('⚠️  DB_SSL_REJECT_UNAUTHORIZED=false: database TLS certificates are NOT verified.');
        }
    }

    return config;
}

/** Lazily create the pool. Safe to call many times. */
function getPool() {
    if (!pool) {
        pool = mysql.createPool(buildConfig());
        pool.pool.on('connection', (conn) => {
            conn.query("SET time_zone = '+00:00'");
        });
    }
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

/**
 * Run `fn(conn)` inside a transaction. Commits on success, rolls back on any
 * thrown error (which is re-thrown).
 */
async function withTransaction(fn) {
    const conn = await getPool().getConnection();
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    } catch (err) {
        try {
            await conn.rollback();
        } catch {
            /* connection may already be broken */
        }
        throw err;
    } finally {
        conn.release();
    }
}

/** Convenience: run a query on the pool and return rows. */
async function query(sql, params = []) {
    const [rows] = await getPool().execute(sql, params);
    return rows;
}

module.exports = { buildConfig, getPool, ping, closePool, withTransaction, query };
