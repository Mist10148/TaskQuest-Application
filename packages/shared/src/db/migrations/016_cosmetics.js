'use strict';

/**
 * Cosmetics bought with XP (titles, avatar frames, profile accents).
 *   user_cosmetics            what a user owns (cosmetic_id is a key of COSMETICS in constants.js)
 *   users.equipped_title/frame/accent   the cosmetic id shown for each kind, or NULL
 */

exports.description = 'user_cosmetics, users.equipped_*';

exports.up = async (h) => {
    await h.exec(`CREATE TABLE IF NOT EXISTS user_cosmetics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        cosmetic_id VARCHAR(40) NOT NULL,
        acquired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_cosmetic (discord_id, cosmetic_id),
        CONSTRAINT fk_user_cosmetics_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await h.addColumnIfMissing('users', 'equipped_title', 'VARCHAR(40) NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'equipped_frame', 'VARCHAR(40) NULL DEFAULT NULL');
    await h.addColumnIfMissing('users', 'equipped_accent', 'VARCHAR(40) NULL DEFAULT NULL');
};
