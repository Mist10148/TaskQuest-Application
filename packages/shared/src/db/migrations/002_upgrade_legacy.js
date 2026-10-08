'use strict';

/**
 * Bring databases created by older releases up to the 001 schema.
 *
 * Covers three historical layouts:
 *   - bot v3.8 runtime DDL (database/db.js)        — no FKs, created_at sessions
 *   - bot v3.5 schema.sql / UPDATED_DATABASE_SCHEMA — INT XP, ENUM source/state,
 *     started_at sessions, blackjack_hands table
 *   - web v1.5 runtime ALTERs                      — discord_username/avatar
 *
 * Every step checks information_schema first, so it is safe on a fresh
 * database too (where it does nothing).
 */

exports.description = 'upgrade legacy bot/web schemas';

exports.up = async (h) => {
    const { exec } = h;

    // ── character set ────────────────────────────────────────────────────────
    // Old installs defaulted to latin1, which cannot store emoji in task names.
    const [charsets] = await exec(
        `SELECT TABLE_NAME AS name FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_COLLATION NOT LIKE 'utf8mb4%'
           AND TABLE_NAME IN ('users','lists','items','achievements','user_skills','game_sessions','xp_transactions')`
    );
    if (charsets.length) {
        // Columns used by foreign keys cannot change charset (MariaDB refuses even
        // with FOREIGN_KEY_CHECKS=0), so drop the legacy FKs first. The steps
        // below re-create them with consistent names.
        const [fks] = await exec(
            `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name FROM information_schema.REFERENTIAL_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE()
               AND TABLE_NAME IN ('lists','items','achievements','user_skills','game_sessions','xp_transactions')
               AND REFERENCED_TABLE_NAME IN ('users','lists')`
        );
        for (const fk of fks) {
            await exec(`ALTER TABLE \`${fk.tableName}\` DROP FOREIGN KEY \`${fk.name}\``);
        }
        for (const { name } of charsets) {
            await exec(`ALTER TABLE \`${name}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        }
    }

    // ── users ────────────────────────────────────────────────────────────────
    await h.addColumnIfMissing('users', 'discord_username', 'VARCHAR(100) DEFAULT NULL AFTER discord_id');
    await h.addColumnIfMissing('users', 'discord_avatar', 'VARCHAR(100) DEFAULT NULL AFTER discord_username');
    await h.addColumnIfMissing('users', 'auto_delete_old_lists', 'BOOLEAN NOT NULL DEFAULT TRUE');
    await h.addColumnIfMissing('users', 'last_game_at', 'DATETIME(3) DEFAULT NULL');
    const addedLifetime = await h.addColumnIfMissing('users', 'lifetime_xp', 'BIGINT NOT NULL DEFAULT 0 AFTER player_xp');
    await exec('ALTER TABLE users MODIFY COLUMN player_xp BIGINT NOT NULL DEFAULT 0');
    await exec('ALTER TABLE users MODIFY COLUMN player_level BIGINT NOT NULL DEFAULT 1');
    if (addedLifetime) {
        // Spent XP was never recorded, so the best lower bound for lifetime XP
        // is the larger of the current balance and the stored level's floor.
        // This guarantees nobody's level drops after the upgrade.
        await exec('UPDATE users SET lifetime_xp = GREATEST(player_xp, (GREATEST(player_level, 1) - 1) * 100)');
    }
    await exec('UPDATE users SET player_level = FLOOR(lifetime_xp / 100) + 1');
    await h.addIndexIfMissing('users', 'idx_users_leaderboard', 'INDEX idx_users_leaderboard (gamification_enabled, player_xp)');

    // Rows referencing users that were never created would block the FKs.
    for (const table of ['lists', 'achievements', 'user_skills', 'game_sessions', 'xp_transactions']) {
        if (await h.tableExists(table)) {
            await exec(`INSERT IGNORE INTO users (discord_id) SELECT DISTINCT discord_id FROM \`${table}\``);
        }
    }

    // ── lists ────────────────────────────────────────────────────────────────
    await h.addIndexIfMissing('lists', 'idx_lists_deadline', 'INDEX idx_lists_deadline (deadline)');
    await h.addForeignKeyIfMissing('lists', 'discord_id', 'users', 'discord_id', 'fk_lists_user');

    // ── items ────────────────────────────────────────────────────────────────
    await h.addColumnIfMissing('items', 'xp_awarded', 'BOOLEAN NOT NULL DEFAULT FALSE AFTER completed');
    await h.addColumnIfMissing('items', 'completed_at', 'DATETIME DEFAULT NULL AFTER xp_awarded');
    await h.addColumnIfMissing('items', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    // Items already completed before this release have been paid already.
    await exec('UPDATE items SET xp_awarded = TRUE WHERE completed = TRUE AND xp_awarded = FALSE');
    // Orphans from deleting lists without cascades.
    await exec('DELETE i FROM items i LEFT JOIN lists l ON l.id = i.list_id WHERE l.id IS NULL');
    await h.addIndexIfMissing('items', 'idx_items_list', 'INDEX idx_items_list (list_id, position)');
    await h.addForeignKeyIfMissing('items', 'list_id', 'lists', 'id', 'fk_items_list');

    // ── achievements / skills ────────────────────────────────────────────────
    // The web app used BUY_CLASS where the bot used FIRST_CLASS.
    await exec(`INSERT IGNORE INTO achievements (discord_id, achievement_key, unlocked_at)
                SELECT discord_id, 'FIRST_CLASS', unlocked_at FROM achievements WHERE achievement_key = 'BUY_CLASS'`);
    await exec("DELETE FROM achievements WHERE achievement_key = 'BUY_CLASS'");
    await h.addForeignKeyIfMissing('achievements', 'discord_id', 'users', 'discord_id', 'fk_achievements_user');
    await h.addForeignKeyIfMissing('user_skills', 'discord_id', 'users', 'discord_id', 'fk_user_skills_user');

    // ── xp_transactions ──────────────────────────────────────────────────────
    await exec('ALTER TABLE xp_transactions MODIFY COLUMN amount BIGINT NOT NULL');
    await exec('ALTER TABLE xp_transactions MODIFY COLUMN source VARCHAR(50) NOT NULL');
    await exec('ALTER TABLE xp_transactions MODIFY COLUMN balance_before BIGINT NOT NULL DEFAULT 0');
    await exec('ALTER TABLE xp_transactions MODIFY COLUMN balance_after BIGINT NOT NULL DEFAULT 0');
    await h.addIndexIfMissing('xp_transactions', 'idx_xp_user_created', 'INDEX idx_xp_user_created (discord_id, created_at)');
    await h.addIndexIfMissing('xp_transactions', 'idx_xp_user_source_created', 'INDEX idx_xp_user_source_created (discord_id, source, created_at)');
    await h.addForeignKeyIfMissing('xp_transactions', 'discord_id', 'users', 'discord_id', 'fk_xp_transactions_user');

    // ── game_sessions ────────────────────────────────────────────────────────
    if (!(await h.columnExists('game_sessions', 'created_at')) && (await h.columnExists('game_sessions', 'started_at'))) {
        await exec('ALTER TABLE game_sessions CHANGE COLUMN started_at created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)');
    } else {
        await exec('ALTER TABLE game_sessions MODIFY COLUMN created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)');
    }
    await h.addColumnIfMissing('game_sessions', 'game_data', 'JSON DEFAULT NULL AFTER state');
    await exec("ALTER TABLE game_sessions MODIFY COLUMN game_type VARCHAR(20) NOT NULL");
    await exec("ALTER TABLE game_sessions MODIFY COLUMN state VARCHAR(20) NOT NULL DEFAULT 'active'");
    await exec('ALTER TABLE game_sessions MODIFY COLUMN bet_amount BIGINT NOT NULL DEFAULT 0');
    await exec('ALTER TABLE game_sessions MODIFY COLUMN payout BIGINT NOT NULL DEFAULT 0');
    await exec("UPDATE game_sessions SET state = 'lost' WHERE state IN ('bust', 'surrender')");
    // Sessions left active by older code can't be resumed by the new engine.
    // Blackjack bets were escrowed (deducted) when they started, so refund them.
    await exec('START TRANSACTION');
    try {
        await exec(`INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after, reference_id)
                    SELECT gs.discord_id, gs.bet_amount, 'blackjack_refund', u.player_xp, u.player_xp + gs.bet_amount, gs.id
                    FROM game_sessions gs JOIN users u ON u.discord_id = gs.discord_id
                    WHERE gs.state = 'active' AND gs.game_type = 'blackjack' AND gs.bet_amount > 0`);
        await exec(`UPDATE users u JOIN (
                        SELECT discord_id, SUM(bet_amount) AS refund FROM game_sessions
                        WHERE state = 'active' AND game_type = 'blackjack' AND bet_amount > 0 GROUP BY discord_id
                    ) r ON r.discord_id = u.discord_id
                    SET u.player_xp = u.player_xp + r.refund`);
        await exec("UPDATE game_sessions SET state = 'expired', ended_at = CURRENT_TIMESTAMP WHERE state = 'active'");
        await exec('COMMIT');
    } catch (err) {
        await exec('ROLLBACK');
        throw err;
    }
    await h.addIndexIfMissing('game_sessions', 'idx_sessions_user_state', 'INDEX idx_sessions_user_state (discord_id, state, game_type)');
    await h.addIndexIfMissing('game_sessions', 'idx_sessions_state_created', 'INDEX idx_sessions_state_created (state, created_at)');
    await h.addForeignKeyIfMissing('game_sessions', 'discord_id', 'users', 'discord_id', 'fk_game_sessions_user');

    // blackjack_hands (v3.5) is superseded by game_sessions.game_data. It is
    // left in place for historical data and is no longer written to.
};
