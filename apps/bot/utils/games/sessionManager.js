/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🎮 GAME SESSION MANAGER - Tracks active/past games
 * 
 *  RULES:
 *  - One active game per user per type
 *  - Session expires after 30 minutes
 *  - Bet is "escrowed" at game start
 *  - Resolution is atomic
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const db = require('../../database/db');

const SESSION_TIMEOUT_MINUTES = 30;

/**
 * Safely parse JSON - handles already-parsed objects from TiDB
 */
function safeJsonParse(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (e) {
        return value;
    }
}

/**
 * Check if user has an active game session
 */
async function hasActiveSession(userId, gameType = null) {
    const pool = await db.getPool();
    
    let query = `SELECT id FROM game_sessions WHERE discord_id = ? AND state = 'active'`;
    const params = [userId];
    
    if (gameType) {
        query += ` AND game_type = ?`;
        params.push(gameType);
    }
    
    const [rows] = await pool.execute(query, params);
    return rows.length > 0;
}

/**
 * Get active session for user
 */
async function getActiveSession(userId, gameType) {
    const pool = await db.getPool();
    
    const [rows] = await pool.execute(
        `SELECT gs.*, bh.player_hand, bh.dealer_hand, bh.deck_state, bh.player_value, bh.dealer_value, bh.last_action
         FROM game_sessions gs
         LEFT JOIN blackjack_hands bh ON gs.id = bh.session_id
         WHERE gs.discord_id = ? AND gs.game_type = ? AND gs.state = 'active'
         ORDER BY gs.started_at DESC LIMIT 1`,
        [userId, gameType]
    );
    
    if (rows.length === 0) return null;
    
    const session = rows[0];
    
    // Parse JSON fields safely (TiDB may return objects or strings)
    session.player_hand = safeJsonParse(session.player_hand);
    session.dealer_hand = safeJsonParse(session.dealer_hand);
    session.deck_state = safeJsonParse(session.deck_state);
    
    return session;
}

/**
 * Create a new game session
 */
async function createSession(userId, gameType, betAmount) {
    const pool = await db.getPool();
    
    // Check for existing active session
    if (await hasActiveSession(userId, gameType)) {
        return { success: false, error: 'Already have an active game' };
    }
    
    const [result] = await pool.execute(
        `INSERT INTO game_sessions (discord_id, game_type, bet_amount, state) VALUES (?, ?, ?, 'active')`,
        [userId, gameType, betAmount]
    );
    
    return { success: true, sessionId: result.insertId };
}

/**
 * Create blackjack hand record
 */
async function createBlackjackHand(sessionId, playerHand, dealerHand, deckState) {
    const pool = await db.getPool();
    
    const { calculateHandValue } = require('./deck');
    const playerValue = calculateHandValue(playerHand).value;
    const dealerValue = calculateHandValue([dealerHand[0]]).value;
    
    await pool.execute(
        `INSERT INTO blackjack_hands (session_id, player_hand, dealer_hand, deck_state, player_value, dealer_value)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sessionId, JSON.stringify(playerHand), JSON.stringify(dealerHand), JSON.stringify(deckState), playerValue, dealerValue]
    );
    
    return { playerValue, dealerValue };
}

/**
 * Update blackjack hand (after hit/stand)
 */
async function updateBlackjackHand(sessionId, playerHand, dealerHand, deckState, lastAction) {
    const pool = await db.getPool();
    
    const { calculateHandValue } = require('./deck');
    const playerValue = calculateHandValue(playerHand).value;
    const dealerValue = calculateHandValue(dealerHand).value;
    
    await pool.execute(
        `UPDATE blackjack_hands 
         SET player_hand = ?, dealer_hand = ?, deck_state = ?, player_value = ?, dealer_value = ?, last_action = ?
         WHERE session_id = ?`,
        [JSON.stringify(playerHand), JSON.stringify(dealerHand), JSON.stringify(deckState), playerValue, dealerValue, lastAction, sessionId]
    );
    
    return { playerValue, dealerValue };
}

/**
 * End a game session with outcome
 */
async function endSession(sessionId, state, payout = 0) {
    const pool = await db.getPool();
    
    await pool.execute(
        `UPDATE game_sessions SET state = ?, payout = ?, ended_at = NOW() WHERE id = ?`,
        [state, payout, sessionId]
    );
    
    return { success: true };
}

/**
 * Expire old sessions (cleanup job)
 */
async function expireOldSessions() {
    const pool = await db.getPool();
    
    const [result] = await pool.execute(
        `UPDATE game_sessions 
         SET state = 'expired', ended_at = NOW() 
         WHERE state = 'active' AND started_at < DATE_SUB(NOW(), INTERVAL ${SESSION_TIMEOUT_MINUTES} MINUTE)`
    );
    
    return result.affectedRows;
}

/**
 * Get session by ID
 */
async function getSessionById(sessionId) {
    const pool = await db.getPool();
    
    const [rows] = await pool.execute(
        `SELECT gs.*, bh.player_hand, bh.dealer_hand, bh.deck_state, bh.player_value, bh.dealer_value, bh.last_action
         FROM game_sessions gs
         LEFT JOIN blackjack_hands bh ON gs.id = bh.session_id
         WHERE gs.id = ?`,
        [sessionId]
    );
    
    if (rows.length === 0) return null;
    
    const session = rows[0];
    session.player_hand = safeJsonParse(session.player_hand);
    session.dealer_hand = safeJsonParse(session.dealer_hand);
    session.deck_state = safeJsonParse(session.deck_state);
    
    return session;
}

/**
 * Get user's game history
 */
async function getGameHistory(userId, gameType = null, limit = 10) {
    const pool = await db.getPool();
    const safeLimit = parseInt(limit) || 10;
    
    let query = `SELECT * FROM game_sessions WHERE discord_id = ?`;
    const params = [userId];
    
    if (gameType) {
        query += ` AND game_type = ?`;
        params.push(gameType);
    }
    
    query += ` ORDER BY started_at DESC LIMIT ${safeLimit}`;
    
    const [rows] = await pool.execute(query, params);
    return rows;
}

module.exports = {
    hasActiveSession,
    getActiveSession,
    createSession,
    createBlackjackHand,
    updateBlackjackHand,
    endSession,
    expireOldSessions,
    getSessionById,
    getGameHistory,
    SESSION_TIMEOUT_MINUTES
};