/** User records, settings, stats and leaderboard. */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { LEADERBOARDS, WEEKLY_XP_SOURCES, DAILY } = require('../constants');
const { errors } = require('../errors');
const { isValidTimeZone, todayInZone } = require('../dates');
const { questPeriod } = require('../quests');

const SETTINGS = ['gamification_enabled', 'automation_enabled', 'auto_delete_old_lists', 'ai_enabled', 'weekly_digest'];

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
    if (settings.timezone !== undefined) {
        if (settings.timezone !== null && !isValidTimeZone(settings.timezone)) throw errors.validation('Unknown time zone. Use a name like Europe/Paris or Asia/Manila.');
        sets.push('timezone = ?');
        values.push(settings.timezone);
    }
    if (settings.reminder_hour !== undefined) {
        const hour = settings.reminder_hour;
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw errors.validation('Reminder hour must be a whole number from 0 to 23.');
        sets.push('reminder_hour = ?');
        values.push(hour);
    }
    await ensureUser(discordId);
    if (sets.length) await run(null, `UPDATE users SET ${sets.join(', ')} WHERE discord_id = ?`, [...values, String(discordId)]);
    return getUser(discordId);
}

const AI_CHAT_FORMATS = ['text', 'embed'];

/** How the bot formats conversation replies for this user ('text' or 'embed'). */
async function setAiChatFormat(discordId, format) {
    if (!AI_CHAT_FORMATS.includes(format)) throw new Error(`Unknown AI chat format ${format}`);
    await ensureUser(discordId);
    await run(null, 'UPDATE users SET ai_chat_format = ? WHERE discord_id = ?', [format, String(discordId)]);
    return format;
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
    // The calendar feed token is a secret: it never travels with the profile. Settings reads it
    // from GET /api/user/calendar-token, which only returns it when asked.
    const { calendar_token: calendarToken, ...safeUser } = user;
    return {
        user: { ...safeUser, has_calendar_token: Boolean(calendarToken) },
        lists: { total: Number(lists.total) },
        items: { total: Number(items.total), completed: Number(items.completed) },
        achievements: Number(achs.count),
        games
    };
}

/**
 * SQL for a leaderboard score, for the user row aliased `u`.
 *   lifetime  total XP ever earned (never drops when XP is spent)
 *   xp        current spendable balance
 *   streak    daily streak
 *   weekly    XP earned since Monday 00:00 UTC (earning sources only)
 */
function scoreSql(by, now = new Date()) {
    switch (by) {
        case 'xp':
            return { sql: 'u.player_xp', params: [] };
        case 'streak': {
            // A streak only counts while it is still alive: a stale one that nobody has
            // broken yet (the reset happens on the next claim) scores 0. Streak shield
            // gets the longer window; a bought freeze or the Unstoppable skill saves it outright.
            const at = now.getTime();
            return {
                sql: `(CASE
                    WHEN u.last_daily_claim IS NULL THEN 0
                    WHEN EXISTS (SELECT 1 FROM user_skills k WHERE k.discord_id = u.discord_id AND k.skill_id = 'tank_unstoppable') THEN u.streak_count
                    WHEN u.streak_freezes > 0 AND u.streak_count > 1 THEN u.streak_count
                    WHEN u.last_daily_claim >= (CASE
                        WHEN EXISTS (SELECT 1 FROM user_skills k WHERE k.discord_id = u.discord_id AND k.skill_id = 'default_streak_shield') THEN ? ELSE ? END)
                        THEN u.streak_count
                    ELSE 0 END)`,
                params: [new Date(at - DAILY.SHIELDED_STREAK_WINDOW_MS), new Date(at - DAILY.STREAK_WINDOW_MS)]
            };
        }
        case 'weekly': {
            const monday = questPeriod('weekly', now).startsAt;
            const marks = WEEKLY_XP_SOURCES.map(() => '?').join(', ');
            return {
                sql: `(SELECT COALESCE(SUM(t.amount), 0) FROM xp_transactions t
                       WHERE t.discord_id = u.discord_id AND t.amount > 0 AND t.created_at >= ? AND t.source IN (${marks}))`,
                params: [monday, ...WEEKLY_XP_SOURCES]
            };
        }
        case 'lifetime':
        default:
            return { sql: 'u.lifetime_xp', params: [] };
    }
}

/**
 * Top players for one leaderboard tab, optionally limited to one class.
 * Includes discord_id; callers decide what to expose. `score` is the tab's value.
 * @param {number} limit
 * @param {{ by?: 'lifetime'|'xp'|'streak'|'weekly', playerClass?: string }} [opts]
 */
async function getLeaderboard(limit = 10, { by = 'lifetime', playerClass, now } = {}) {
    const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const board = LEADERBOARDS.includes(by) ? by : 'lifetime';
    const score = scoreSql(board, now);
    const where = ['u.gamification_enabled = TRUE'];
    const params = [...score.params];
    if (playerClass) {
        where.push('u.player_class = ?');
        params.push(String(playerClass).toUpperCase());
    }
    const rows = await run(
        null,
        `SELECT u.discord_id, u.discord_username, u.discord_avatar, u.player_xp, u.lifetime_xp, u.player_level,
                u.player_class, u.streak_count, u.total_items_completed,
                ${score.sql} AS score,
                (SELECT COUNT(*) FROM game_sessions g
                  WHERE g.discord_id = u.discord_id AND g.state IN ('won','blackjack','lost','push')) AS games_played
         FROM users u
         WHERE ${where.join(' AND ')}
         ${board === 'weekly' || board === 'streak' ? 'HAVING score > 0' : ''}
         ORDER BY score DESC, u.lifetime_xp DESC, u.discord_id
         LIMIT ${n}`,
        params
    );
    return rows.map((r, i) => ({
        rank: i + 1,
        ...r,
        // On the streak tab the live streak is the score (a stale one is already filtered out).
        ...(board === 'streak' ? { streak_count: Number(r.score) } : {}),
        score: Number(r.score),
        games_played: Number(r.games_played)
    }));
}

/**
 * 1-based leaderboard rank for a user on one tab, or null (XP off, or no score on weekly/streak).
 * With `playerClass` the rank is within that class's board, matching getLeaderboard; a user who is
 * not that class is not on it (null).
 */
async function getRank(discordId, by = 'lifetime', { now, playerClass } = {}) {
    const user = await getUser(discordId);
    if (!user || !user.gamification_enabled) return null;
    const cls = playerClass ? String(playerClass).toUpperCase() : null;
    if (cls && user.player_class !== cls) return null;
    const mine = scoreSql(by, now);
    const [own] = await run(null, `SELECT ${mine.sql} AS score FROM users u WHERE u.discord_id = ?`, [...mine.params, String(discordId)]);
    const score = Number(own.score);
    if ((by === 'weekly' || by === 'streak') && score <= 0) return null;
    const other = scoreSql(by, now);
    const [row] = await run(
        null,
        `SELECT COUNT(*) + 1 AS user_rank FROM users u
         WHERE u.gamification_enabled = TRUE ${cls ? 'AND u.player_class = ?' : ''} AND ${other.sql} > ?`,
        [...(cls ? [cls] : []), ...other.params, score]
    );
    return Number(row.user_rank);
}

// ─── Weekly digest ───────────────────────────────────────────────────────────

/** Users who opted in to the weekly digest and haven't had one in the last 6 days. */
async function getDigestCandidates(now = new Date()) {
    return run(
        null,
        `SELECT discord_id, timezone, reminder_hour, last_digest_at, ai_enabled FROM users
         WHERE weekly_digest = TRUE AND (last_digest_at IS NULL OR last_digest_at < ?)`,
        [new Date(now.getTime() - 6 * 86400e3)]
    );
}

async function markDigestSent(discordId, now = new Date()) {
    await run(null, 'UPDATE users SET last_digest_at = ? WHERE discord_id = ?', [now, String(discordId)]);
}

/**
 * Atomically claim this week's digest: true for exactly one caller, so two overlapping
 * runs cannot both send it. Pair with releaseDigest() if the send fails and should be retried.
 */
async function claimDigest(discordId, now = new Date()) {
    const [res] = await getPool().query(
        'UPDATE users SET last_digest_at = ? WHERE discord_id = ? AND (last_digest_at IS NULL OR last_digest_at < ?)',
        [now, String(discordId), new Date(now.getTime() - 6 * 86400e3)]
    );
    return res.affectedRows > 0;
}

/** Undo a claimDigest() after a temporary send failure (only if nobody claimed again since). */
async function releaseDigest(discordId, claimedAt, previous = null) {
    await run(null, 'UPDATE users SET last_digest_at = ? WHERE discord_id = ? AND last_digest_at = ?', [previous, String(discordId), claimedAt]);
}

/** Numbers for the digest: the 7 days up to `now`, plus what is open right now. */
async function getWeeklyStats(discordId, now = new Date()) {
    const id = String(discordId);
    const since = new Date(now.getTime() - 7 * 86400e3);
    const marks = WEEKLY_XP_SOURCES.map(() => '?').join(', ');
    const user = await getUser(id);
    const today = todayInZone(user?.timezone, now); // "overdue" is the user's own calendar day
    const [[done], [xp], [open]] = await Promise.all([
        run(
            null,
            `SELECT COUNT(*) AS n FROM items i JOIN lists l ON l.id = i.list_id
             WHERE l.discord_id = ? AND i.completed = 1 AND i.completed_at >= ?`,
            [id, since]
        ),
        run(
            null,
            `SELECT COALESCE(SUM(amount), 0) AS n FROM xp_transactions
             WHERE discord_id = ? AND amount > 0 AND created_at >= ? AND source IN (${marks})`,
            [id, since, ...WEEKLY_XP_SOURCES]
        ),
        run(
            null,
            `SELECT COUNT(DISTINCT l.id) AS lists_open,
                    COUNT(DISTINCT CASE WHEN l.deadline < ? THEN l.id END) AS lists_overdue
             FROM lists l JOIN items i ON i.list_id = l.id AND i.completed = 0
             WHERE l.discord_id = ?`,
            [today, id]
        )
    ]);
    return {
        completed: Number(done.n),
        xpEarned: Number(xp.n),
        listsOpen: Number(open.lists_open),
        listsOverdue: Number(open.lists_overdue),
        streak: user ? Number(user.streak_count) : 0,
        level: user ? Number(user.player_level) : 1
    };
}

/** Delete all of a user's progress and content (lists, items, games, XP). */
async function resetProgress(discordId) {
    const id = String(discordId);
    return withTransaction(async (conn) => {
        await lockUser(conn, id);
        for (const table of ['lists', 'achievements', 'user_skills', 'game_sessions', 'xp_transactions', 'quest_claims']) {
            await conn.query(`DELETE FROM ${table} WHERE discord_id = ?`, [id]);
        }
        await conn.query(
            `UPDATE users SET player_xp = 0, lifetime_xp = 0, player_level = 1, player_class = 'DEFAULT',
                streak_count = 0, last_active_day = NULL, last_daily_claim = NULL, last_game_at = NULL,
                total_lists_created = 0, total_items_added = 0, total_items_completed = 0,
                owns_hero = FALSE, owns_gambler = FALSE, owns_assassin = FALSE, owns_wizard = FALSE,
                owns_archer = FALSE, owns_tank = FALSE, owns_monk = FALSE, monk_rhythm = 0, monk_day = NULL, owns_artisan = FALSE, artisan_progress = 0, xp_spent = 0, streak_freezes = 0,
                assassin_streak = 0, assassin_stacks = 0, assassin_last_at = NULL, assassin_bleed = 0, gambler_streak = 0, wizard_counter = 0, archer_streak = 0, tank_stacks = 0
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
    AI_CHAT_FORMATS,
    setAiChatFormat,
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
    getXPHistory,
    getDigestCandidates,
    markDigestSent,
    claimDigest,
    releaseDigest,
    getWeeklyStats
};
