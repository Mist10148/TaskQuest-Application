/**
 * Keeps the cached Discord profile (display name, avatar and the unique Discord username people are invited by) fresh for anyone
 * who uses a slash command, so a person who only ever used the bot can still be invited by username from the web app.
 * At most one write per person per hour, in memory (a restart just writes once more), and never in the way of the command.
 */

'use strict';

const REFRESH_MS = 60 * 60 * 1000;
const MAX_TRACKED = 5000;

const seen = new Map();

/**
 * @param {{ users: { ensureUser: Function } }} db
 * @param {{ id: string, username?: string, displayName?: string, globalName?: string|null, avatar?: string|null, bot?: boolean }} user a discord.js User
 * @returns {Promise<boolean>} whether a write was attempted
 */
async function refreshProfile(db, user, now = Date.now()) {
    if (!user || user.bot || !user.username) return false;
    const last = seen.get(user.id);
    if (last !== undefined && now - last < REFRESH_MS) return false;
    if (seen.size >= MAX_TRACKED) seen.clear();
    seen.set(user.id, now);
    try {
        await db.users.ensureUser(user.id, { username: user.globalName || user.displayName || user.username, handle: user.username, avatar: user.avatar || undefined });
    } catch {
        seen.delete(user.id); // try again next time
        return false;
    }
    return true;
}

module.exports = { refreshProfile, REFRESH_MS };
