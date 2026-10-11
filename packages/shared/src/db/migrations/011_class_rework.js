'use strict';

/**
 * Class rework. Counter columns and ownership flags for the rebalanced classes,
 * the new skills and the new classes. Every step is idempotent.
 *   users.assassin_last_at  last Assassin action; the streak and stacks decay after a long gap
 *   users.gambler_streak    consecutive lucky Gambler rolls (Hot Hand)
 *   users.assassin_bleed    actions left with the Bleed bonus after a crit
 */

exports.description = 'class rework: new counters, owns_* flags and player_class values';

exports.up = async (h) => {
    await h.addColumnIfMissing('users', 'assassin_last_at', 'DATETIME NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'gambler_streak', 'INT NOT NULL DEFAULT 0');
    await h.addColumnIfMissing('users', 'assassin_bleed', 'INT NOT NULL DEFAULT 0');
};
