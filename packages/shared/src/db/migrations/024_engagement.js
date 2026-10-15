'use strict';

/**
 * Engagement XP sources. Every step is idempotent.
 *   reflections        one short note a day, paid once (UNIQUE per user and day)
 *   weekly_goals       the completion target a player sets for a week (week_key is the Monday, YYYY-MM-DD in their zone);
 *                      claimed_at is set when the reward is paid
 *   items.estimate_minutes  the player's own estimate of a task's length, scored against a focus session
 */

exports.description = 'reflections, weekly_goals and items.estimate_minutes';

exports.up = async (h) => {
    await h.exec(`CREATE TABLE IF NOT EXISTS reflections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        day DATE NOT NULL,
        note VARCHAR(200) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_reflection_day (discord_id, day),
        CONSTRAINT fk_reflections_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await h.exec(`CREATE TABLE IF NOT EXISTS weekly_goals (
        discord_id VARCHAR(32) NOT NULL,
        week_key CHAR(10) NOT NULL,
        target INT NOT NULL,
        claimed_at DATETIME NULL DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (discord_id, week_key),
        CONSTRAINT fk_weekly_goals_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await h.addColumnIfMissing('items', 'estimate_minutes', 'INT NULL DEFAULT NULL');
};
