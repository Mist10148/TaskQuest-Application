-- ═══════════════════════════════════════════════════════════════════════════════
--  💾 TASKQUEST DATABASE SCHEMA (v3.5)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS taskquest_bot;
USE taskquest_bot;

-- Users table with automation and gamification
CREATE TABLE IF NOT EXISTS users (
    discord_id VARCHAR(32) PRIMARY KEY,
    player_xp INT DEFAULT 0,
    player_level INT DEFAULT 1,
    player_class ENUM('DEFAULT','HERO','GAMBLER','ASSASSIN','WIZARD','ARCHER','TANK') DEFAULT 'DEFAULT',
    skill_points INT DEFAULT 0,
    gamification_enabled BOOLEAN DEFAULT TRUE,
    automation_enabled BOOLEAN DEFAULT TRUE,
    streak_count INT DEFAULT 0,
    last_active_day DATE DEFAULT NULL,
    last_daily_claim TIMESTAMP NULL DEFAULT NULL,
    
    -- Class ownership
    owns_hero BOOLEAN DEFAULT FALSE,
    owns_gambler BOOLEAN DEFAULT FALSE,
    owns_assassin BOOLEAN DEFAULT FALSE,
    owns_wizard BOOLEAN DEFAULT FALSE,
    owns_archer BOOLEAN DEFAULT FALSE,
    owns_tank BOOLEAN DEFAULT FALSE,
    
    -- Class-specific counters
    assassin_streak INT DEFAULT 0,
    assassin_stacks INT DEFAULT 0,
    wizard_counter INT DEFAULT 0,
    archer_streak INT DEFAULT 0,
    tank_stacks INT DEFAULT 0,
    
    -- Stats
    total_items_added INT DEFAULT 0,
    total_items_completed INT DEFAULT 0,
    total_lists_created INT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Skills (Skill Tree Unlocks)
CREATE TABLE IF NOT EXISTS user_skills (
    id INT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    skill_id VARCHAR(50) NOT NULL,
    skill_level INT DEFAULT 1,
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_user_skill (discord_id, skill_id),
    FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE,
    INDEX idx_discord_skills (discord_id)
);

-- Lists table
CREATE TABLE IF NOT EXISTS lists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT DEFAULT NULL,
    category VARCHAR(50) DEFAULT NULL,
    deadline DATE DEFAULT NULL,
    priority ENUM('LOW','MEDIUM','HIGH') DEFAULT NULL,
    deadline_notified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_user_list (discord_id, name),
    FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE,
    INDEX idx_deadline (deadline),
    INDEX idx_discord (discord_id)
);

-- Items table
CREATE TABLE IF NOT EXISTS items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    list_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT DEFAULT NULL,
    completed BOOLEAN DEFAULT FALSE,
    position INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
    INDEX idx_list (list_id)
);

-- Achievements table
CREATE TABLE IF NOT EXISTS achievements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    achievement_key VARCHAR(50) NOT NULL,
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_achievement (discord_id, achievement_key),
    FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════════════════
--  📋 ACHIEVEMENT KEYS REFERENCE
-- ═══════════════════════════════════════════════════════════════════════════════
-- 
-- Productivity:
--   first_item, items_10, items_50, items_100
-- 
-- Completion:
--   first_complete, complete_10, complete_50, complete_100
-- 
-- Lists:
--   first_list, lists_5, lists_10
-- 
-- Levels:
--   level_5, level_10, level_25
-- 
-- Streaks:
--   streak_3, streak_7, streak_30
-- 
-- Classes:
--   unlock_hero, unlock_gambler, unlock_assassin,
--   unlock_wizard, unlock_archer, unlock_tank
-- 
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
--  🎰 BLACKJACK / GAMES SYSTEM TABLES (v3.1)
-- ═══════════════════════════════════════════════════════════════════════════════

-- XP Transaction Log (NEVER update XP directly - always log here)
CREATE TABLE IF NOT EXISTS xp_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    amount INT NOT NULL,
    source ENUM('daily','task_complete','list_create','item_add','blackjack_win','blackjack_loss','blackjack_push','blackjack_blackjack','game_reward','class_purchase','manual') NOT NULL,
    reference_id INT DEFAULT NULL,
    balance_before INT NOT NULL,
    balance_after INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE,
    INDEX idx_user_xp (discord_id),
    INDEX idx_source (source),
    INDEX idx_reference (reference_id)
);

-- Game Sessions (tracks all games)
CREATE TABLE IF NOT EXISTS game_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    game_type ENUM('blackjack','rps','hangman','slots') NOT NULL,
    bet_amount INT NOT NULL DEFAULT 0,
    state ENUM('active','won','lost','push','blackjack','expired','cancelled') DEFAULT 'active',
    payout INT DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    
    FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE,
    INDEX idx_user_game (discord_id, game_type),
    INDEX idx_state (state),
    INDEX idx_active (discord_id, state)
);

-- Blackjack Hands (detailed game state)
CREATE TABLE IF NOT EXISTS blackjack_hands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL UNIQUE,
    player_hand JSON NOT NULL,
    dealer_hand JSON NOT NULL,
    deck_state JSON NOT NULL,
    player_value INT DEFAULT 0,
    dealer_value INT DEFAULT 0,
    last_action VARCHAR(20) DEFAULT NULL,
    
    FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════════════════════════
--  🎰 BLACKJACK INDEXES FOR PERFORMANCE
-- ═══════════════════════════════════════════════════════════════════════════════

-- Clean up expired games (run periodically)
-- DELETE FROM game_sessions WHERE state = 'active' AND started_at < NOW() - INTERVAL 30 MINUTE;
