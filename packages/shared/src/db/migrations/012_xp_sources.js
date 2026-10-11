'use strict';

/**
 * New XP sources. Every step is idempotent, and this file grows with each source that needs schema.
 *   lists.cleared_at  when a list's LIST_CLEARED bonus was paid; a list pays it once, however often it is re-cleared
 */

exports.description = 'xp sources: list cleared marker';

exports.up = async (h) => {
    await h.addColumnIfMissing('lists', 'cleared_at', 'DATETIME NULL DEFAULT NULL');
};
