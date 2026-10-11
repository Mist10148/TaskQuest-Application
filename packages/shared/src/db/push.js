/** Web push subscriptions: one row per browser a user enabled notifications in (max PUSH.MAX_SUBSCRIPTIONS each). */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser } = require('./users');
const { errors } = require('../errors');
const { PUSH, validateSubscription, endpointHash } = require('../push');

/**
 * Save a browser's subscription for a user. The same endpoint always maps to one row: subscribing again
 * refreshes its keys, and an endpoint that moves to another account (a shared browser) moves with it.
 * @returns {Promise<{ count: number }>} how many subscriptions the user has now
 */
async function addSubscription(discordId, rawSubscription) {
    const sub = validateSubscription(rawSubscription);
    const hash = endpointHash(sub.endpoint);
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        const [[existing]] = await conn.query('SELECT id, discord_id FROM push_subscriptions WHERE endpoint_hash = ? FOR UPDATE', [hash]);
        if (existing && existing.discord_id === user.discord_id) {
            await conn.query('UPDATE push_subscriptions SET p256dh = ?, auth = ? WHERE id = ?', [sub.p256dh, sub.auth, existing.id]);
        } else {
            const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE discord_id = ?', [user.discord_id]);
            if (Number(n) >= PUSH.MAX_SUBSCRIPTIONS) throw errors.validation(`You can have at most ${PUSH.MAX_SUBSCRIPTIONS} subscribed browsers. Turn it off on one first.`);
            if (existing) await conn.query('DELETE FROM push_subscriptions WHERE id = ?', [existing.id]);
            await conn.query('INSERT INTO push_subscriptions (discord_id, endpoint, endpoint_hash, p256dh, auth) VALUES (?, ?, ?, ?, ?)', [user.discord_id, sub.endpoint, hash, sub.p256dh, sub.auth]);
        }
        const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM push_subscriptions WHERE discord_id = ?', [user.discord_id]);
        return { count: Number(total) };
    });
}

/** Forget one browser of this user. @returns {Promise<boolean>} whether it existed */
async function removeSubscription(discordId, endpoint) {
    if (typeof endpoint !== 'string' || !endpoint || endpoint.length > PUSH.MAX_ENDPOINT_LENGTH) throw errors.validation('Invalid push subscription endpoint.');
    const [res] = await getPool().query('DELETE FROM push_subscriptions WHERE discord_id = ? AND endpoint_hash = ?', [String(discordId), endpointHash(endpoint)]);
    return res.affectedRows > 0;
}

/** The user's subscriptions (with the keys: server-side sending only, never sent to browsers). */
async function listSubscriptions(discordId) {
    const [rows] = await getPool().query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE discord_id = ? ORDER BY id', [String(discordId)]);
    return rows;
}

async function countSubscriptions(discordId) {
    const [[row]] = await getPool().query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE discord_id = ?', [String(discordId)]);
    return Number(row.n);
}

/** Drop a subscription the push service reported gone (404 / 410). */
async function deleteSubscriptionById(id) {
    await getPool().query('DELETE FROM push_subscriptions WHERE id = ?', [id]);
}

async function touchSubscription(id) {
    await getPool().query('UPDATE push_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

module.exports = { addSubscription, removeSubscription, listSubscriptions, countSubscriptions, deleteSubscriptionById, touchSubscription };
