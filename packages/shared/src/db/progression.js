/**
 * Every XP change goes through applyXP() on a row locked with
 * SELECT ... FOR UPDATE, inside a transaction, and is logged to
 * xp_transactions. This removes the lost-update and double-spend races the
 * bot and web previously had when both wrote absolute XP values.
 */

'use strict';

const { withTransaction } = require('./pool');
const { lockUser, getUserSkills, getGameCounts } = require('./users');
const { errors } = require('../errors');
const {
    CLASSES,
    PURCHASABLE_CLASS_KEYS,
    classOwnershipColumn,
    findSkill,
    LIMITS
} = require('../constants');
const { levelFromXP, calculateFinalXP, calculateDailyReward } = require('../xp');
const { evaluateAchievements } = require('../achievements');

/** Columns applyXP() may update alongside the balance. */
const UPDATABLE_COLUMNS = new Set([
    'assassin_streak', 'assassin_stacks', 'wizard_counter', 'archer_streak', 'tank_stacks',
    'player_class', 'streak_count', 'last_daily_claim', 'last_active_day', 'last_game_at',
    'owns_hero', 'owns_gambler', 'owns_assassin', 'owns_wizard', 'owns_archer', 'owns_tank'
]);

const CLASS_COUNTER_RESET = { assassin_streak: 0, assassin_stacks: 0, wizard_counter: 0, archer_streak: 0, tank_stacks: 0 };

/** Persist column updates on a locked user and mirror them on the object. */
async function updateUserColumns(conn, user, updates) {
    const keys = Object.keys(updates || {});
    if (!keys.length) return;
    for (const k of keys) if (!UPDATABLE_COLUMNS.has(k)) throw new Error(`Refusing to update column ${k}`);
    await conn.query(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE discord_id = ?`, [
        ...keys.map((k) => updates[k]),
        user.discord_id
    ]);
    Object.assign(user, updates);
}

/**
 * Change a locked user's XP balance and log it.
 *
 * @param {object} conn   transaction connection
 * @param {object} user   row from lockUser() (mutated to reflect the change)
 * @param {number} amount positive to credit, negative to debit
 * @param {string} source xp_transactions.source
 * @param {object} [opts]
 * @param {number} [opts.lifetimeDelta] XP counted toward lifetime/level (default: max(amount, 0))
 * @param {number} [opts.referenceId]
 * @param {object} [opts.userUpdates] extra whitelisted columns to update
 */
async function applyXP(conn, user, amount, source, opts = {}) {
    const delta = Math.trunc(Number(amount));
    if (!Number.isSafeInteger(delta)) throw new Error(`Invalid XP amount ${amount}`);

    const balanceBefore = Number(user.player_xp);
    const balanceAfter = balanceBefore + delta;
    if (balanceAfter < 0) throw errors.insufficientXP(-delta, balanceBefore);

    const lifetimeDelta = Math.max(0, opts.lifetimeDelta ?? Math.max(delta, 0));
    const lifetimeAfter = Number(user.lifetime_xp) + lifetimeDelta;
    const previousLevel = Number(user.player_level);
    const level = levelFromXP(lifetimeAfter);

    await conn.query('UPDATE users SET player_xp = ?, lifetime_xp = ?, player_level = ? WHERE discord_id = ?', [
        balanceAfter,
        lifetimeAfter,
        level,
        user.discord_id
    ]);
    Object.assign(user, { player_xp: balanceAfter, lifetime_xp: lifetimeAfter, player_level: level });
    await updateUserColumns(conn, user, opts.userUpdates);

    const [res] = await conn.query(
        `INSERT INTO xp_transactions (discord_id, amount, source, balance_before, balance_after, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.discord_id, delta, source, balanceBefore, balanceAfter, opts.referenceId ?? null]
    );

    return {
        transactionId: res.insertId,
        amount: delta,
        balanceBefore,
        balanceAfter,
        previousLevel,
        level,
        leveledUp: level > previousLevel
    };
}

/** Start of the current UTC day as a JS Date. */
function startOfUtcDay(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function countToday(conn, discordId, source) {
    const [[row]] = await conn.query(
        'SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = ? AND created_at >= ?',
        [discordId, source, startOfUtcDay()]
    );
    return Number(row.n);
}

async function sumToday(conn, discordId, source) {
    const [[row]] = await conn.query(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM xp_transactions WHERE discord_id = ? AND source = ? AND created_at >= ?',
        [discordId, source, startOfUtcDay()]
    );
    return Number(row.total);
}

/**
 * Award XP for an action using class + skill modifiers. Returns null when
 * gamification is disabled or the daily reward cap for the action is hit.
 *
 * @param {object} conn
 * @param {object} user locked user row
 * @param {string} source  'list_create' | 'item_add' | 'item_complete' | 'game_reward' ...
 * @param {number} baseXP
 * @param {object} [opts] { context, dailyLimit, maxXP, referenceId }
 */
async function rewardAction(conn, user, source, baseXP, opts = {}) {
    if (!user.gamification_enabled || baseXP <= 0) return null;
    if (opts.dailyLimit !== undefined && (await countToday(conn, user.discord_id, source)) >= opts.dailyLimit) {
        return { capped: true, finalXP: 0, baseXP };
    }

    const skills = await getUserSkills(user.discord_id, conn);
    const calc = calculateFinalXP(user, skills, baseXP, { context: { action: source, ...(opts.context || {}) } });
    let finalXP = calc.finalXP;
    let capped = false;
    if (opts.maxXP !== undefined && finalXP > opts.maxXP) {
        finalXP = Math.max(0, opts.maxXP);
        capped = true;
    }

    if (finalXP <= 0) {
        await updateUserColumns(conn, user, calc.userUpdates);
        return { ...calc, finalXP: 0, capped: true };
    }

    const tx = await applyXP(conn, user, finalXP, source, { referenceId: opts.referenceId, userUpdates: calc.userUpdates });
    return { ...calc, finalXP, capped, ...tx };
}

/** Remaining free-game XP a user can earn today. */
async function remainingFreeGameXP(conn, discordId) {
    return Math.max(0, LIMITS.FREE_GAME_XP_PER_DAY - (await sumToday(conn, discordId, 'game_reward')));
}

/**
 * Evaluate and persist newly earned achievements for a (locked) user.
 * @returns {Promise<Array<object>>} achievements unlocked by this call
 */
async function unlockAchievements(conn, user, events = {}) {
    const [rows] = await conn.query('SELECT achievement_key FROM achievements WHERE discord_id = ?', [user.discord_id]);
    const games = await getGameCounts(user.discord_id, conn);
    const candidates = evaluateAchievements(
        { ...user, games_played: games.played, games_won: games.won },
        rows.map((r) => r.achievement_key),
        events
    );
    const unlocked = [];
    for (const ach of candidates) {
        const [res] = await conn.query('INSERT IGNORE INTO achievements (discord_id, achievement_key) VALUES (?, ?)', [
            user.discord_id,
            ach.key
        ]);
        if (res.affectedRows === 1) unlocked.push(ach);
    }
    return unlocked;
}

/** Re-check achievements outside of any other operation. */
async function checkAchievements(discordId, events = {}) {
    return withTransaction(async (conn) => unlockAchievements(conn, await lockUser(conn, discordId), events));
}

function requireGamification(user) {
    if (!user.gamification_enabled) throw errors.gamificationDisabled();
}

// ─── Daily reward ────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{ claimed: false, remainingMs: number, streak: number }
 *   | { claimed: true, totalXP, baseXP, classBonus, streakBonus, skillDailyBonus, bonusInfo,
 *       streak, streakBroken, streakPreserved, previousStreak, balance, level, leveledUp, achievements }>}
 */
async function claimDaily(discordId) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        const skills = await getUserSkills(user.discord_id, conn);
        const previousStreak = Number(user.streak_count) || 0;
        const reward = calculateDailyReward(user, skills, Date.now());
        if (!reward.eligible) return { claimed: false, remainingMs: reward.remainingMs, streak: reward.streak };

        const tx = await applyXP(conn, user, reward.totalXP, 'daily', {
            userUpdates: {
                ...reward.xp.userUpdates,
                streak_count: reward.newStreak,
                last_daily_claim: new Date(),
                last_active_day: new Date().toISOString().slice(0, 10)
            }
        });
        const achievements = await unlockAchievements(conn, user);

        return {
            claimed: true,
            totalXP: reward.totalXP,
            baseXP: reward.xp.baseXP,
            classBonus: reward.xp.finalXP - reward.xp.baseXP,
            streakBonus: reward.streakBonus,
            skillDailyBonus: reward.skillDailyBonus,
            bonusInfo: reward.xp.bonusInfo,
            streak: reward.newStreak,
            previousStreak,
            streakBroken: reward.streakBroken,
            streakPreserved: reward.streakPreserved,
            balance: tx.balanceAfter,
            level: tx.level,
            leveledUp: tx.leveledUp,
            achievements
        };
    });
}

// ─── Classes ─────────────────────────────────────────────────────────────────

function normaliseClassKey(raw) {
    const key = String(raw || '').toUpperCase();
    return Object.prototype.hasOwnProperty.call(CLASSES, key) ? key : null;
}

function ownsClass(user, classKey) {
    return classKey === 'DEFAULT' || Boolean(user[classOwnershipColumn(classKey)]);
}

/** Buy (and equip) a class. Atomic: XP is only spent if ownership is granted. */
async function buyClass(discordId, rawKey) {
    const classKey = normaliseClassKey(rawKey);
    if (!classKey || !PURCHASABLE_CLASS_KEYS.includes(classKey)) throw errors.notFound('Class not found.');
    const cost = CLASSES[classKey].cost;

    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        if (ownsClass(user, classKey)) throw errors.conflict(`You already own ${CLASSES[classKey].name}.`);
        if (Number(user.player_xp) < cost) throw errors.insufficientXP(cost, Number(user.player_xp));

        const tx = await applyXP(conn, user, -cost, 'class_purchase', {
            userUpdates: { [classOwnershipColumn(classKey)]: 1, player_class: classKey, ...CLASS_COUNTER_RESET }
        });
        const achievements = await unlockAchievements(conn, user);
        return { classKey, cost, balance: tx.balanceAfter, user, achievements };
    });
}

/** Equip an owned class. Switching class resets the class counters. */
async function equipClass(discordId, rawKey) {
    const classKey = normaliseClassKey(rawKey);
    if (!classKey) throw errors.notFound('Class not found.');

    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        if (!ownsClass(user, classKey)) throw errors.forbidden(`You don't own ${CLASSES[classKey].name} yet.`);
        if (user.player_class !== classKey) {
            await updateUserColumns(conn, user, { player_class: classKey, ...CLASS_COUNTER_RESET });
        }
        return { classKey, user };
    });
}

// ─── Skills ──────────────────────────────────────────────────────────────────

/**
 * Unlock a skill or raise it one level. Each level costs the skill's cost.
 * The skill's tree must be DEFAULT or a class the user owns, and its
 * prerequisite must be unlocked.
 */
async function unlockSkill(discordId, skillId) {
    const found = findSkill(skillId);
    if (!found) throw errors.notFound('Skill not found.');
    const { treeKey, skill } = found;

    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        if (!ownsClass(user, treeKey)) {
            throw errors.forbidden(`You must own the ${CLASSES[treeKey].name} class to learn ${skill.name}.`);
        }

        const [[current]] = await conn.query(
            'SELECT skill_level FROM user_skills WHERE discord_id = ? AND skill_id = ? FOR UPDATE',
            [user.discord_id, skillId]
        );
        const currentLevel = current ? Number(current.skill_level) : 0;
        if (currentLevel >= skill.maxLevel) throw errors.conflict(`${skill.name} is already at max level.`);

        if (skill.requires) {
            const [[req]] = await conn.query('SELECT skill_level FROM user_skills WHERE discord_id = ? AND skill_id = ?', [
                user.discord_id,
                skill.requires
            ]);
            if (!req) throw errors.forbidden(`Requires ${findSkill(skill.requires).skill.name} first.`);
        }

        if (Number(user.player_xp) < skill.cost) throw errors.insufficientXP(skill.cost, Number(user.player_xp));
        const tx = await applyXP(conn, user, -skill.cost, 'skill_purchase');
        await conn.query(
            `INSERT INTO user_skills (discord_id, skill_id, skill_level) VALUES (?, ?, 1)
             ON DUPLICATE KEY UPDATE skill_level = skill_level + 1`,
            [user.discord_id, skillId]
        );
        return { skillId, treeKey, skill, level: currentLevel + 1, cost: skill.cost, balance: tx.balanceAfter };
    });
}

module.exports = {
    applyXP,
    rewardAction,
    remainingFreeGameXP,
    unlockAchievements,
    checkAchievements,
    requireGamification,
    updateUserColumns,
    countToday,
    sumToday,
    startOfUtcDay,
    claimDaily,
    buyClass,
    equipClass,
    unlockSkill,
    ownsClass,
    normaliseClassKey,
    CLASS_COUNTER_RESET
};
