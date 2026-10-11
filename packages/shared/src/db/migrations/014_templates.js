'use strict';

/**
 * Task templates: a named list of tasks a user can turn into a new quest in one click.
 *   task_templates.items  JSON array of { name, description?, priority?, tags?, recurrence? }; the service caps it at 30 entries
 * One name per user; templates are removed with the user.
 */

exports.description = 'task_templates';

exports.up = async (h) => {
    await h.exec(`CREATE TABLE IF NOT EXISTS task_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT DEFAULT NULL,
        items JSON NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_template (discord_id, name),
        CONSTRAINT fk_task_templates_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
};
