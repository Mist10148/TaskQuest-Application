'use strict';

/**
 * Per-user days. Daily caps, quests, the weekly review and stats now follow users.timezone, so a change of
 * zone is throttled (once per 24 hours) to stop zone-hopping from resetting a daily cap.
 *   users.timezone_changed_at  when the zone was last changed; NULL until the user first sets one
 * Nothing is rewritten: past XP and claims keep their instants, and the new zone applies from the change on.
 */

exports.description = 'users timezone_changed_at';

exports.up = async (h) => {
    await h.addColumnIfMissing('users', 'timezone_changed_at', 'DATETIME NULL DEFAULT NULL');
};
