'use strict';

/**
 * Daily and weekly quests. Progress is computed from existing data; this table
 * only records the reward claims. The unique key (user, quest, period start)
 * is what stops a quest being claimed twice in the same period.
 */

exports.description = 'quest_claims';

exports.up = async (h) => {
    await h.exec(`CREATE TABLE IF NOT EXISTS quest_claims (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        quest_key VARCHAR(50) NOT NULL,
        period_start DATE NOT NULL,
        reward_xp INT NOT NULL DEFAULT 0,
        claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_quest_claim (discord_id, quest_key, period_start),
        CONSTRAINT fk_quest_claims_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
};
