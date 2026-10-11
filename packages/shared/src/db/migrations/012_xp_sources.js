'use strict';

/**
 * New XP sources. Every step is idempotent, and this file grows with each source that needs schema.
 *   lists.cleared_at  when a list's LIST_CLEARED bonus was paid; a list pays it once, however often it is re-cleared
 *   users.last_chest_streak  the streak length of the last streak chest paid; a chest pays only above it, and a reset streak clears it
 *   items.habit_streak  consecutive on-time completions of a repeating task, carried onto each spawned copy
 *   focus_sessions     server-timed focus sessions; minutes_credited and xp are what the server measured and paid
 *   items.first_completed_early / first_completed_overdue  whether the first completion was before / after the due date (NULL: no due date or not recorded)
 *   users.prestige            how many times the player has prestiged
 *   users.lifetime_xp_total   all XP ever earned, never reset (lifetime_xp is reset by prestige because it drives the level)
 */

exports.description = 'xp sources: list cleared marker, streak chests, habit streaks, focus sessions, quest facts, prestige';

exports.up = async (h) => {
    await h.addColumnIfMissing('lists', 'cleared_at', 'DATETIME NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'last_chest_streak', 'INT NOT NULL DEFAULT 0');
    await h.addColumnIfMissing('users', 'prestige', 'INT NOT NULL DEFAULT 0');
    if (!(await h.columnExists('users', 'lifetime_xp_total'))) {
        await h.exec('ALTER TABLE users ADD COLUMN lifetime_xp_total BIGINT NOT NULL DEFAULT 0');
        await h.exec('UPDATE users SET lifetime_xp_total = lifetime_xp');
    }
    await h.addColumnIfMissing('items', 'habit_streak', 'INT NOT NULL DEFAULT 0');
    await h.addColumnIfMissing('items', 'first_completed_early', 'TINYINT(1) NULL DEFAULT NULL');
    await h.addColumnIfMissing('items', 'first_completed_overdue', 'TINYINT(1) NULL DEFAULT NULL');

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
