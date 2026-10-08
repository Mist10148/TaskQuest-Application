/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  💰 XP TRANSACTION SERVICE - Atomic XP operations with full logging
 * 
 *  RULES:
 *  - NEVER update user XP directly
 *  - ALL XP changes must go through this service
 *  - Every change creates a transaction record
 *  - Supports escrow model for games (lock XP at start)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const db = require('../../database/db');

/**
 * Process an XP transaction atomically
 * @param {string} userId - Discord user ID
 * @param {number} amount - XP to add (positive) or remove (negative)
 * @param {string} source - Transaction source (e.g., 'blackjack_win')
 * @param {number|null} referenceId - Optional reference (game session ID)
 * @returns {Promise<{success: boolean, newBalance: number, transaction: object}>}
 */
async function processXPTransaction(userId, amount, source, referenceId = null) {
    const pool = await db.getPool();
    const conn = await pool.getConnection();
    
    try {
        await conn.beginTransaction();
        
        // Get current balance with lock
        const [users] = await conn.execute(
            'SELECT player_xp FROM users WHERE discord_id = ? FOR UPDATE',
            [userId]
        );
        
        if (!users.length) {
            await conn.rollback();
            return { success: false, error: 'User not found' };
        }
        
        const balanceBefore = users[0].player_xp;
        const balanceAfter = balanceBefore + amount;
        
        // Prevent negative balance
        if (balanceAfter < 0) {
            await conn.rollback();
            return { success: false, error: 'Insufficient XP', balanceBefore };
        }
        
        // Update user XP
        await conn.execute(
            'UPDATE users SET player_xp = ? WHERE discord_id = ?',
            [balanceAfter, userId]
        );
        
        // Log transaction
        const [result] = await conn.execute(
            `INSERT INTO xp_transactions (discord_id, amount, source, reference_id, balance_before, balance_after)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, amount, source, referenceId, balanceBefore, balanceAfter]
        );
        
        await conn.commit();
        
        return {
            success: true,
            balanceBefore,
            balanceAfter,
            transaction: {
                id: result.insertId,
                amount,
                source,
                referenceId
            }
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

/**
 * Get user's current XP balance (for validation)
 */
async function getBalance(userId) {
    const user = await db.getUser(userId);
    return user ? user.player_xp : 0;
}

/**
 * Validate if user can afford a bet
 */
async function canAffordBet(userId, betAmount, minBet = 10, maxBetPercent = 0.25, hardCap = 1000) {
    const balance = await getBalance(userId);
    const maxBet = Math.min(Math.floor(balance * maxBetPercent), hardCap);
    
    return {
        canAfford: balance >= betAmount && betAmount >= minBet && betAmount <= maxBet,
        balance,
        minBet,
        maxBet,
        betAmount
    };
}

/**
 * Calculate max bet for user
 */
async function getMaxBet(userId, maxBetPercent = 0.25, hardCap = 1000) {
    const balance = await getBalance(userId);
    return Math.min(Math.floor(balance * maxBetPercent), hardCap);
}

/**
 * Get transaction history for user
 */
async function getTransactionHistory(userId, limit = 10) {
    const pool = await db.getPool();
    const safeLimit = parseInt(limit) || 10;
    const [rows] = await pool.execute(
        `SELECT * FROM xp_transactions WHERE discord_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`,
        [userId]
    );
    return rows;
}

/**
 * Get gambling statistics for user
 */
async function getGamblingStats(userId) {
    const pool = await db.getPool();
    
    const [wins] = await pool.execute(
        `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total 
         FROM xp_transactions WHERE discord_id = ? AND source IN ('blackjack_win', 'blackjack_blackjack')`,
        [userId]
    );
    
    const [losses] = await pool.execute(
        `SELECT COUNT(*) as count, COALESCE(SUM(ABS(amount)), 0) as total 
         FROM xp_transactions WHERE discord_id = ? AND source = 'blackjack_loss'`,
        [userId]
    );
    
    const [pushes] = await pool.execute(
        `SELECT COUNT(*) as count FROM xp_transactions WHERE discord_id = ? AND source = 'blackjack_push'`,
        [userId]
    );
    
    return {
        wins: { count: wins[0].count, total: wins[0].total },
        losses: { count: losses[0].count, total: Math.abs(losses[0].total) },
        pushes: pushes[0].count,
        netProfit: wins[0].total - Math.abs(losses[0].total)
    };
}

module.exports = {
    processXPTransaction,
    getBalance,
    canAffordBet,
    getMaxBet,
    getTransactionHistory,
    getGamblingStats
};
