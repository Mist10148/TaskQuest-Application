/**
 * 💾 TASKQUEST - DATABASE MODULE
 * Supports local MySQL and cloud providers (Aiven, PlanetScale, etc.)
 */

const mysql = require('mysql2/promise');
let pool = null;

async function getPool() {
    if (!pool) {
        // Support connection URL for cloud databases
        if (process.env.DB_URL) {
            pool = mysql.createPool(process.env.DB_URL);
        } else {
            const config = {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT) || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'taskquest_bot',
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            };
            
            // SSL for cloud databases (Aiven, etc.)
            if (process.env.DB_SSL === 'true') {
                config.ssl = { 
                    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' 
                };
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
    }
    return pool;
}

async function closePool() { if (pool) { await pool.end(); pool = null; } }

async function initializeDatabase() {
    const p = await getPool();
    
    // Run all CREATE TABLE statements in parallel for faster startup
    await Promise.all([
        p.execute(`CREATE TABLE IF NOT EXISTS users (
            discord_id VARCHAR(32) PRIMARY KEY,
            player_xp BIGINT DEFAULT 0,
            player_level BIGINT DEFAULT 1,
            player_class ENUM('DEFAULT','HERO','GAMBLER','ASSASSIN','WIZARD','ARCHER','TANK') DEFAULT 'DEFAULT',
            gamification_enabled BOOLEAN DEFAULT TRUE,
            automation_enabled BOOLEAN DEFAULT TRUE,
            auto_delete_old_lists BOOLEAN DEFAULT TRUE,
            streak_count INT DEFAULT 0,
            last_active_day DATE DEFAULT NULL,
            last_daily_claim DATETIME DEFAULT NULL,
            owns_hero BOOLEAN DEFAULT FALSE,
            owns_gambler BOOLEAN DEFAULT FALSE,
            owns_assassin BOOLEAN DEFAULT FALSE,
            owns_wizard BOOLEAN DEFAULT FALSE,
            owns_archer BOOLEAN DEFAULT FALSE,
            owns_tank BOOLEAN DEFAULT FALSE,
            assassin_streak INT DEFAULT 0,
            assassin_stacks INT DEFAULT 0,
            wizard_counter INT DEFAULT 0,
            archer_streak INT DEFAULT 0,
            tank_stacks INT DEFAULT 0,
            total_items_added INT DEFAULT 0,
            total_items_completed INT DEFAULT 0,
            total_lists_created INT DEFAULT 0,
            skill_points INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`),
        p.execute(`CREATE TABLE IF NOT EXISTS lists (
            id INT AUTO_INCREMENT PRIMARY KEY,
            discord_id VARCHAR(32) NOT NULL,
            name VARCHAR(100) NOT NULL,
            description TEXT DEFAULT NULL,
            category VARCHAR(50) DEFAULT NULL,
            deadline DATE DEFAULT NULL,
            priority ENUM('LOW','MEDIUM','HIGH') DEFAULT NULL,
            deadline_notified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_user_list (discord_id, name)
        )`),
        p.execute(`CREATE TABLE IF NOT EXISTS items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            list_id INT NOT NULL,
            name VARCHAR(200) NOT NULL,
            description TEXT DEFAULT NULL,
            completed BOOLEAN DEFAULT FALSE,
            position INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`),
        p.execute(`CREATE TABLE IF NOT EXISTS achievements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            discord_id VARCHAR(32) NOT NULL,
            achievement_key VARCHAR(50) NOT NULL,
            unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_achievement (discord_id, achievement_key)
        )`),
        p.execute(`CREATE TABLE IF NOT EXISTS user_skills (
            id INT AUTO_INCREMENT PRIMARY KEY,
            discord_id VARCHAR(32) NOT NULL,
            skill_id VARCHAR(50) NOT NULL,
            skill_level INT DEFAULT 1,
            unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_skill (discord_id, skill_id)
        )`),
        p.execute(`CREATE TABLE IF NOT EXISTS game_sessions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            discord_id VARCHAR(32) NOT NULL,
            game_type VARCHAR(20) NOT NULL,
            bet_amount INT DEFAULT 0,
            state VARCHAR(20) DEFAULT 'active',
            game_data JSON,
            payout INT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP NULL
        )`),
        p.execute(`CREATE TABLE IF NOT EXISTS xp_transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            discord_id VARCHAR(32) NOT NULL,
            amount BIGINT NOT NULL,
            source VARCHAR(50) NOT NULL,
            balance_before BIGINT DEFAULT 0,
            balance_after BIGINT DEFAULT 0,
            reference_id INT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`)
    ]);

    // Add auto_delete_old_lists column if it doesn't exist (migration)
    try {
        await p.execute(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS auto_delete_old_lists BOOLEAN DEFAULT TRUE
        `);
    } catch (e) {
        // Column might already exist
    }

    // Add updated_at column to items table if it doesn't exist (migration)
    try {
        await p.execute(`
            ALTER TABLE items
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        `);
    } catch (e) {
        // Column might already exist
    }

    // Upgrade player_xp and player_level to BIGINT (supports values up to 9,223,372,036,854,775,807)
    try {
        await p.execute(`ALTER TABLE users MODIFY COLUMN player_xp BIGINT DEFAULT 0`);
        await p.execute(`ALTER TABLE users MODIFY COLUMN player_level BIGINT DEFAULT 1`);
        await p.execute(`ALTER TABLE xp_transactions MODIFY COLUMN amount BIGINT NOT NULL`);
        await p.execute(`ALTER TABLE xp_transactions MODIFY COLUMN balance_before BIGINT DEFAULT 0`);
        await p.execute(`ALTER TABLE xp_transactions MODIFY COLUMN balance_after BIGINT DEFAULT 0`);
        console.log('✅ Upgraded XP columns to BIGINT');
    } catch (e) {
        // Migration might have already run
        console.log('Note: XP BIGINT migration skipped (may already be applied)');
    }

    console.log('✅ Database tables ready');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  👤 USERS
// ═══════════════════════════════════════════════════════════════════════════════

async function getUser(id) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM users WHERE discord_id = ?', [id]);
    return rows[0] || null;
}

async function createUser(id) {
    const p = await getPool();
    await p.execute('INSERT IGNORE INTO users (discord_id) VALUES (?)', [id]);
    return getUser(id);
}

async function getOrCreateUser(id) {
    return (await getUser(id)) || (await createUser(id));
}

async function updateUser(id, updates) {
    if (!Object.keys(updates).length) return;
    const p = await getPool();
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await p.execute(`UPDATE users SET ${fields} WHERE discord_id = ?`, [...Object.values(updates), id]);
}

async function getLeaderboard(limit = 10) {
    const p = await getPool();
    const safeLimit = parseInt(limit) || 10;
    const [rows] = await p.execute(`SELECT * FROM users WHERE gamification_enabled = TRUE ORDER BY player_xp DESC LIMIT ${safeLimit}`);
    return rows;
}

async function getUserStats(id) {
    const p = await getPool();
    const user = await getUser(id);
    if (!user) return null;
    
    // Get list count
    const [lists] = await p.execute('SELECT COUNT(*) as total FROM lists WHERE discord_id = ?', [id]);
    
    // Get item stats
    const [items] = await p.execute(`
        SELECT COUNT(i.id) as total, SUM(CASE WHEN i.completed THEN 1 ELSE 0 END) as completed
        FROM items i JOIN lists l ON i.list_id = l.id WHERE l.discord_id = ?
    `, [id]);
    
    // Get achievement count
    const [achs] = await p.execute('SELECT COUNT(*) as count FROM achievements WHERE discord_id = ?', [id]);
    
    // Game statistics
    let gameStats = { played: 0, won: 0, lost: 0, draws: 0 };
    try {
        const [games] = await p.execute(`
            SELECT 
                COUNT(*) as played,
                COALESCE(SUM(CASE WHEN state IN ('won', 'blackjack') THEN 1 ELSE 0 END), 0) as won,
                COALESCE(SUM(CASE WHEN state IN ('lost', 'expired', 'cancelled', 'surrender') THEN 1 ELSE 0 END), 0) as lost,
                COALESCE(SUM(CASE WHEN state = 'push' THEN 1 ELSE 0 END), 0) as draws
            FROM game_sessions 
            WHERE discord_id = ? 
            AND state != 'active'
        `, [id]);
        
        if (games && games[0]) {
            gameStats = {
                played: Number(games[0].played) || 0,
                won: Number(games[0].won) || 0,
                lost: Number(games[0].lost) || 0,
                draws: Number(games[0].draws) || 0
            };
        }
    } catch (e) { 
        console.error('Game stats query error:', e.message);
    }
    
    return { 
        user, 
        lists: lists[0] || { total: 0 },
        items: items[0] || { total: 0, completed: 0 },
        achievements: achs[0]?.count || 0,
        games: gameStats
    };
}

async function toggleAutomation(id) {
    const p = await getPool();
    await p.execute('UPDATE users SET automation_enabled = NOT automation_enabled WHERE discord_id = ?', [id]);
    return (await getUser(id)).automation_enabled;
}

async function toggleGamification(id) {
    const p = await getPool();
    await p.execute('UPDATE users SET gamification_enabled = NOT gamification_enabled WHERE discord_id = ?', [id]);
    return (await getUser(id)).gamification_enabled;
}

async function getListsDueToday(today) {
    const p = await getPool();
    const [rows] = await p.execute(`
        SELECT l.* FROM lists l 
        JOIN users u ON l.discord_id = u.discord_id 
        WHERE l.deadline = ? AND l.deadline_notified = FALSE AND u.automation_enabled = TRUE
    `, [today]);
    return rows;
}

async function markDeadlineNotified(listId) {
    const p = await getPool();
    await p.execute('UPDATE lists SET deadline_notified = TRUE WHERE id = ?', [listId]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  📋 LISTS
// ═══════════════════════════════════════════════════════════════════════════════

async function createList(discordId, name, description = null, category = null, priority = null, deadline = null) {
    const p = await getPool();
    const [result] = await p.execute(
        'INSERT INTO lists (discord_id, name, description, category, priority, deadline) VALUES (?, ?, ?, ?, ?, ?)',
        [discordId, name, description, category, priority, deadline]
    );
    await p.execute('UPDATE users SET total_lists_created = total_lists_created + 1 WHERE discord_id = ?', [discordId]);
    return result.insertId;
}

async function getLists(discordId, sortBy = 'created_at', sortOrder = 'DESC') {
    const p = await getPool();
    const validSort = ['name', 'created_at', 'priority', 'category', 'deadline'];
    const sort = validSort.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder === 'ASC' ? 'ASC' : 'DESC';
    
    let orderClause = `${sort} ${order}`;
    if (sort === 'priority') {
        orderClause = `CASE WHEN priority IS NULL THEN 4 WHEN priority = 'HIGH' THEN 1 WHEN priority = 'MEDIUM' THEN 2 ELSE 3 END ${order === 'DESC' ? 'ASC' : 'DESC'}`;
    }
    
    const [rows] = await p.execute(`SELECT * FROM lists WHERE discord_id = ? ORDER BY ${orderClause}`, [discordId]);
    return rows;
}

async function getListByName(discordId, name) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM lists WHERE discord_id = ? AND name = ?', [discordId, name]);
    return rows[0] || null;
}

async function getListById(listId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM lists WHERE id = ?', [listId]);
    return rows[0] || null;
}

async function updateList(listId, updates) {
    if (!Object.keys(updates).length) return;
    const p = await getPool();
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await p.execute(`UPDATE lists SET ${fields} WHERE id = ?`, [...Object.values(updates), listId]);
}

async function deleteList(listId) {
    const p = await getPool();
    await p.execute('DELETE FROM lists WHERE id = ?', [listId]);
}

async function searchLists(discordId, query) {
    const p = await getPool();
    const term = `%${query}%`;
    const [rows] = await p.execute(
        'SELECT * FROM lists WHERE discord_id = ? AND (name LIKE ? OR category LIKE ? OR notes LIKE ?)',
        [discordId, term, term, term]
    );
    return rows;
}

async function getListStats(listId) {
    const p = await getPool();
    const [rows] = await p.execute(`
        SELECT 
            COUNT(*) as total, 
            COALESCE(SUM(CASE WHEN completed THEN 1 ELSE 0 END), 0) as completed,
            COALESCE(SUM(CASE WHEN description IS NOT NULL AND description != '' THEN 1 ELSE 0 END), 0) as with_desc
        FROM items WHERE list_id = ?
    `, [listId]);
    return rows[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ✅ ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

async function addItem(listId, name, description = null) {
    const p = await getPool();
    const [pos] = await p.execute('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM items WHERE list_id = ?', [listId]);
    const [result] = await p.execute(
        'INSERT INTO items (list_id, name, description, position) VALUES (?, ?, ?, ?)',
        [listId, name, description, pos[0].pos]
    );
    const [list] = await p.execute('SELECT discord_id FROM lists WHERE id = ?', [listId]);
    if (list[0]) await p.execute('UPDATE users SET total_items_added = total_items_added + 1 WHERE discord_id = ?', [list[0].discord_id]);
    return result.insertId;
}

async function getItems(listId, sortBy = 'position', sortOrder = 'ASC') {
    const p = await getPool();
    const validSort = ['position', 'name', 'completed', 'created_at'];
    const sort = validSort.includes(sortBy) ? sortBy : 'position';
    const order = sortOrder === 'ASC' ? 'ASC' : 'DESC';
    const [rows] = await p.execute(`SELECT * FROM items WHERE list_id = ? ORDER BY ${sort} ${order}`, [listId]);
    return rows;
}

async function getItemById(itemId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM items WHERE id = ?', [itemId]);
    return rows[0] || null;
}

async function updateItem(itemId, updates) {
    if (!Object.keys(updates).length) return;
    const p = await getPool();
    const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await p.execute(`UPDATE items SET ${fields} WHERE id = ?`, [...Object.values(updates), itemId]);
}

async function deleteItem(itemId) {
    const p = await getPool();
    await p.execute('DELETE FROM items WHERE id = ?', [itemId]);
}

async function toggleItemComplete(itemId, discordId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT completed FROM items WHERE id = ?', [itemId]);
    if (!rows[0]) return null;
    const newStatus = !rows[0].completed;
    await p.execute('UPDATE items SET completed = ? WHERE id = ?', [newStatus, itemId]);
    if (newStatus) await p.execute('UPDATE users SET total_items_completed = total_items_completed + 1 WHERE discord_id = ?', [discordId]);
    return newStatus;
}

async function swapItemPositions(id1, id2) {
    const p = await getPool();
    const [i1] = await p.execute('SELECT position FROM items WHERE id = ?', [id1]);
    const [i2] = await p.execute('SELECT position FROM items WHERE id = ?', [id2]);
    if (!i1[0] || !i2[0]) return false;
    await p.execute('UPDATE items SET position = ? WHERE id = ?', [i2[0].position, id1]);
    await p.execute('UPDATE items SET position = ? WHERE id = ?', [i1[0].position, id2]);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🏆 ACHIEVEMENTS (Personal only)
// ═══════════════════════════════════════════════════════════════════════════════

async function getAchievements(discordId) {
    const p = await getPool();
    const [rows] = await p.execute('SELECT * FROM achievements WHERE discord_id = ? ORDER BY unlocked_at DESC', [discordId]);
    return rows;
}

async function unlockAchievement(discordId, key) {
    const p = await getPool();
    try { 
        await p.execute('INSERT INTO achievements (discord_id, achievement_key) VALUES (?, ?)', [discordId, key]); 
        return true; 
    } catch (e) { 
        return false; 
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🌳 SKILLS
// ═══════════════════════════════════════════════════════════════════════════════

async function getUserSkills(discordId) {
    const p = await getPool();
    try {
        const [rows] = await p.execute('SELECT * FROM user_skills WHERE discord_id = ? ORDER BY unlocked_at DESC', [discordId]);
        return rows;
    } catch (e) {
        return [];
    }
}

async function hasSkill(discordId, skillId) {
    const p = await getPool();
    try {
        const [rows] = await p.execute('SELECT * FROM user_skills WHERE discord_id = ? AND skill_id = ?', [discordId, skillId]);
        return rows[0] || null;
    } catch (e) {
        return null;
    }
}

async function unlockSkill(discordId, skillId) {
    const p = await getPool();
    try {
        await p.execute('INSERT INTO user_skills (discord_id, skill_id, skill_level) VALUES (?, ?, 1)', [discordId, skillId]);
        return true;
    } catch (e) {
        return false;
    }
}

async function upgradeSkill(discordId, skillId) {
    const p = await getPool();
    try {
        await p.execute('UPDATE user_skills SET skill_level = skill_level + 1 WHERE discord_id = ? AND skill_id = ?', [discordId, skillId]);
        return true;
    } catch (e) {
        return false;
    }
}

async function addSkillPoints(discordId, amount) {
    const p = await getPool();
    try {
        await p.execute('UPDATE users SET skill_points = skill_points + ? WHERE discord_id = ?', [amount, discordId]);
        return true;
    } catch (e) {
        return false;
    }
}

// Get game statistics for a user
async function getGameStats(discordId) {
    const p = await getPool();
    try {
        // Get game session stats
        const [sessions] = await p.execute(`
            SELECT 
                COUNT(*) as total_games,
                SUM(CASE WHEN state = 'won' OR state = 'blackjack' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN state = 'lost' THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN state = 'push' THEN 1 ELSE 0 END) as pushes,
                SUM(payout) as total_winnings
            FROM game_sessions 
            WHERE discord_id = ? AND state != 'active' AND state != 'cancelled'
        `, [discordId]);
        
        return {
            totalGames: parseInt(sessions[0]?.total_games) || 0,
            wins: parseInt(sessions[0]?.wins) || 0,
            losses: parseInt(sessions[0]?.losses) || 0,
            pushes: parseInt(sessions[0]?.pushes) || 0,
            totalWinnings: parseInt(sessions[0]?.total_winnings) || 0
        };
    } catch (e) {
        // Table might not exist
        return { totalGames: 0, wins: 0, losses: 0, pushes: 0, totalWinnings: 0 };
    }
}

/**
 * Record a game result directly (for games that don't use session system)
 * @param {string} discordId - User's Discord ID
 * @param {string} gameType - 'blackjack', 'rps', 'hangman', 'slots'
 * @param {string} state - 'won', 'lost', 'push'
 * @param {number} payout - XP payout (0 for losses)
 */
async function recordGameResult(discordId, gameType, state, xpGained = 0, betAmount = 0) {
    const pool = await getPool();
    
    // For web history display: payout = bet + xpGained (so web can calculate XP as payout - bet)
    // RPS: bet=0, payout=xpGained (risk-free, only gain on win)
    // Hangman/Blackjack: bet=actual bet, payout=bet+xpGained on win, 0 on loss
    let payout = 0;
    if (state === 'won' || state === 'blackjack') {
        payout = betAmount + xpGained;
    } else if (state === 'push') {
        payout = betAmount; // Return bet
    }
    // Lost = payout stays 0
    
    await pool.execute(
        `INSERT INTO game_sessions (discord_id, game_type, bet_amount, state, payout, ended_at) 
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [discordId, gameType, betAmount, state, payout]
    );
}

/**
 * Auto-delete lists that are expired or completed for 5+ days
 * Only deletes for users who have auto_delete_old_lists enabled
 */
async function cleanupOldLists() {
    try {
        const pool = await getPool();
        let totalDeleted = 0;

        // Find and delete completed lists older than 5 days (TiDB-compatible approach)
        const [completedLists] = await pool.execute(`
            SELECT l.id, l.discord_id
            FROM lists l
            INNER JOIN users u ON l.discord_id = u.discord_id
            WHERE u.auto_delete_old_lists = TRUE
        `);

        for (const list of completedLists) {
            const [items] = await pool.execute(
                'SELECT id, completed, updated_at FROM items WHERE list_id = ?',
                [list.id]
            );

            // Check if list is fully completed and old enough
            if (items.length > 0) {
                const allCompleted = items.every(item => item.completed);
                if (allCompleted) {
                    const oldestUpdate = items.reduce((oldest, item) => {
                        const itemDate = new Date(item.updated_at);
                        return itemDate < oldest ? itemDate : oldest;
                    }, new Date());

                    const daysSinceUpdate = Math.floor((Date.now() - oldestUpdate.getTime()) / (1000 * 60 * 60 * 24));

                    if (daysSinceUpdate >= 5) {
                        await pool.execute('DELETE FROM lists WHERE id = ?', [list.id]);
                        totalDeleted++;
                    }
                }
            }

            // Check if list is expired and old enough
            const [listData] = await pool.execute(
                'SELECT deadline FROM lists WHERE id = ?',
                [list.id]
            );

            if (listData[0]?.deadline) {
                const deadline = new Date(listData[0].deadline);
                const daysSinceDeadline = Math.floor((Date.now() - deadline.getTime()) / (1000 * 60 * 60 * 24));

                if (daysSinceDeadline >= 5) {
                    const hasIncomplete = items.length === 0 || items.some(item => !item.completed);
                    if (hasIncomplete) {
                        await pool.execute('DELETE FROM lists WHERE id = ?', [list.id]);
                        totalDeleted++;
                    }
                }
            }
        }

        if (totalDeleted > 0) {
            console.log(`🗑️  Auto-deleted ${totalDeleted} old lists`);
        }

        return totalDeleted;
    } catch (error) {
        console.error('❌ [AUTO-DELETE] Error:', error.message);
        return 0;
    }
}

module.exports = {
    getPool, closePool, initializeDatabase,
    getUser, createUser, getOrCreateUser, updateUser, getLeaderboard, getUserStats, getGameStats,
    toggleAutomation, toggleGamification, getListsDueToday, markDeadlineNotified,
    createList, getLists, getListByName, getListById, updateList, deleteList, searchLists, getListStats,
    addItem, getItems, getItemById, updateItem, deleteItem, toggleItemComplete, swapItemPositions,
    getAchievements, unlockAchievement,
    getUserSkills, hasSkill, unlockSkill, upgradeSkill, addSkillPoints,
    recordGameResult, cleanupOldLists
};