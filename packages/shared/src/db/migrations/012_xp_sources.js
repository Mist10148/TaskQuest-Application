'use strict';

/**
 * New XP sources. Every step is idempotent, and this file grows with each source that needs schema.
 *   lists.cleared_at  when a list's LIST_CLEARED bonus was paid; a list pays it once, however often it is re-cleared
 *   users.last_chest_streak  the streak length of the last streak chest paid; a chest pays only above it, and a reset streak clears it
 *   items.habit_streak  consecutive on-time completions of a repeating task, carried onto each spawned copy
 */

exports.description = 'xp sources: list cleared marker, streak chests, habit streaks';

exports.up = async (h) => {
    await h.addColumnIfMissing('lists', 'cleared_at', 'DATETIME NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'last_chest_streak', 'INT NOT NULL DEFAULT 0');
    await h.addColumnIfMissing('items', 'habit_streak', 'INT NOT NULL DEFAULT 0');
};
