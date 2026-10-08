#!/usr/bin/env node
/**
 * Versioned schema migrations. This is the ONLY place that changes the
 * database schema — neither app runs ALTER/CREATE statements at runtime.
 *
 *   npm run db:migrate            (from the repo root)
 *
 * Each migration runs once and is recorded in `schema_migrations`.
 * Migrations are written in JS (not raw SQL) so they can check
 * information_schema and stay idempotent on both MySQL 8 and MariaDB, which
 * disagree on syntax such as `ADD COLUMN IF NOT EXISTS`.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { getPool, closePool } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ─── Helpers passed to every migration ────────────────────────────────────────

function helpers(conn) {
    const one = async (sql, params) => (await conn.query(sql, params))[0][0];

    return {
        conn,
        exec: (sql, params) => conn.query(sql, params),
        async tableExists(table) {
            const row = await one(
                'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
                [table]
            );
            return Number(row.n) > 0;
        },
        async columnInfo(table, column) {
            return one(
                `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [table, column]
            );
        },
        async columnExists(table, column) {
            return Boolean(await this.columnInfo(table, column));
        },
        async indexExists(table, index) {
            const row = await one(
                'SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
                [table, index]
            );
            return Number(row.n) > 0;
        },
        /** True if `table.column` already has any foreign key to `refTable`. */
        async foreignKeyExists(table, column, refTable) {
            const row = await one(
                `SELECT COUNT(*) AS n FROM information_schema.KEY_COLUMN_USAGE
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
                [table, column, refTable]
            );
            return Number(row.n) > 0;
        },
        async addColumnIfMissing(table, column, definition) {
            if (await this.columnExists(table, column)) return false;
            await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
            return true;
        },
        async addIndexIfMissing(table, index, definition) {
            if (await this.indexExists(table, index)) return false;
            await conn.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
            return true;
        },
        async addForeignKeyIfMissing(table, column, refTable, refColumn, name) {
            if (await this.foreignKeyExists(table, column, refTable)) return false;
            await conn.query(
                `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\` (\`${refColumn}\`) ON DELETE CASCADE`
            );
            return true;
        }
    };
}

function loadMigrations() {
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => /^\d{3}_.+\.js$/.test(f))
        .sort()
        .map((file) => {
            const mod = require(path.join(MIGRATIONS_DIR, file));
            return { id: file.replace(/\.js$/, ''), description: mod.description || '', up: mod.up };
        });
}

/**
 * Apply all pending migrations. Uses a named lock so two processes (bot and
 * web booting together) never migrate concurrently.
 * @returns {Promise<string[]>} ids of migrations applied in this run
 */
async function runMigrations({ log = console.log } = {}) {
    const conn = await getPool().getConnection();
    const applied = [];
    try {
        const [[lock]] = await conn.query("SELECT GET_LOCK('taskquest_migrations', 60) AS ok");
        if (Number(lock.ok) !== 1) throw new Error('Could not acquire migration lock');

        await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            id VARCHAR(100) PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        const [rows] = await conn.query('SELECT id FROM schema_migrations');
        const done = new Set(rows.map((r) => r.id));
        const h = helpers(conn);

        for (const m of loadMigrations()) {
            if (done.has(m.id)) continue;
            log(`→ migrating ${m.id}${m.description ? ` (${m.description})` : ''}`);
            // DDL auto-commits in MySQL, so migrations must be idempotent rather
            // than relying on transactions.
            await m.up(h);
            await conn.query('INSERT INTO schema_migrations (id) VALUES (?)', [m.id]);
            applied.push(m.id);
        }
        if (!applied.length) log('✓ database schema is up to date');
        else log(`✓ applied ${applied.length} migration(s)`);
        return applied;
    } finally {
        try {
            await conn.query("SELECT RELEASE_LOCK('taskquest_migrations')");
        } catch {
            /* ignore */
        }
        conn.release();
    }
}

/** Throw if migrations are pending (apps call this at startup). */
async function assertSchemaCurrent() {
    const all = loadMigrations().map((m) => m.id);
    let done = [];
    try {
        done = (await getPool().query('SELECT id FROM schema_migrations'))[0].map((r) => r.id);
    } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
    const pending = all.filter((id) => !done.includes(id));
    if (pending.length) {
        throw new Error(`Database schema is out of date. Pending migrations: ${pending.join(', ')}. Run "npm run db:migrate".`);
    }
}

module.exports = { runMigrations, assertSchemaCurrent, loadMigrations };

if (require.main === module) {
    try {
        require('dotenv').config();
    } catch {
        /* dotenv optional */
    }
    runMigrations()
        .then(() => closePool())
        .catch(async (err) => {
            console.error('✗ migration failed:', err.message);
            await closePool();
            process.exit(1);
        });
}
