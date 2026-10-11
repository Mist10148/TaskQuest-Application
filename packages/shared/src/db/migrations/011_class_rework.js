'use strict';

/**
 * Class rework. Counter columns and ownership flags for the rebalanced classes,
 * the new skills and the new classes. Every step is idempotent.
 *   users.assassin_last_at  last Assassin action; the streak and stacks decay after a long gap
 *   users.gambler_streak    consecutive lucky Gambler rolls (Hot Hand)
 *   users.assassin_bleed    actions left with the Bleed bonus after a crit
 *   users.owns_<class>      one ownership flag per new class
 *   users.monk_rhythm / monk_day  Monk: consecutive active days and the last active UTC day
 *   users.artisan_progress  Artisan: progress towards the current project
 *   users.necro_souls       Necromancer: souls bound by reviving overdue tasks
 *   users.player_class      ENUM extended with every new class
 */

exports.description = 'class rework: new counters, owns_* flags and player_class values';

/** Every value player_class can take, in order. (Listed here so this migration never changes meaning.) */
const PLAYER_CLASSES = ['DEFAULT', 'HERO', 'GAMBLER', 'ASSASSIN', 'WIZARD', 'ARCHER', 'TANK', 'MONK', 'ARTISAN', 'RANGER', 'NECROMANCER'];

exports.up = async (h) => {
    await h.addColumnIfMissing('users', 'assassin_last_at', 'DATETIME NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'gambler_streak', 'INT NOT NULL DEFAULT 0');
    await h.addColumnIfMissing('users', 'assassin_bleed', 'INT NOT NULL DEFAULT 0');

    // New classes: ownership flag and counters.
    await h.addColumnIfMissing('users', 'owns_monk', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await h.addColumnIfMissing('users', 'monk_rhythm', 'INT NOT NULL DEFAULT 0');
    await h.addColumnIfMissing('users', 'monk_day', 'DATE NULL DEFAULT NULL');

    await h.addColumnIfMissing('users', 'owns_artisan', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await h.addColumnIfMissing('users', 'artisan_progress', 'INT NOT NULL DEFAULT 0');

    await h.addColumnIfMissing('users', 'owns_ranger', 'BOOLEAN NOT NULL DEFAULT FALSE');

    await h.addColumnIfMissing('users', 'owns_necromancer', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await h.addColumnIfMissing('users', 'necro_souls', 'INT NOT NULL DEFAULT 0');

    // Extending an ENUM is a MODIFY with the full list; repeating it is harmless.
    const values = PLAYER_CLASSES.map((c) => `'${c}'`).join(',');
    await h.exec(`ALTER TABLE users MODIFY COLUMN player_class ENUM(${values}) NOT NULL DEFAULT 'DEFAULT'`);
};
