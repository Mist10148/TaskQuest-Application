/**
 * Keeping the database small and measuring balance:
 *  - archiveOld moves xp_transactions (and, only when asked, finished game sessions) older than a number of days to
 *    *_archive tables, in batches, each batch in its own transaction.
 *  - xpByClass reports what each class really earned per action, from xp_transactions.player_class.
 */

'use strict';

const { getPool, withTransaction } = require('./pool');

const DAY_MS = 86400e3;

const XP_COLUMNS = 'id, discord_id, amount, source, balance_before, balance_after, reference_id, created_at, player_class';
const GAME_COLUMNS = 'id, discord_id, game_type, bet_amount, state, game_data, payout, created_at, ended_at';

/** Move rows of one table older than the cutoff into its archive; returns how many (or how many would move on a dry run). */
async function moveBatches({ table, archive, columns, where, params, batch, dryRun }) {
    const pool = getPool();
    if (dryRun) {
        const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params);
        return Number(row.n);
    }
    let moved = 0;
    for (;;) {
        const n = await withTransaction(async (conn) => {
            const [rows] = await conn.query(`SELECT id FROM ${table} WHERE ${where} ORDER BY id LIMIT ?`, [...params, batch]);
            if (!rows.length) return 0;
            const ids = rows.map((r) => r.id);
            await conn.query(`INSERT INTO ${archive} (${columns}) SELECT ${columns} FROM ${table} WHERE id = ANY(?) ON CONFLICT DO NOTHING`, [ids]);
            await conn.query(`DELETE FROM ${table} WHERE id = ANY(?)`, [ids]);
            return ids.length;
        });
        moved += n;
        if (n < batch) return moved;
    }
}

/**
 * @param {object} [opts] { days: keep this many days (default 365), batch: rows per transaction (default 5000),
 *   games: also archive finished game sessions (the games played and won counts drop with them), dryRun, now }
 * @returns {Promise<{ cutoff: Date, xpTransactions: number, gameSessions: number|null, dryRun: boolean }>}
 */
async function archiveOld({ days = 365, batch = 5000, games = false, dryRun = false, now = new Date() } = {}) {
    if (!Number.isInteger(days) || days < 1) throw new Error('days must be a whole number of at least 1');
    if (!Number.isInteger(batch) || batch < 1 || batch > 100000) throw new Error('batch must be between 1 and 100000');
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const xpTransactions = await moveBatches({ table: 'xp_transactions', archive: 'xp_transactions_archive', columns: XP_COLUMNS, where: 'created_at < ?', params: [cutoff], batch, dryRun });
    const gameSessions = games
        ? await moveBatches({ table: 'game_sessions', archive: 'game_sessions_archive', columns: GAME_COLUMNS, where: "created_at < ? AND state <> 'active'", params: [cutoff], batch, dryRun })
        : null;
    return { cutoff, xpTransactions, gameSessions, dryRun };
}

/** The sources whose XP a class reshapes (everything else is flat and the same for every class). */
const MODIFIED_SOURCES = ['list_create', 'item_add', 'item_complete', 'daily', 'game_reward'];

/**
 * XP per action by class over the last `days` days: for every class and modified source the number of rewards, the average,
 * and the total. Rows from before migration 026 have no class and are reported as UNKNOWN.
 * @returns {Promise<Array<{ playerClass: string, source: string, rewards: number, average: number, total: number }>>}
 */
async function xpByClass({ days = 90, now = new Date() } = {}) {
    const [rows] = await getPool().query(
        `SELECT COALESCE(player_class, 'UNKNOWN') AS player_class, source, COUNT(*) AS rewards, AVG(amount) AS average, SUM(amount) AS total
           FROM xp_transactions WHERE created_at >= ? AND amount > 0 AND source = ANY(?)
          GROUP BY COALESCE(player_class, 'UNKNOWN'), source ORDER BY player_class, source`,
        [new Date(now.getTime() - days * DAY_MS), MODIFIED_SOURCES]
    );
    return rows.map((r) => ({ playerClass: r.player_class, source: r.source, rewards: Number(r.rewards), average: Math.round(Number(r.average) * 10) / 10, total: Number(r.total) }));
}

module.exports = { archiveOld, xpByClass, MODIFIED_SOURCES };
