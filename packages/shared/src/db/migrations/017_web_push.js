'use strict';

/**
 * Web push (optional feature, off unless the server has VAPID keys).
 *   push_subscriptions   one row per browser a user enabled notifications in
 *     endpoint           the push service URL (TEXT, up to 2048 chars)
 *     endpoint_hash      SHA-256 of the endpoint: what the UNIQUE index covers (a TEXT column cannot be indexed whole)
 *   users.web_push       1 (default): send reminders to the user's subscribed browsers too
 */

exports.description = 'push_subscriptions, users.web_push';

exports.up = async (h) => {
    await h.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        endpoint TEXT NOT NULL,
        endpoint_hash CHAR(64) NOT NULL,
        p256dh VARCHAR(255) NOT NULL,
        auth VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP NULL DEFAULT NULL,
        UNIQUE KEY unique_push_endpoint (endpoint_hash),
        KEY idx_push_user (discord_id),
        CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await h.addColumnIfMissing('users', 'web_push', 'TINYINT(1) NOT NULL DEFAULT 1');
};
