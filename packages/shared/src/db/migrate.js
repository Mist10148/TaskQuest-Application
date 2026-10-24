#!/usr/bin/env node
/**
 * Versioned schema migrations. This is the ONLY place that changes the
 * database schema — neither app runs ALTER/CREATE statements at runtime.
 *
 *   npm run db:migrate            (from the repo root)
 *
 * Each migration runs once, inside its own transaction (Postgres DDL is transactional, so a
 * failed migration leaves nothing half-applied), and is recorded in `schema_migrations`.
 * 001_baseline creates the whole schema; later migrations change it. They are written in JS
 * (not raw SQL) so they can use the idempotent helpers below.
 */

'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { getPool, closePool, isUndefinedTable } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/** Key of the session-level advisory lock that stops two processes (bot and web booting together) migrating at once. */
const LOCK_KEY = "hashtext('taskquest_migrations')";
const LOCK_WAIT_MS = 60000;

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

// ─── Helpers passed to every migration ────────────────────────────────────────

function helpers(conn) {
    const one = async (sql, params) => (await conn.query(sql, params))[0][0];

    return {
        conn,
        exec: (sql, params) => conn.query(sql, params),
        async tableExists(table) {
            const row = await one('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?', [table]);
            return Number(row.n) > 0;
        },
        async columnInfo(table, column) {
            return one(
                `SELECT column_name AS name, data_type AS "dataType", udt_name AS "udtName"
                 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
                [table, column]
            );
        },
        async columnExists(table, column) {
            return Boolean(await this.columnInfo(table, column));
        },
        async indexExists(table, index) {
            const row = await one('SELECT COUNT(*) AS n FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ? AND indexname = ?', [table, index]);
            return Number(row.n) > 0;
        },
        /** True if `table.column` already has any foreign key to `refTable`. */
        async foreignKeyExists(table, column, refTable) {
            const row = await one(
                `SELECT COUNT(*) AS n
                 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
                 JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
                 WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema()
                   AND tc.table_name = ? AND kcu.column_name = ? AND ccu.table_name = ?`,
                [table, column, refTable]
            );
            return Number(row.n) > 0;
        },
        /** `definition` is the column type and constraints, e.g. "INT NOT NULL DEFAULT 0". */
        async addColumnIfMissing(table, column, definition) {
            if (await this.columnExists(table, column)) return false;
            await conn.query(`ALTER TABLE ${ident(table)} ADD COLUMN ${ident(column)} ${definition}`);
            return true;
        },
        /** `columns` is the index column list, e.g. "(discord_id, created_at)". */
        async addIndexIfMissing(table, index, columns, { unique = false } = {}) {
            if (await this.indexExists(table, index)) return false;
            await conn.query(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${ident(index)} ON ${ident(table)} ${columns}`);
            return true;
        },
        async addForeignKeyIfMissing(table, column, refTable, refColumn, name) {
            if (await this.foreignKeyExists(table, column, refTable)) return false;
            await conn.query(
                `ALTER TABLE ${ident(table)} ADD CONSTRAINT ${ident(name)} FOREIGN KEY (${ident(column)}) REFERENCES ${ident(refTable)} (${ident(refColumn)}) ON DELETE CASCADE`
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

async function acquireLock(conn) {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
        const [[row]] = await conn.query(`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`);
        if (row.ok) return;
        if (Date.now() >= deadline) throw new Error('Could not acquire migration lock');
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
}

/** A short fingerprint of a migration's code, stored when it is applied so a later edit of a shipped migration can be noticed. */
function checksumOf(m) {
    return crypto.createHash('sha256').update(String(m.up)).digest('hex').slice(0, 32);
}

/**
 * Things worth a warning before migrating: applied migrations this code does not know (an older deploy running against a newer
 * schema) and shipped migrations whose code changed since they were applied. Warnings only: neither stops the app.
 * @param {{id: string, up: Function}[]} known migrations on disk
 * @param {{id: string, checksum?: string|null}[]} appliedRows rows of schema_migrations
 */
function migrationWarnings(known, appliedRows) {
    const byId = new Map(known.map((m) => [m.id, m]));
    const notes = [];
    for (const row of appliedRows) {
        const m = byId.get(row.id);
        if (!m) notes.push(`the database has migration ${row.id}, which this version does not know: an older version is running against a newer schema.`);
        else if (row.checksum && row.checksum !== checksumOf(m)) notes.push(`migration ${row.id} was changed after it was applied. Never edit a shipped migration; add a new one.`);
    }
    return notes;
}

/**
 * Apply all pending migrations. Uses an advisory lock so two processes (bot and
 * web booting together) never migrate concurrently.
 * @returns {Promise<string[]>} ids of migrations applied in this run
 */
async function runMigrations({ log = console.log } = {}) {
    const conn = await getPool().getConnection();
    const applied = [];
    let locked = false;
    try {
        await acquireLock(conn);
        locked = true;

        await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
            id VARCHAR(100) PRIMARY KEY,
            applied_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);

        // The checksum column is added here rather than by a migration: it is the runner's own bookkeeping, and it must exist before any migration is checked.
        await conn.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)');

        const [rows] = await conn.query('SELECT id, checksum FROM schema_migrations');
        const done = new Set(rows.map((r) => r.id));
        const all = loadMigrations();
        for (const note of migrationWarnings(all, rows)) log(`⚠ ${note}`);
        // A migration applied before checksums existed is trusted as it is now and stamped, so only later edits are noticed.
        for (const m of all) {
            const row = rows.find((r) => r.id === m.id);
            if (row && !row.checksum) await conn.query('UPDATE schema_migrations SET checksum = ? WHERE id = ?', [checksumOf(m), m.id]);
        }
        const h = helpers(conn);

        for (const m of all) {
            if (done.has(m.id)) continue;
            log(`→ migrating ${m.id}${m.description ? ` (${m.description})` : ''}`);
            await conn.beginTransaction();
            try {
                await m.up(h);
                await conn.query('INSERT INTO schema_migrations (id, checksum) VALUES (?, ?)', [m.id, checksumOf(m)]);
                await conn.commit();
            } catch (err) {
                await conn.rollback().catch(() => {});
                throw err;
            }
            applied.push(m.id);
        }
        if (!applied.length) log('✓ database schema is up to date');
        else log(`✓ applied ${applied.length} migration(s)`);
        return applied;
    } finally {
        if (locked) {
            try {
                await conn.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`);
            } catch {
                /* ignore: the lock goes with the session */
            }
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
        if (!isUndefinedTable(err)) throw err;
    }
    const unknown = done.filter((id) => !all.includes(id));
    if (unknown.length) console.warn(`⚠ the database has migration(s) this version does not know (${unknown.join(', ')}): an older version is running against a newer schema.`);
    const pending = all.filter((id) => !done.includes(id));
    if (pending.length) {
        throw new Error(`Database schema is out of date. Pending migrations: ${pending.join(', ')}. Run "npm run db:migrate".`);
    }
}

module.exports = { runMigrations, assertSchemaCurrent, loadMigrations, migrationWarnings, checksumOf };

if (require.main === module) {
    require('../env').loadEnv(process.cwd());
    runMigrations()
        .then(() => closePool())
        .catch(async (err) => {
            console.error('✗ migration failed:', err.message);
            await closePool();
            process.exit(1);
        });
}
