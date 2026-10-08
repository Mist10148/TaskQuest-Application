/**
 * Server-authoritative games. The bot and the web API call these functions;
 * neither client decides outcomes or payouts.
 *
 * Every state change runs in a transaction that locks the user row and the
 * game session row, so double clicks / concurrent requests cannot resolve a
 * hand twice or pay out twice.
 *
 * game_sessions.payout is the gross XP returned to the player (bet included),
 * so net = payout - bet_amount for every game type.
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser, getUserSkills } = require('./users');
const { applyXP, rewardAction, remainingFreeGameXP, unlockAchievements, requireGamification, updateUserColumns } = require('./progression');
const { errors } = require('../errors');
const { REWARDS, LIMITS, ARCADE_CONFIG } = require('../constants');
const { calculateFinalXP } = require('../xp');
const blackjack = require('../games/blackjack');
const rps = require('../games/rps');
const hangman = require('../games/hangman');
const arcade = require('../games/arcade');

function parseData(value) {
    if (value === null || value === undefined) return null;
    return typeof value === 'string' ? JSON.parse(value) : value;
}

async function lockActiveSession(conn, discordId, gameType) {
    const [rows] = await conn.query(
        `SELECT * FROM game_sessions WHERE discord_id = ? AND game_type = ? AND state = 'active'
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [discordId, gameType]
    );
    if (!rows[0]) return null;
    return { ...rows[0], game_data: parseData(rows[0].game_data) };
}

async function insertSession(conn, discordId, gameType, { bet = 0, state = 'active', data = null, payout = 0 } = {}) {
    const ended = state === 'active' ? null : new Date();
    const [res] = await conn.query(
        'INSERT INTO game_sessions (discord_id, game_type, bet_amount, state, game_data, payout, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [discordId, gameType, bet, state, data ? JSON.stringify(data) : null, payout, ended]
    );
    return res.insertId;
}

async function finishSession(conn, sessionId, state, payout, data) {
    const [res] = await conn.query(
        `UPDATE game_sessions SET state = ?, payout = ?, game_data = ?, ended_at = CURRENT_TIMESTAMP
         WHERE id = ? AND state = 'active'`,
        [state, payout, JSON.stringify(data), sessionId]
    );
    if (res.affectedRows !== 1) throw errors.conflict('This game has already finished.');
}

/** Throttle free games using users.last_game_at. */
function enforceCooldown(user) {
    if (!user.last_game_at) return;
    const elapsed = Date.now() - new Date(user.last_game_at).getTime();
    if (elapsed < LIMITS.GAME_COOLDOWN_MS) throw errors.cooldown(LIMITS.GAME_COOLDOWN_MS - elapsed);
}

/** Award free-game XP with class/skill bonuses, capped by the daily allowance. */
async function rewardFreeGame(conn, user, baseXP, sessionId) {
    if (baseXP <= 0) return null;
    const remaining = await remainingFreeGameXP(conn, user.discord_id);
    return rewardAction(conn, user, 'game_reward', baseXP, {
        maxXP: remaining,
        referenceId: sessionId,
        context: { action: 'game' }
    });
}

// ─── Blackjack ───────────────────────────────────────────────────────────────

async function settleBlackjack(conn, user, session, state) {
    const { winnings } = blackjack.settle(state);
    let credited = 0;
    let bonus = null;

    if (state.outcome === 'won' || state.outcome === 'blackjack') {
        const skills = await getUserSkills(user.discord_id, conn);
        bonus = calculateFinalXP(user, skills, winnings, { context: { action: 'game' } });
        credited = state.bet + bonus.finalXP;
        await applyXP(conn, user, credited, state.outcome === 'blackjack' ? 'blackjack_blackjack' : 'blackjack_win', {
            lifetimeDelta: bonus.finalXP,
            referenceId: session.id,
            userUpdates: bonus.userUpdates
        });
    } else if (state.outcome === 'push') {
        credited = state.bet;
        await applyXP(conn, user, credited, 'blackjack_push', { lifetimeDelta: 0, referenceId: session.id });
    }

    await finishSession(conn, session.id, state.outcome, credited, state);
    const net = credited - state.bet;
    const achievements = await unlockAchievements(conn, user, {
        blackjack: state.outcome === 'blackjack',
        gameWinXP: Math.max(0, net)
    });
    return { credited, net, bonusInfo: bonus ? bonus.bonusInfo : null, achievements };
}

function blackjackResult(session, state, user, settlement = null) {
    return {
        sessionId: session.id,
        view: blackjack.publicView(state),
        balance: Number(user.player_xp),
        maxBet: blackjack.maxBet(Number(user.player_xp)),
        settlement
    };
}

/** Current unfinished hand (client-safe view), or null. */
async function getActiveBlackjack(discordId) {
    const [rows] = await getPool().query(
        "SELECT * FROM game_sessions WHERE discord_id = ? AND game_type = 'blackjack' AND state = 'active' ORDER BY id DESC LIMIT 1",
        [String(discordId)]
    );
    if (!rows[0]) return null;
    const state = parseData(rows[0].game_data);
    return state ? { sessionId: rows[0].id, view: blackjack.publicView(state) } : null;
}

/**
 * Escrow the bet and deal. If a hand is already in progress it is returned
 * instead (with `resumed: true`) and no new bet is taken.
 */
async function startBlackjack(discordId, bet) {
    const amount = Number(bet);
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);

        const existing = await lockActiveSession(conn, user.discord_id, 'blackjack');
        if (existing && existing.game_data) {
            return { ...blackjackResult(existing, existing.game_data, user), resumed: true };
        }

        const problem = blackjack.validateBet(amount, Number(user.player_xp));
        if (problem) throw errors.validation(problem);

        const state = blackjack.deal(amount);
        const session = { id: await insertSession(conn, user.discord_id, 'blackjack', { bet: amount, data: state }) };
        await applyXP(conn, user, -amount, 'blackjack_bet', { referenceId: session.id, userUpdates: { last_game_at: new Date() } });

        const settlement = state.finished ? await settleBlackjack(conn, user, session, state) : null;
        return { ...blackjackResult(session, state, user, settlement), resumed: false };
    });
}

/** Apply hit / stand / double to the active hand. */
async function blackjackAction(discordId, action) {
    if (!['hit', 'stand', 'double'].includes(action)) throw errors.validation('Unknown action.');
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const session = await lockActiveSession(conn, user.discord_id, 'blackjack');
        if (!session || !session.game_data) throw errors.notFound('No active blackjack hand. Start a new game.');

        const before = session.game_data;
        if (action === 'double') {
            if (before.playerHand.length !== 2 || before.doubled) throw errors.validation('You can only double down on your first two cards.');
            if (Number(user.player_xp) < before.bet) throw errors.insufficientXP(before.bet, Number(user.player_xp));
            await applyXP(conn, user, -before.bet, 'blackjack_bet', { referenceId: session.id });
        }

        let state;
        try {
            state = blackjack.act(before, action);
        } catch (err) {
            throw errors.validation(err.message);
        }
        await conn.query('UPDATE game_sessions SET bet_amount = ?, game_data = ? WHERE id = ?', [state.bet, JSON.stringify(state), session.id]);

        const settlement = state.finished ? await settleBlackjack(conn, user, session, state) : null;
        return blackjackResult(session, state, user, settlement);
    });
}

// ─── Rock paper scissors ─────────────────────────────────────────────────────

async function playRps(discordId, choice) {
    const pick = String(choice || '').toLowerCase();
    if (!rps.isChoice(pick)) throw errors.validation('Choose rock, paper or scissors.');
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        enforceCooldown(user);

        const round = rps.play(pick);
        const sessionId = await insertSession(conn, user.discord_id, 'rps', { state: 'active', data: round });
        const xp = round.outcome === 'won' ? await rewardFreeGame(conn, user, REWARDS.RPS_WIN, sessionId) : null;
        const gained = xp ? xp.finalXP : 0;
        await finishSession(conn, sessionId, round.outcome, gained, round);
        await updateUserColumns(conn, user, { last_game_at: new Date() });
        const achievements = await unlockAchievements(conn, user, { gameWinXP: gained });

        return { sessionId, ...round, xpGained: gained, capped: Boolean(xp && xp.capped), bonusInfo: xp ? xp.bonusInfo : null, balance: Number(user.player_xp), achievements };
    });
}

// ─── Hangman ─────────────────────────────────────────────────────────────────

async function getActiveHangman(discordId) {
    const [rows] = await getPool().query(
        "SELECT * FROM game_sessions WHERE discord_id = ? AND game_type = 'hangman' AND state = 'active' ORDER BY id DESC LIMIT 1",
        [String(discordId)]
    );
    if (!rows[0]) return null;
    return { sessionId: rows[0].id, view: hangman.publicView(parseData(rows[0].game_data)) };
}

/** Start a new word (any unfinished hangman game is cancelled). */
async function startHangman(discordId) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        enforceCooldown(user);
        await conn.query(
            "UPDATE game_sessions SET state = 'cancelled', ended_at = CURRENT_TIMESTAMP WHERE discord_id = ? AND game_type = 'hangman' AND state = 'active'",
            [user.discord_id]
        );
        const state = hangman.start();
        const sessionId = await insertSession(conn, user.discord_id, 'hangman', { data: state });
        await updateUserColumns(conn, user, { last_game_at: new Date() });
        return { sessionId, view: hangman.publicView(state) };
    });
}

async function hangmanGuess(discordId, letter) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const session = await lockActiveSession(conn, user.discord_id, 'hangman');
        if (!session) throw errors.notFound('No active hangman game. Start a new one.');

        let state;
        try {
            state = hangman.guess(session.game_data, letter);
        } catch (err) {
            throw errors.validation(err.message);
        }

        if (!state.finished) {
            await conn.query('UPDATE game_sessions SET game_data = ? WHERE id = ?', [JSON.stringify(state), session.id]);
            return { sessionId: session.id, view: hangman.publicView(state), xpGained: 0, balance: Number(user.player_xp), achievements: [] };
        }

        const xp = state.outcome === 'won' ? await rewardFreeGame(conn, user, hangman.reward(state.lives), session.id) : null;
        const gained = xp ? xp.finalXP : 0;
        await finishSession(conn, session.id, state.outcome, gained, state);
        const achievements = await unlockAchievements(conn, user, { gameWinXP: gained });
        return {
            sessionId: session.id,
            view: hangman.publicView(state),
            xpGained: gained,
            capped: Boolean(xp && xp.capped),
            bonusInfo: xp ? xp.bonusInfo : null,
            balance: Number(user.player_xp),
            achievements
        };
    });
}

async function quitGame(discordId, gameType) {
    if (!['hangman', ...Object.keys(ARCADE_CONFIG)].includes(gameType)) {
        throw errors.validation('Only hangman and arcade games can be quit.');
    }
    const [res] = await getPool().query(
        "UPDATE game_sessions SET state = 'cancelled', ended_at = CURRENT_TIMESTAMP WHERE discord_id = ? AND game_type = ? AND state = 'active'",
        [String(discordId), gameType]
    );
    return res.affectedRows > 0;
}

// ─── Arcade (web) ────────────────────────────────────────────────────────────

/** Begin an arcade run; the returned sessionId must be sent with the score. */
async function startArcade(discordId, gameType) {
    if (!arcade.isArcadeGame(gameType)) throw errors.validation('Unknown arcade game.');
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        await conn.query(
            "UPDATE game_sessions SET state = 'cancelled', ended_at = CURRENT_TIMESTAMP WHERE discord_id = ? AND game_type = ? AND state = 'active'",
            [user.discord_id, gameType]
        );
        const sessionId = await insertSession(conn, user.discord_id, gameType, { data: { type: gameType } });
        return { sessionId };
    });
}

/** Submit the score for a run started with startArcade(). */
async function finishArcade(discordId, sessionId, score) {
    const id = Number(sessionId);
    if (!Number.isSafeInteger(id) || id <= 0) throw errors.validation('Invalid session.');
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const [[session]] = await conn.query(
            `SELECT *, TIMESTAMPDIFF(MICROSECOND, created_at, CURRENT_TIMESTAMP(3)) DIV 1000 AS elapsed_ms
             FROM game_sessions WHERE id = ? AND discord_id = ? AND state = 'active' FOR UPDATE`,
            [id, user.discord_id]
        );
        if (!session || !arcade.isArcadeGame(session.game_type)) throw errors.notFound('Arcade run not found or already submitted.');

        const scored = arcade.scoreRun(session.game_type, Number(score), Number(session.elapsed_ms));
        if (!scored.ok) {
            await conn.query("UPDATE game_sessions SET state = 'cancelled', ended_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
            throw errors.validation(scored.error);
        }

        const xp = await rewardFreeGame(conn, user, scored.baseXP, id);
        const gained = xp ? xp.finalXP : 0;
        await finishSession(conn, id, 'won', gained, { type: session.game_type, score: scored.score });
        const achievements = await unlockAchievements(conn, user, { gameWinXP: gained });
        return {
            sessionId: id,
            gameType: session.game_type,
            score: scored.score,
            xpGained: gained,
            capped: Boolean(xp && xp.capped),
            bonusInfo: xp ? xp.bonusInfo : null,
            balance: Number(user.player_xp),
            achievements
        };
    });
}

// ─── Housekeeping & history ──────────────────────────────────────────────────

/**
 * Expire sessions older than the TTL. Escrowed blackjack bets are refunded.
 * @returns {Promise<number>} sessions expired
 */
async function expireStaleSessions(ttlMinutes = LIMITS.GAME_SESSION_TTL_MINUTES) {
    const [stale] = await getPool().query(
        "SELECT id, discord_id FROM game_sessions WHERE state = 'active' AND created_at < (CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE)",
        [ttlMinutes]
    );
    let expired = 0;
    for (const row of stale) {
        await withTransaction(async (conn) => {
            const user = await lockUser(conn, row.discord_id);
            const [[session]] = await conn.query("SELECT * FROM game_sessions WHERE id = ? AND state = 'active' FOR UPDATE", [row.id]);
            if (!session) return;
            if (session.game_type === 'blackjack' && Number(session.bet_amount) > 0) {
                await applyXP(conn, user, Number(session.bet_amount), 'blackjack_refund', { lifetimeDelta: 0, referenceId: session.id });
            }
            await conn.query(
                "UPDATE game_sessions SET state = 'expired', payout = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?",
                [session.game_type === 'blackjack' ? session.bet_amount : 0, session.id]
            );
            expired++;
        });
    }
    return expired;
}

async function getGameHistory(discordId, limit = 20) {
    const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const [rows] = await getPool().query(
        `SELECT id, game_type, bet_amount, payout, state, created_at, ended_at
         FROM game_sessions WHERE discord_id = ? AND state <> 'active'
         ORDER BY id DESC LIMIT ${n}`,
        [String(discordId)]
    );
    return rows.map((r) => ({
        ...r,
        bet_amount: Number(r.bet_amount),
        payout: Number(r.payout),
        net: ['cancelled'].includes(r.state) ? 0 : Number(r.payout) - Number(r.bet_amount)
    }));
}

module.exports = {
    getActiveBlackjack,
    startBlackjack,
    blackjackAction,
    playRps,
    getActiveHangman,
    startHangman,
    hangmanGuess,
    quitGame,
    startArcade,
    finishArcade,
    expireStaleSessions,
    getGameHistory
};
