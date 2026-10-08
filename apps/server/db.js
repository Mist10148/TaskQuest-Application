/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  💾 DATABASE CONNECTION - MySQL with easy local/external switching
 *  Same database as the Discord bot for real-time sync
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { getSkillBonuses, calculateFinalXP } from './gameLogic.js';

dotenv.config();

let pool = null;

// Database migrations
async function runMigrations() {
    if (!pool) return;

    try {
        console.log('🔄 Running database migrations...');

        // Migration: Expand game_type column to support longer game names
        await pool.execute(`
            ALTER TABLE game_sessions
            MODIFY COLUMN game_type VARCHAR(20)
        `).catch(err => {
            // Ignore error if column already has correct size
            if (!err.message.includes('Duplicate column name')) {
                console.log('Note: game_type column migration skipped (may already be correct size)');
            }
        });

        console.log('✅ Database migrations completed');
    } catch (error) {
        console.error('⚠️ Migration warning:', error.message);
        // Don't throw - let the app continue even if migrations fail
    }
}

export async function getPool() {
    if (pool) return pool;
    
    // Support connection URL for external DBs
    if (process.env.DB_URL) {
        pool = mysql.createPool(process.env.DB_URL);
    } else {
        // Local XAMPP / individual config
        const config = {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 3306,
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'taskquest_bot',
            waitForConnections: true,
            connectionLimit: parseInt(process.env.DB_POOL_SIZE) || 10,
            queueLimit: 0
        };
        
        // SSL for cloud databases
        if (process.env.DB_SSL === 'true') {
            config.ssl = { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
        }
        
        pool = mysql.createPool(config);
    }
    
    // Test connection
    try {
        const conn = await pool.getConnection();
        console.log('✅ Database connected');
        conn.release();
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        throw err;
    }

    // Run database migrations
    await runMigrations();

    return pool;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  USER QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

export async function getUser(discordId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM users WHERE discord_id = ?', [discordId]);
    return rows[0] || null;
}

export async function createUser(discordId) {
    const p = await getPool();
    await p.execute('INSERT IGNORE INTO users (discord_id) VALUES (?)', [discordId]);
    return getUser(discordId);
}

export async function getOrCreateUser(discordId, discordInfo = null) {
    let user = await getUser(discordId);
    if (!user) user = await createUser(discordId);
    
    // Update Discord profile info if provided
    if (discordInfo) {
        await updateDiscordProfile(discordId, discordInfo);
    }
    
    return user;
}

export async function updateDiscordProfile(discordId, info) {
    const p = await getPool();
    try {
        // Try to add columns if they don't exist (safe for first run)
        await p.execute(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS discord_username VARCHAR(100) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS discord_avatar VARCHAR(100) DEFAULT NULL
        `).catch(() => {});
        
        // Update the profile
        await p.execute(
            'UPDATE users SET discord_username = ?, discord_avatar = ? WHERE discord_id = ?',
            [info.username || null, info.avatar || null, discordId]
        );
    } catch (err) {
        // Silently fail if columns don't exist yet
        console.log('Note: Discord profile update skipped (columns may not exist)');
    }
}

export async function updateUser(discordId, updates) {
    const p = await getPool();
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), discordId];
    await p.execute(`UPDATE users SET ${fields} WHERE discord_id = ?`, values);
    return getUser(discordId);
}

export async function getUserStats(discordId) {
    const p = await getPool();
    const user = await getUser(discordId);
    if (!user) return null;
    
    const [lists] = await p.execute('SELECT COUNT(*) as total FROM lists WHERE discord_id = ?', [discordId]);
    const [items] = await p.execute(`
        SELECT COUNT(i.id) as total, SUM(CASE WHEN i.completed THEN 1 ELSE 0 END) as completed
        FROM items i JOIN lists l ON i.list_id = l.id WHERE l.discord_id = ?
    `, [discordId]);
    const [achs] = await p.execute('SELECT COUNT(*) as count FROM achievements WHERE discord_id = ?', [discordId]);
    
    // Game statistics
    let gameStats = { played: 0, won: 0, lost: 0, draws: 0 };
    try {
        const [games] = await p.execute(`
            SELECT 
                COUNT(*) as played,
                SUM(CASE WHEN state IN ('won', 'blackjack') THEN 1 ELSE 0 END) as won,
                SUM(CASE WHEN state IN ('lost', 'expired', 'bust') THEN 1 ELSE 0 END) as lost,
                SUM(CASE WHEN state = 'push' THEN 1 ELSE 0 END) as draws
            FROM game_sessions WHERE discord_id = ? AND state NOT IN ('active')
        `, [discordId]);
        gameStats = {
            played: parseInt(games[0]?.played) || 0,
            won: parseInt(games[0]?.won) || 0,
            lost: parseInt(games[0]?.lost) || 0,
            draws: parseInt(games[0]?.draws) || 0
        };
    } catch (e) { /* Tables might not exist */ }
    
    return {
        user,
        lists: lists[0] || { total: 0 },
        items: items[0] || { total: 0, completed: 0 },
        achievements: achs[0]?.count || 0,
        games: gameStats
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LISTS & ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getLists(discordId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM lists WHERE discord_id = ? ORDER BY created_at DESC', [discordId]);
    return rows;
}

export async function getListById(listId, discordId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM lists WHERE id = ? AND discord_id = ?', [listId, discordId]);
    return rows[0] || null;
}

export async function createList(discordId, name, description, category, priority, deadline) {
    const p = await getPool();
    const [result] = await p.execute(
        'INSERT INTO lists (discord_id, name, description, category, priority, deadline) VALUES (?, ?, ?, ?, ?, ?)',
        [discordId, name, description, category, priority, deadline]
    );
    await p.execute('UPDATE users SET total_lists_created = total_lists_created + 1 WHERE discord_id = ?', [discordId]);
    return getListById(result.insertId, discordId);
}

export async function updateList(listId, discordId, updates) {
    const p = await getPool();
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), listId, discordId];
    await p.execute(`UPDATE lists SET ${fields} WHERE id = ? AND discord_id = ?`, values);
    return getListById(listId, discordId);
}

export async function deleteList(listId, discordId) {
    const p = await getPool();
    await p.execute('DELETE FROM lists WHERE id = ? AND discord_id = ?', [listId, discordId]);
}

export async function getItems(listId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM items WHERE list_id = ? ORDER BY position ASC', [listId]);
    return rows;
}

export async function getItemById(itemId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM items WHERE id = ?', [itemId]);
    return rows[0] || null;
}

export async function createItem(listId, name, description) {
    const p = await getPool();
    const [posResult] = await p.execute('SELECT MAX(position) as maxPos FROM items WHERE list_id = ?', [listId]);
    const position = (posResult[0]?.maxPos || 0) + 1;
    const [result] = await p.execute(
        'INSERT INTO items (list_id, name, description, position) VALUES (?, ?, ?, ?)',
        [listId, name, description, position]
    );
    const [list] = await p.execute('SELECT discord_id FROM lists WHERE id = ?', [listId]);
    if (list[0]) await p.execute('UPDATE users SET total_items_added = total_items_added + 1 WHERE discord_id = ?', [list[0].discord_id]);
    return getItemById(result.insertId);
}

export async function updateItem(itemId, updates) {
    const p = await getPool();
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), itemId];
    await p.execute(`UPDATE items SET ${fields} WHERE id = ?`, values);
    return getItemById(itemId);
}

export async function deleteItem(itemId) {
    const p = await getPool();
    await p.execute('DELETE FROM items WHERE id = ?', [itemId]);
}

export async function toggleItemComplete(itemId, discordId) {
    const p = await getPool();
    const item = await getItemById(itemId);
    if (!item) return null;
    const newStatus = !item.completed;
    await p.execute('UPDATE items SET completed = ? WHERE id = ?', [newStatus, itemId]);
    if (newStatus) await p.execute('UPDATE users SET total_items_completed = total_items_completed + 1 WHERE discord_id = ?', [discordId]);
    return { ...item, completed: newStatus };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SKILLS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getUserSkills(discordId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM user_skills WHERE discord_id = ?', [discordId]);
    return rows;
}

export async function hasSkill(discordId, skillId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM user_skills WHERE discord_id = ? AND skill_id = ?', [discordId, skillId]);
    return rows[0] || null;
}

export async function unlockSkill(discordId, skillId) {
    const p = await getPool();
    await p.execute('INSERT INTO user_skills (discord_id, skill_id, skill_level) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE skill_level = skill_level', [discordId, skillId]);
    return hasSkill(discordId, skillId);
}

export async function upgradeSkill(discordId, skillId) {
    const p = await getPool();
    await p.execute('UPDATE user_skills SET skill_level = skill_level + 1 WHERE discord_id = ? AND skill_id = ?', [discordId, skillId]);
    return hasSkill(discordId, skillId);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACHIEVEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getAchievements(discordId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM achievements WHERE discord_id = ?', [discordId]);
    return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════════

export async function getLeaderboard(limit = 10) {
    const p = await getPool();
    const safeLimit = parseInt(limit) || 10;
    const [rows] = await p.execute(`SELECT * FROM users WHERE gamification_enabled = TRUE ORDER BY player_xp DESC LIMIT ${safeLimit}`);
    return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GAMES & XP
// ═══════════════════════════════════════════════════════════════════════════════

export async function recordGameResult(discordId, gameType, state, betAmount = 0, payout = 0) {
    const p = await getPool();
    await p.execute(
        'INSERT INTO game_sessions (discord_id, game_type, bet_amount, state, payout, ended_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [discordId, gameType, betAmount, state, payout]
    );
    console.log(`Recorded game: ${gameType} for ${discordId}, state: ${state}, payout: ${payout}`);
}

export async function getGameHistory(discordId, limit = 10) {
    const p = await getPool();
    const safeLimit = parseInt(limit) || 10;
    const [rows] = await p.execute(
        `SELECT * FROM game_sessions WHERE discord_id = ? AND state != 'active' ORDER BY ended_at DESC LIMIT ${safeLimit}`,
        [discordId]
    );
    console.log(`Game history for ${discordId}: ${rows.length} games found`);
    return rows;
}

export async function addXPTransaction(discordId, amount, source) {
    const p = await getPool();
    const user = await getUser(discordId);
    if (!user) return null;
    
    const balanceBefore = user.player_xp;
    const balanceAfter = Math.max(0, balanceBefore + amount);
    
    await p.execute(
        `INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after) VALUES (?, ?, ?, ?, ?)`,
        [discordId, amount, source, balanceBefore, balanceAfter]
    );
    
    const newLevel = Math.floor(balanceAfter / 100) + 1;
    await p.execute('UPDATE users SET player_xp = ?, player_level = ? WHERE discord_id = ?', [balanceAfter, newLevel, discordId]);
    
    return { balanceBefore, balanceAfter, newLevel };
}

export async function getXPHistory(discordId, limit = 20) {
    const p = await getPool();
    const safeLimit = parseInt(limit) || 20;
    const [rows] = await p.execute(`SELECT * FROM xp_transactions WHERE discord_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`, [discordId]);
    return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DAILY CLAIM
// ═══════════════════════════════════════════════════════════════════════════════

const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAILY_XP = 100;
const STREAK_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours to maintain streak

export async function claimDaily(discordId) {
    const user = await getUser(discordId);
    if (!user) return { success: false, error: 'User not found' };
    
    const now = Date.now();
    const lastClaim = user.last_daily_claim ? new Date(user.last_daily_claim).getTime() : 0;
    const timeSince = now - lastClaim;
    
    if (timeSince < DAILY_COOLDOWN_MS) {
        return { 
            success: false, 
            error: 'Already claimed', 
            remaining: DAILY_COOLDOWN_MS - timeSince,
            streak: user.streak_count || 0
        };
    }
    
    // Calculate streak
    let newStreak;
    let streakBroken = false;
    
    if (!lastClaim) {
        newStreak = 1;
    } else if (timeSince <= STREAK_WINDOW_MS) {
        newStreak = (user.streak_count || 0) + 1;
    } else {
        newStreak = 1;
        streakBroken = user.streak_count > 1;
    }
    
    // Calculate streak bonus (5 XP per streak day, max +50)
    const streakBonus = Math.min((newStreak - 1) * 5, 50);
    
    // Get user skills
    const userSkills = await getUserSkills(discordId);
    
    // Apply class and skill bonuses to base daily XP
    let classBonus = 0;
    let bonusInfo = { type: null, details: '' };
    let userUpdates = {};
    
    if (user.gamification_enabled) {
        const result = calculateFinalXP(user, userSkills, DAILY_XP);
        classBonus = result.finalXP - DAILY_XP; // The extra XP from class/skill
        bonusInfo = result.bonusInfo;
        userUpdates = result.userUpdates;
    }
    
    // Get skill daily bonus (Early Bird adds +10 daily XP per level)
    const skillBonuses = getSkillBonuses(userSkills);
    const skillDailyBonus = skillBonuses.dailyBonus || 0;
    
    // Calculate total XP: base + class bonus + streak + skill daily bonus
    const totalXP = DAILY_XP + classBonus + streakBonus + skillDailyBonus;
    
    const xpResult = await addXPTransaction(discordId, totalXP, 'daily');
    
    // Update class counters and streak
    const p = await getPool();
    await p.execute(
        'UPDATE users SET last_daily_claim = NOW(), streak_count = ? WHERE discord_id = ?', 
        [newStreak, discordId]
    );
    
    // Update class-specific counters
    if (Object.keys(userUpdates).length > 0) {
        await updateUser(discordId, userUpdates);
    }
    
    return { 
        success: true, 
        baseXP: DAILY_XP,
        classBonus,
        streakBonus,
        skillDailyBonus,
        totalXP,
        bonusInfo,
        streak: newStreak,
        streakBroken,
        newBalance: xpResult.balanceAfter, 
        newLevel: xpResult.newLevel 
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACHIEVEMENT UNLOCKING
// ═══════════════════════════════════════════════════════════════════════════════

export async function unlockAchievement(discordId, achievementKey) {
    const p = await getPool();
    try {
        await p.execute(
            'INSERT IGNORE INTO achievements (discord_id, achievement_key, unlocked_at) VALUES (?, ?, NOW())',
            [discordId, achievementKey]
        );
        return true;
    } catch (error) {
        console.error('Unlock achievement error:', error);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESET PROGRESS
// ═══════════════════════════════════════════════════════════════════════════════

export async function resetUserProgress(discordId) {
    const p = await getPool();
    
    // Delete all lists (cascade deletes items)
    await p.execute('DELETE FROM lists WHERE discord_id = ?', [discordId]);
    
    // Delete achievements
    await p.execute('DELETE FROM achievements WHERE discord_id = ?', [discordId]);
    
    // Delete game sessions
    await p.execute('DELETE FROM game_sessions WHERE discord_id = ?', [discordId]);
    
    // Delete XP transactions
    await p.execute('DELETE FROM xp_transactions WHERE discord_id = ?', [discordId]);
    
    // Delete user skills
    await p.execute('DELETE FROM user_skills WHERE discord_id = ?', [discordId]);
    
    // Reset user stats to defaults
    await p.execute(`
        UPDATE users SET 
            player_xp = 0,
            player_level = 1,
            player_class = 'DEFAULT',
            streak_count = 0,
            last_active_day = NULL,
            last_daily_claim = NULL,
            total_lists_created = 0,
            total_items_added = 0,
            total_items_completed = 0,
            owns_hero = FALSE,
            owns_gambler = FALSE,
            owns_assassin = FALSE,
            owns_wizard = FALSE,
            owns_archer = FALSE,
            owns_tank = FALSE,
            assassin_streak = 0,
            assassin_stacks = 0,
            wizard_counter = 0,
            archer_streak = 0,
            tank_stacks = 0
        WHERE discord_id = ?
    `, [discordId]);
    
    return true;
}

export default {
    getPool, getUser, createUser, getOrCreateUser, updateUser, getUserStats,
    getLists, getListById, createList, updateList, deleteList,
    getItems, getItemById, createItem, updateItem, deleteItem, toggleItemComplete,
    getUserSkills, hasSkill, unlockSkill, upgradeSkill,
    getAchievements, unlockAchievement, getLeaderboard,
    recordGameResult, getGameHistory, addXPTransaction, getXPHistory, claimDaily,
    resetUserProgress
};
