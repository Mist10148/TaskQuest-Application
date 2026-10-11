'use strict';

/**
 * Class rework. Counter columns and ownership flags for the rebalanced classes,
 * the new skills and the new classes. Every step is idempotent.
 *   users.assassin_last_at  last Assassin action; the streak and stacks decay after a long gap
 */

exports.description = 'class rework: new counters, owns_* flags and player_class values';

exports.up = async (h) => {
    await h.addColumnIfMissing('users', 'assassin_last_at', 'DATETIME NULL DEFAULT NULL');
};
