/**
 * Cosmetics: titles, avatar frames and profile accents bought with XP (see COSMETICS in constants.js).
 * Buying is atomic like a class purchase: the user row is locked, the XP leaves through applyXP
 * (source cosmetic_purchase, a spend source) and ownership is granted in the same transaction.
 */

'use strict';

const { getPool, withTransaction } = require('./pool');
const { lockUser, getUser } = require('./users');
const { applyXP, unlockAchievements, requireGamification } = require('./progression');
const { errors } = require('../errors');
const { COSMETICS, COSMETIC_KINDS, COSMETIC_COLUMNS } = require('../constants');
const { isCosmeticId, requirementText, meetsRequirement, describeEquipped } = require('../cosmetics');

async function ownedIds(conn, discordId) {
    const [rows] = await conn.query('SELECT cosmetic_id FROM user_cosmetics WHERE discord_id = ?', [discordId]);
    return new Set(rows.map((r) => r.cosmetic_id).filter(isCosmeticId));
}

async function achievementKeys(conn, discordId) {
    const [rows] = await conn.query('SELECT achievement_key FROM achievements WHERE discord_id = ?', [discordId]);
    return new Set(rows.map((r) => r.achievement_key));
}

/** Everything in the shop for a user, with owned / equipped / affordable / locked state. */
async function listCosmetics(discordId) {
    const id = String(discordId);
    const conn = getPool();
    const user = (await getUser(id)) || {};
    const [owned, keys] = await Promise.all([ownedIds(conn, id), achievementKeys(conn, id)]);
    const balance = Number(user.player_xp) || 0;
    const items = Object.entries(COSMETICS).map(([cid, c]) => {
        const isOwned = owned.has(cid);
        const unlocked = meetsRequirement(c.requires, user, keys);
        return {
            id: cid,
            kind: c.kind,
            name: c.name,
            cost: c.cost,
            ...(c.color ? { color: c.color } : {}),
            ...(c.colorDark ? { colorDark: c.colorDark } : {}),
            owned: isOwned,
            equipped: user[COSMETIC_COLUMNS[c.kind]] === cid,
            locked: !isOwned && !unlocked,
            lockedReason: !isOwned && !unlocked ? requirementText(c.requires) : null,
            affordable: !isOwned && unlocked && balance >= c.cost
        };
    });
    return { balance, items, equipped: describeEquipped(user), gamificationEnabled: Boolean(user.gamification_enabled) };
}

/** Buy a cosmetic. A second click (or a concurrent one) finds it owned and fails with CONFLICT, spending nothing. */
async function buyCosmetic(discordId, cosmeticId) {
    if (!isCosmeticId(cosmeticId)) throw errors.notFound('That item is not in the shop.');
    const c = COSMETICS[cosmeticId];
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        if ((await ownedIds(conn, user.discord_id)).has(cosmeticId)) throw errors.conflict(`You already own ${c.name}.`);
        if (!meetsRequirement(c.requires, user, await achievementKeys(conn, user.discord_id))) throw errors.forbidden(`${requirementText(c.requires)} to unlock ${c.name}.`);
        if (Number(user.player_xp) < c.cost) throw errors.insufficientXP(c.cost, Number(user.player_xp));
        const tx = await applyXP(conn, user, -c.cost, 'cosmetic_purchase');
        await conn.query('INSERT INTO user_cosmetics (discord_id, cosmetic_id) VALUES (?, ?)', [user.discord_id, cosmeticId]);
        const achievements = await unlockAchievements(conn, user);
        return { id: cosmeticId, kind: c.kind, name: c.name, cost: c.cost, balance: tx.balanceAfter, achievements };
    });
}

/** Equip an owned cosmetic of `kind`, or unequip that kind with `cosmeticId = null`. */
async function equipCosmetic(discordId, kind, cosmeticId = null) {
    if (!COSMETIC_KINDS.includes(kind)) throw errors.validation('Unknown cosmetic kind.');
    const column = COSMETIC_COLUMNS[kind];
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        if (cosmeticId !== null) {
            if (!isCosmeticId(cosmeticId) || COSMETICS[cosmeticId].kind !== kind) throw errors.notFound('That item is not in the shop.');
            if (!(await ownedIds(conn, user.discord_id)).has(cosmeticId)) throw errors.forbidden(`You don't own ${COSMETICS[cosmeticId].name} yet.`);
        }
        await conn.query(`UPDATE users SET ${column} = ? WHERE discord_id = ?`, [cosmeticId, user.discord_id]);
        user[column] = cosmeticId;
        return { kind, id: cosmeticId, equipped: describeEquipped(user) };
    });
}

module.exports = { listCosmetics, buyCosmetic, equipCosmetic };
