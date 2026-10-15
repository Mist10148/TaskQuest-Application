'use strict';

/**
 * Data for balancing and for keeping the log small. Every step is idempotent.
 *   xp_transactions.player_class   the class the player had equipped when the XP was earned (NULL for rows from before this
 *                                  migration), so XP per action can be compared by class from real history
 *   xp_transactions_archive        where old rows go (scripts/archive.js); the same columns, no foreign key
 *   game_sessions_archive          the same for finished game sessions
 */

exports.description = 'xp_transactions.player_class, xp_transactions_archive, game_sessions_archive';

exports.up = async (h) => {
    await h.addColumnIfMissing('xp_transactions', 'player_class', 'VARCHAR(20) NULL DEFAULT NULL');
    await h.exec('CREATE TABLE IF NOT EXISTS xp_transactions_archive LIKE xp_transactions');
    await h.exec('CREATE TABLE IF NOT EXISTS game_sessions_archive LIKE game_sessions');
    // LIKE copies the columns and indexes, never the foreign keys: an archive row may outlive its user.
    await h.addColumnIfMissing('xp_transactions_archive', 'player_class', 'VARCHAR(20) NULL DEFAULT NULL');
};
