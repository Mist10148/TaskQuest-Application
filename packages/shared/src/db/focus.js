/**
 * Focus sessions: a server-timed work timer that pays XP for real elapsed time. The client only says
 * "start" and "finish"; the duration credited is what the server measured, never what the client claims.
 * One active session per user (starting another cancels it); every XP change goes through awardFlat.
 */

'use strict';

const { withTransaction } = require('./pool');
const { lockUser } = require('./users');
const { awardFlat, unlockAchievements, startOfUtcDay, sumToday } = require('./progression');
const { errors } = require('../errors');
const { REWARDS, LIMITS } = require('../constants');

const MINUTE = 60e3;

function validateMinutes(minutes) {
    const n = Number(minutes);
    if (!Number.isInteger(n) || n < LIMITS.FOCUS_MIN_MINUTES || n > LIMITS.FOCUS_MAX_MINUTES) {
        throw errors.validation(`Choose a focus length between ${LIMITS.FOCUS_MIN_MINUTES} and ${LIMITS.FOCUS_MAX_MINUTES} minutes.`);
    }
    return n;
}

/** Sessions that paid today (the daily session cap counts finished ones only, so a cancelled start costs nothing). */
async function finishedToday(conn, discordId) {
    const [[row]] = await conn.query(
        "SELECT COUNT(*) AS n FROM focus_sessions WHERE discord_id = ? AND state = 'finished' AND minutes_credited > 0 AND finished_at >= ?",
        [discordId, startOfUtcDay()]
    );
    return Number(row.n);
}

const view = (s) => ({
    sessionId: Number(s.id),
    startedAt: new Date(s.started_at).toISOString(),
    minutes: Number(s.minutes_planned),
    endsAt: new Date(new Date(s.started_at).getTime() + Number(s.minutes_planned) * MINUTE).toISOString()
});

/** Mark old active sessions as expired, so they are not offered again. */
async function expireStale(conn, discordId, now) {
    await conn.query("UPDATE focus_sessions SET state = 'expired', finished_at = ? WHERE discord_id = ? AND state = 'active' AND started_at < ?", [
        now,
        discordId,
        new Date(now.getTime() - LIMITS.FOCUS_EXPIRE_MINUTES * MINUTE)
    ]);
}

/** The active session (if any) and today's allowance. */
async function getFocusStatus(discordId, now = new Date()) {
    const id = String(discordId);
    return withTransaction(async (conn) => {
        await expireStale(conn, id, now);
        const [[active]] = await conn.query("SELECT * FROM focus_sessions WHERE discord_id = ? AND state = 'active' ORDER BY id DESC LIMIT 1", [id]);
        const sessions = await finishedToday(conn, id);
        const xp = await sumToday(conn, id, 'focus_session');
        return {
            active: active ? view(active) : null,
            today: {
                sessions,
                xp,
                remainingSessions: Math.max(0, LIMITS.FOCUS_SESSIONS_PER_DAY - sessions),
                remainingXP: Math.max(0, LIMITS.FOCUS_XP_PER_DAY - xp)
            }
        };
    });
}

/** Start a session, cancelling any unfinished one. */
async function startFocus(discordId, minutes, now = new Date()) {
    const planned = validateMinutes(minutes);
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        if ((await finishedToday(conn, user.discord_id)) >= LIMITS.FOCUS_SESSIONS_PER_DAY) {
            throw errors.conflict(`You have already finished ${LIMITS.FOCUS_SESSIONS_PER_DAY} focus sessions today.`);
        }
        await conn.query("UPDATE focus_sessions SET state = 'cancelled', finished_at = ? WHERE discord_id = ? AND state = 'active'", [now, user.discord_id]);
        const [res] = await conn.query('INSERT INTO focus_sessions (discord_id, started_at, minutes_planned) VALUES (?, ?, ?)', [user.discord_id, now, planned]);
        const [[row]] = await conn.query('SELECT * FROM focus_sessions WHERE id = ?', [res.insertId]);
        return view(row);
    });
}

/**
 * Finish a session. Credits min(planned, elapsed) minutes, and only when at least FOCUS_MIN_MINUTES really
 * passed; pays floor(minutes * 0.6) XP under the daily XP cap. Finishing too early cancels the session and
 * finishing after the expiry window credits nothing. Each session settles once.
 * @returns {Promise<{ sessionId, state: 'finished'|'cancelled'|'expired', minutesCredited, xp, capped, balance, level, leveledUp, achievements }>}
 */
async function finishFocus(discordId, sessionId, now = new Date()) {
    const sid = Number(sessionId);
    if (!Number.isSafeInteger(sid) || sid <= 0) throw errors.validation('Unknown focus session.');
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const [[session]] = await conn.query('SELECT * FROM focus_sessions WHERE id = ? AND discord_id = ? FOR UPDATE', [sid, user.discord_id]);
        if (!session) throw errors.notFound('Focus session not found.');
        if (session.state !== 'active') throw errors.conflict('That focus session is already over.');

        const elapsed = Math.floor((now.getTime() - new Date(session.started_at).getTime()) / MINUTE);
        const previousLevel = Number(user.player_level);
        const settle = async (state, credited, xp, { capped = false, achievements = [] } = {}) => {
            await conn.query('UPDATE focus_sessions SET state = ?, finished_at = ?, minutes_credited = ?, xp = ? WHERE id = ?', [state, now, credited, xp, sid]);
            return {
                sessionId: sid,
                state,
                minutesCredited: credited,
                xp,
                capped,
                balance: Number(user.player_xp),
                level: Number(user.player_level),
                leveledUp: Number(user.player_level) > previousLevel,
                achievements
            };
        };

        if (elapsed > LIMITS.FOCUS_EXPIRE_MINUTES) return settle('expired', 0, 0);
        if (elapsed < LIMITS.FOCUS_MIN_MINUTES) return settle('cancelled', 0, 0);

        const credited = Math.min(Number(session.minutes_planned), elapsed);
        const wanted = Math.floor(credited * REWARDS.FOCUS_XP_PER_MINUTE);
        let paid = null;
        let capped = true;
        if ((await finishedToday(conn, user.discord_id)) < LIMITS.FOCUS_SESSIONS_PER_DAY) {
            paid = await awardFlat(conn, user, 'focus_session', wanted, { dailyCap: LIMITS.FOCUS_XP_PER_DAY, referenceId: sid });
            capped = !paid || paid.xp < wanted;
        }
        const result = await settle('finished', credited, paid ? paid.xp : 0, { capped });
        result.achievements = await unlockAchievements(conn, user);
        result.balance = Number(user.player_xp);
        result.level = Number(user.player_level);
        result.leveledUp = result.level > previousLevel;
        return result;
    });
}

module.exports = { startFocus, finishFocus, getFocusStatus };
