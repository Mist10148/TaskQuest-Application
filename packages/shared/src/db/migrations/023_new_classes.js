'use strict';

/**
 * Five more classes: Bard, Alchemist, Druid, Chronomancer and Warden. Every step is idempotent.
 *   users.owns_<class>        one ownership flag per new class
 *   users.bard_recent         Bard: the lists of the last completed tasks, comma separated list ids (newest last)
 *   users.alchemist_mix       Alchemist: the priorities completed in the current brew (bit 1 LOW, 2 MEDIUM, 4 HIGH)
 *   users.player_class        ENUM extended with the new classes
 * The Druid, Chronomancer and Warden read their state from tasks, focus sessions and list members, so they need no counter.
 */

exports.description = 'new classes: owns_* flags, Bard and Alchemist counters, player_class values';

/** Every value player_class can take, in order. (Listed here so this migration never changes meaning.) */
const PLAYER_CLASSES = [
    'DEFAULT', 'HERO', 'GAMBLER', 'ASSASSIN', 'WIZARD', 'ARCHER', 'TANK', 'MONK', 'ARTISAN', 'RANGER', 'NECROMANCER', 'PALADIN',
    'BARD', 'ALCHEMIST', 'DRUID', 'CHRONOMANCER', 'WARDEN'
];

exports.up = async (h) => {
    for (const name of ['bard', 'alchemist', 'druid', 'chronomancer', 'warden']) {
        await h.addColumnIfMissing('users', `owns_${name}`, 'BOOLEAN NOT NULL DEFAULT FALSE');
    }
    await h.addColumnIfMissing('users', 'bard_recent', "VARCHAR(120) NOT NULL DEFAULT ''");
    await h.addColumnIfMissing('users', 'alchemist_mix', 'INT NOT NULL DEFAULT 0');

    // Extending an ENUM is a MODIFY with the full list; repeating it is harmless.
    const values = PLAYER_CLASSES.map((c) => `'${c}'`).join(',');
    await h.exec(`ALTER TABLE users MODIFY COLUMN player_class ENUM(${values}) NOT NULL DEFAULT 'DEFAULT'`);
};
