'use strict';

/**
 * Complete TaskQuest schema for a fresh database. Every statement uses
 * CREATE TABLE IF NOT EXISTS, so on an existing (legacy) database this is a
 * no-op and 002_upgrade_legacy brings the old tables up to date instead.
 */

exports.description = 'create TaskQuest tables';

const TABLES = [
    `CREATE TABLE IF NOT EXISTS users (
        discord_id VARCHAR(32) NOT NULL PRIMARY KEY,
        discord_username VARCHAR(100) DEFAULT NULL,
        discord_avatar VARCHAR(100) DEFAULT NULL,
        player_xp BIGINT NOT NULL DEFAULT 0,
        lifetime_xp BIGINT NOT NULL DEFAULT 0,
        player_level BIGINT NOT NULL DEFAULT 1,
        player_class ENUM('DEFAULT','HERO','GAMBLER','ASSASSIN','WIZARD','ARCHER','TANK') NOT NULL DEFAULT 'DEFAULT',
        gamification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        automation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        auto_delete_old_lists BOOLEAN NOT NULL DEFAULT TRUE,
        streak_count INT NOT NULL DEFAULT 0,
        last_active_day DATE DEFAULT NULL,
        last_daily_claim DATETIME DEFAULT NULL,
        last_game_at DATETIME(3) DEFAULT NULL,
        owns_hero BOOLEAN NOT NULL DEFAULT FALSE,
        owns_gambler BOOLEAN NOT NULL DEFAULT FALSE,
        owns_assassin BOOLEAN NOT NULL DEFAULT FALSE,
        owns_wizard BOOLEAN NOT NULL DEFAULT FALSE,
        owns_archer BOOLEAN NOT NULL DEFAULT FALSE,
        owns_tank BOOLEAN NOT NULL DEFAULT FALSE,
        assassin_streak INT NOT NULL DEFAULT 0,
        assassin_stacks INT NOT NULL DEFAULT 0,
        wizard_counter INT NOT NULL DEFAULT 0,
        archer_streak INT NOT NULL DEFAULT 0,
        tank_stacks INT NOT NULL DEFAULT 0,
        total_items_added INT NOT NULL DEFAULT 0,
        total_items_completed INT NOT NULL DEFAULT 0,
        total_lists_created INT NOT NULL DEFAULT 0,
        skill_points INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_users_leaderboard (gamification_enabled, player_xp)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS lists (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT DEFAULT NULL,
        category VARCHAR(50) DEFAULT NULL,
        deadline DATE DEFAULT NULL,
        priority ENUM('LOW','MEDIUM','HIGH') DEFAULT NULL,
        deadline_notified BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_list (discord_id, name),
        INDEX idx_lists_deadline (deadline),
        CONSTRAINT fk_lists_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        list_id INT NOT NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT DEFAULT NULL,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        xp_awarded BOOLEAN NOT NULL DEFAULT FALSE,
        completed_at DATETIME DEFAULT NULL,
        position INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_items_list (list_id, position),
        CONSTRAINT fk_items_list FOREIGN KEY (list_id) REFERENCES lists (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS achievements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        achievement_key VARCHAR(50) NOT NULL,
        unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_achievement (discord_id, achievement_key),
        CONSTRAINT fk_achievements_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS user_skills (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        skill_id VARCHAR(50) NOT NULL,
        skill_level INT NOT NULL DEFAULT 1,
        unlocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_skill (discord_id, skill_id),
        CONSTRAINT fk_user_skills_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS game_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        game_type VARCHAR(20) NOT NULL,
        bet_amount BIGINT NOT NULL DEFAULT 0,
        state VARCHAR(20) NOT NULL DEFAULT 'active',
        game_data JSON DEFAULT NULL,
        payout BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        ended_at TIMESTAMP NULL DEFAULT NULL,
        INDEX idx_sessions_user_state (discord_id, state, game_type),
        INDEX idx_sessions_state_created (state, created_at),
        CONSTRAINT fk_game_sessions_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS xp_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        amount BIGINT NOT NULL,
        source VARCHAR(50) NOT NULL,
        balance_before BIGINT NOT NULL DEFAULT 0,
        balance_after BIGINT NOT NULL DEFAULT 0,
        reference_id INT DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_xp_user_created (discord_id, created_at),
        INDEX idx_xp_user_source_created (discord_id, source, created_at),
        CONSTRAINT fk_xp_transactions_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Web login sessions (express-mysql-session layout).
    `CREATE TABLE IF NOT EXISTS web_sessions (
        session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        expires INT UNSIGNED NOT NULL,
        data MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
        INDEX idx_web_sessions_expires (expires)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

exports.up = async ({ exec }) => {
    for (const sql of TABLES) await exec(sql);
};
