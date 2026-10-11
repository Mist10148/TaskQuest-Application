'use strict';

/**
 * New XP sources. Every step is idempotent, and this file grows with each source that needs schema.
 *   lists.cleared_at  when a list's LIST_CLEARED bonus was paid; a list pays it once, however often it is re-cleared
 *   users.last_chest_streak  the streak length of the last streak chest paid; a chest pays only above it, and a reset streak clears it
 *   items.habit_streak  consecutive on-time completions of a repeating task, carried onto each spawned copy
 *   focus_sessions     server-timed focus sessions; minutes_credited and xp are what the server measured and paid
 */

exports.description = 'xp sources: list cleared marker, streak chests, habit streaks, focus sessions';

exports.up = async (h) => {
    await h.addColumnIfMissing('lists', 'cleared_at', 'DATETIME NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'last_chest_streak', 'INT NOT NULL DEFAULT 0');
    await h.addColumnIfMissing('items', 'habit_streak', 'INT NOT NULL DEFAULT 0');

    await h.exec(`CREATE TABLE IF NOT EXISTS focus_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        started_at DATETIME NOT NULL,
        minutes_planned INT NOT NULL,
        state VARCHAR(12) NOT NULL DEFAULT 'active',
        finished_at DATETIME NULL DEFAULT NULL,
        minutes_credited INT NULL DEFAULT NULL,
        xp INT NOT NULL DEFAULT 0,
        INDEX idx_focus_user_state (discord_id, state),
        INDEX idx_focus_user_finished (discord_id, finished_at),
        CONSTRAINT fk_focus_sessions_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
};
