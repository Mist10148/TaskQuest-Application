/** User records, settings, stats and leaderboard. */

'use strict';

const { getPool, withTransaction } = require('./pool');

const SETTINGS = ['gamification_enabled', 'automation_enabled', 'auto_delete_old_lists', 'ai_enabled'];

const run = async (conn, sql, params = []) => (await (conn || getPool()).query(sql, params))[0];

async function getUser(discordId, conn) {
    const rows = await run(conn, 'SELECT * FROM users WHERE discord_id = ?', [String(discordId)]);
    return rows[0] || null;
}

/**
 * Create the user row if needed and refresh the cached Discord profile.
 * @param {string} discordId
 * @param {{ username?: string, avatar?: string }} [profile]
 */
async function ensureUser(discordId, profile, conn) {
    const id = String(discordId);
    if (profile) {
        await run(
            conn,
            `INSERT INTO users (discord_id, discord_username, discord_avatar) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE discord_username = VALUES(discord_username), discord_avatar = VALUES(discord_avatar)`,
            [id, profile.username ? String(profile.username).slice(0, 100) : null, profile.avatar ? String(profile.avatar).slice(0, 100) : null]
        );
    } else {
        await run(conn, 'INSERT IGNORE INTO users (discord_id) VALUES (?)', [id]);
    }
    return getUser(id, conn);
}

/** Lock (and create if missing) a user row inside a transaction. */
async function lockUser(conn, discordId) {
    const id = String(discordId);
    await conn.query('INSERT IGNORE INTO users (discord_id) VALUES (?)', [id]);
    const [rows] = await conn.query('SELECT * FROM users WHERE discord_id = ? FOR UPDATE', [id]);
    return rows[0];
}

/** Update boolean settings. Unknown keys are ignored. Returns the user. */
async function updateSettings(discordId, settings) {
    const sets = [];
    const values = [];
    for (const key of SETTINGS) {
        if (settings[key] !== undefined) {
            sets.push(`${key} = ?`);
            values.push(settings[key] ? 1 : 0);
        }
    }
    await ensureUser(discordId);
    if (sets.length) await run(null, `UPDATE users SET ${sets.join(', ')} WHERE discord_id = ?`, [...values, String(discordId)]);
    return getUser(discordId);
}

/** Flip one boolean setting and return its new value. */
async function toggleSetting(discordId, key) {
    if (!SETTINGS.includes(key)) throw new Error(`Unknown setting ${key}`);
    await ensureUser(discordId);
    await run(null, `UPDATE users SET ${key} = NOT ${key} WHERE discord_id = ?`, [String(discordId)]);
    return Boolean((await getUser(discordId))[key]);
}

async function getUserSkills(discordId, conn) {
    return run(conn, 'SELECT skill_id, skill_level, unlocked_at FROM user_skills WHERE discord_id = ? ORDER BY unlocked_at', [String(discordId)]);
}

async function getAchievements(discordId, conn) {
    return run(conn, 'SELECT achievement_key, unlocked_at FROM achievements WHERE discord_id = ? ORDER BY unlocked_at DESC', [String(discordId)]);
}

async function getGameCounts(discordId, conn) {
    const [row] = await run(
        conn,
        `SELECT COUNT(*) AS played,
                COALESCE(SUM(state IN ('won','blackjack')), 0) AS won,
                COALESCE(SUM(state = 'lost'), 0) AS lost,
                COALESCE(SUM(state = 'push'), 0) AS draws
         FROM game_sessions WHERE discord_id = ? AND state IN ('won','blackjack','lost','push')`,
        [String(discordId)]
    );
    return { played: Number(row.played), won: Number(row.won), lost: Number(row.lost), draws: Number(row.draws) };
}

/** Profile snapshot used by /profile and GET /api/user. */
async function getUserStats(discordId) {
    const id = String(discordId);
    const user = await getUser(id);
    if (!user) return null;
    const [[lists], [items], [achs], games] = await Promise.all([
        run(null, 'SELECT COUNT(*) AS total FROM lists WHERE discord_id = ?', [id]),
        run(
            null,
            `SELECT COUNT(i.id) AS total, COALESCE(SUM(i.completed), 0) AS completed
             FROM items i JOIN lists l ON l.id = i.list_id WHERE l.discord_id = ?`,
            [id]
        ),
        run(null, 'SELECT COUNT(*) AS count FROM achievements WHERE discord_id = ?', [id]),
        getGameCounts(id)
    ]);
    return {
        user,
        lists: { total: Number(lists.total) },
        items: { total: Number(items.total), completed: Number(items.completed) },
        achievements: Number(achs.count),
        games
    };
}

/**
 * Top players by current XP balance, in a single query.
 * Includes discord_id; callers decide what to expose.
 */
async function getLeaderboard(limit = 10) {
    const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const rows = await run(
        null,
        `SELECT u.discord_id, u.discord_username, u.discord_avatar, u.player_xp, u.lifetime_xp, u.player_level,
                u.player_class, u.streak_count, u.total_items_completed,
                (SELECT COUNT(*) FROM game_sessions g
                  WHERE g.discord_id = u.discord_id AND g.state IN ('won','blackjack','lost','push')) AS games_played
         FROM users u
         WHERE u.gamification_enabled = TRUE
         ORDER BY u.player_xp DESC, u.discord_id
         LIMIT ${n}`
    );
    return rows.map((r, i) => ({ rank: i + 1, ...r, games_played: Number(r.games_played) }));
}

/** 1-based leaderboard rank for a user (by current XP), or null. */
async function getRank(discordId) {
    const user = await getUser(discordId);
    if (!user || !user.gamification_enabled) return null;
    const [row] = await run(
        null,
        'SELECT COUNT(*) + 1 AS user_rank FROM users WHERE gamification_enabled = TRUE AND player_xp > ?',
        [user.player_xp]
    );
    return Number(row.user_rank);
}

/** Delete all of a user's progress and content (lists, items, games, XP). */
async function resetProgress(discordId) {
    const id = String(discordId);
    return withTransaction(async (conn) => {
        await lockUser(conn, id);
        for (const table of ['lists', 'achievements', 'user_skills', 'game_sessions', 'xp_transactions']) {
            await conn.query(`DELETE FROM ${table} WHERE discord_id = ?`, [id]);
        }
        await conn.query(
            `UPDATE users SET player_xp = 0, lifetime_xp = 0, player_level = 1, player_class = 'DEFAULT',
                streak_count = 0, last_active_day = NULL, last_daily_claim = NULL, last_game_at = NULL,
                total_lists_created = 0, total_items_added = 0, total_items_completed = 0,
                owns_hero = FALSE, owns_gambler = FALSE, owns_assassin = FALSE, owns_wizard = FALSE,
                owns_archer = FALSE, owns_tank = FALSE,
                assassin_streak = 0, assassin_stacks = 0, wizard_counter = 0, archer_streak = 0, tank_stacks = 0
             WHERE discord_id = ?`,
            [id]
        );
        return true;
    });
}

async function getXPHistory(discordId, limit = 20) {
    const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    return run(
        null,
        `SELECT id, amount, source, balance_before, balance_after, reference_id, created_at
         FROM xp_transactions WHERE discord_id = ? ORDER BY id DESC LIMIT ${n}`,
        [String(discordId)]
    );
}

module.exports = {
    SETTINGS,
    getUser,
    ensureUser,
    lockUser,
    updateSettings,
    toggleSetting,
    getUserSkills,
    getAchievements,
    getGameCounts,
    getUserStats,
    getLeaderboard,
    getRank,
    resetProgress,
    getXPHistory
};
