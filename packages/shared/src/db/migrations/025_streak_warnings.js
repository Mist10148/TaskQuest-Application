'use strict';

/**
 * Streak warnings. Every step is idempotent.
 *   users.streak_warned_day  the player's own day (YYYY-MM-DD) on which the bot last warned them that today is the last day to
 *                            claim the daily reward and keep the streak, so the warning goes out at most once a day. NULL: never.
 */

exports.description = 'users.streak_warned_day';

exports.up = async (h) => {
    await h.addColumnIfMissing('users', 'streak_warned_day', 'DATE NULL DEFAULT NULL');
};
