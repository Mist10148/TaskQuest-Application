/**
 * Every XP change goes through applyXP() on a row locked with
 * SELECT ... FOR UPDATE, inside a transaction, and is logged to
 * xp_transactions. This removes the lost-update and double-spend races the
 * bot and web previously had when both wrote absolute XP values.
 */

'use strict';

const { withTransaction } = require('./pool');
const { lockUser, getUser, getUserSkills, getGameCounts } = require('./users');
const { errors } = require('../errors');
const {
    CLASSES,
    PURCHASABLE_CLASS_KEYS,
    classOwnershipColumn,
    findSkill,
    LIMITS,
    REWARDS,
    SPEND_SOURCES,
    STREAK_CHESTS,
    PRESTIGE,
    SEASONS
} = require('../constants');
const { levelFromXP, prestigeTitle, calculateFinalXP, calculateDailyReward, getFreezeLimits } = require('../xp');
const { evaluateAchievements } = require('../achievements');
const tz = require('../tz');
const { todayInZone } = require('../dates');
const { currentSeason } = require('../quests');

/** Columns applyXP() may update alongside the balance. */
const UPDATABLE_COLUMNS = new Set([
    'assassin_streak', 'assassin_stacks', 'assassin_last_at', 'assassin_bleed', 'gambler_streak', 'wizard_counter', 'archer_streak', 'tank_stacks',
    'player_class', 'streak_count', 'last_daily_claim', 'last_active_day', 'last_game_at',
    'owns_hero', 'owns_gambler', 'owns_assassin', 'owns_wizard', 'owns_archer', 'owns_tank', 'streak_freezes',
    'owns_monk', 'monk_rhythm', 'monk_day', 'owns_artisan', 'artisan_progress', 'owns_ranger', 'owns_necromancer', 'owns_paladin', 'necro_souls',
    'owns_bard', 'owns_alchemist', 'owns_druid', 'owns_chronomancer', 'owns_warden', 'bard_recent', 'alchemist_mix',
    'last_chest_streak'
]);

const CLASS_COUNTER_RESET = { assassin_streak: 0, assassin_stacks: 0, assassin_last_at: null, gambler_streak: 0, monk_rhythm: 0, monk_day: null, artisan_progress: 0, necro_souls: 0, wizard_counter: 0, archer_streak: 0, tank_stacks: 0, bard_recent: '', alchemist_mix: 0 };

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
    // lifetime_xp drives the level and is reset by prestige; the total is never reset.
    const totalAfter = Math.max(Number(user.lifetime_xp_total) || 0, Number(user.lifetime_xp)) + lifetimeDelta;
    const previousLevel = Number(user.player_level);
    const level = levelFromXP(lifetimeAfter);

    await conn.query('UPDATE users SET player_xp = ?, lifetime_xp = ?, lifetime_xp_total = ?, player_level = ? WHERE discord_id = ?', [
        balanceAfter,
        lifetimeAfter,
        totalAfter,
        level,
        user.discord_id
    ]);
    Object.assign(user, { player_xp: balanceAfter, lifetime_xp: lifetimeAfter, lifetime_xp_total: totalAfter, player_level: level });
    await updateUserColumns(conn, user, opts.userUpdates);
    if (delta < 0 && SPEND_SOURCES.includes(source)) {
        await conn.query('UPDATE users SET xp_spent = xp_spent + ? WHERE discord_id = ?', [-delta, user.discord_id]);
        user.xp_spent = Number(user.xp_spent) - delta;
    }

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

/** The IANA zone of a user (row or discord id); null means UTC. */
async function userZone(conn, who) {
    if (who && typeof who === 'object') return who.timezone || null;
    const [rows] = await conn.query('SELECT timezone FROM users WHERE discord_id = ?', [String(who)]);
    return rows[0] ? rows[0].timezone || null : null;
}

/**
 * The user's day window [from, to) containing `now`: 00:00 to 00:00 in their own time zone (users.timezone,
 * UTC when unset). `who` is a user row (its zone is used, no query) or a discord id (its zone is looked up).
 * Every daily reward cap reads this window, so "today" is the user's own day.
 */
async function dayWindow(conn, who, now = new Date()) {
    const zone = await userZone(conn, who);
    return { from: tz.dayStart(zone, now), to: tz.nextDayStart(zone, now) };
}

/** XP transactions of `source` the user earned in their current day. */
async function countToday(conn, who, source, now = new Date()) {
    const { from, to } = await dayWindow(conn, who, now);
    const id = who && typeof who === 'object' ? who.discord_id : String(who);
    const [[row]] = await conn.query(
        'SELECT COUNT(*) AS n FROM xp_transactions WHERE discord_id = ? AND source = ? AND created_at >= ? AND created_at < ?',
        [id, source, from, to]
    );
    return Number(row.n);
}

/** XP of `source` the user earned in their current day. */
async function sumToday(conn, who, source, now = new Date()) {
    const { from, to } = await dayWindow(conn, who, now);
    const id = who && typeof who === 'object' ? who.discord_id : String(who);
    const [[row]] = await conn.query(
        'SELECT COALESCE(SUM(amount), 0) AS total FROM xp_transactions WHERE discord_id = ? AND source = ? AND created_at >= ? AND created_at < ?',
        [id, source, from, to]
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
 * @param {object} [opts] { context, dailyLimit, maxXP, referenceId, now }
 */
async function rewardAction(conn, user, source, baseXP, opts = {}) {
    if (!user.gamification_enabled || baseXP <= 0) return null;
    if (opts.dailyLimit !== undefined && (await countToday(conn, user, source)) >= opts.dailyLimit) {
        return { capped: true, finalXP: 0, baseXP };
    }

    const skills = await getUserSkills(user.discord_id, conn);
    const calc = calculateFinalXP(user, skills, baseXP, { context: { action: source, ...(opts.context || {}) }, now: opts.now });
    let finalXP = calc.finalXP;
    let capped = false;
    if (opts.maxXP !== undefined && finalXP > opts.maxXP) {
        finalXP = Math.max(0, opts.maxXP);
        capped = true;
    }

    if (finalXP <= 0) {
        // A run past a daily cap (free games) pays nothing, so it must not advance class counters either.
        if (!capped) await updateUserColumns(conn, user, calc.userUpdates);
        return { ...calc, finalXP: 0, capped: true };
    }

    const tx = await applyXP(conn, user, finalXP, source, { referenceId: opts.referenceId, userUpdates: calc.userUpdates });
    return { ...calc, finalXP, capped, ...tx };
}

/**
 * Pay a flat bonus (no class or skill modifiers) from its own source, optionally under a daily cap
 * shared by `capSources`. Returns { xp, tx } for what was paid, or null when nothing was.
 *
 * @param {object} [opts] { dailyCap, capSources, referenceId }
 */
async function awardFlat(conn, user, source, amount, opts = {}) {
    if (!user.gamification_enabled) return null;
    let pay = Math.trunc(Number(amount));
    // The weekly modifier doubles one source for everybody; the daily cap below still bounds the doubled amount.
    if (process.env.XP_WEEKLY_MODIFIER !== 'off' && currentSeason(SEASONS, opts.now || new Date()).doubles === source) pay *= 2;
    if (opts.dailyCap !== undefined) {
        let paid = 0;
        for (const s of opts.capSources || [source]) paid += await sumToday(conn, user, s);
        pay = Math.min(pay, opts.dailyCap - paid);
    }
    if (!(pay > 0)) return null;
    const tx = await applyXP(conn, user, pay, source, { referenceId: opts.referenceId });
    return { xp: pay, tx };
}

/** Remaining free-game XP a user can earn today (their own day). */
async function remainingFreeGameXP(conn, discordId, now = new Date()) {
    return Math.max(0, LIMITS.FREE_GAME_XP_PER_DAY - (await sumToday(conn, discordId, 'game_reward', now)));
}

/**
 * Evaluate and persist newly earned achievements for a (locked) user. Each one pays REWARDS.ACHIEVEMENT
 * flat XP (source achievement_reward) in the same transaction. That XP can itself earn an XP or level
 * achievement, so the check repeats until nothing new unlocks; it always ends, because every achievement
 * unlocks once and the list is finite.
 * @returns {Promise<Array<object>>} achievements unlocked by this call, each with the `xp` it paid (0 when XP is off)
 */
async function unlockAchievements(conn, user, events = {}) {
    const unlocked = [];
    const known = new Set((await conn.query('SELECT achievement_key FROM achievements WHERE discord_id = ?', [user.discord_id]))[0].map((r) => r.achievement_key));
    for (let round = 0; round < 100; round++) {
        const games = await getGameCounts(user.discord_id, conn);
        const candidates = evaluateAchievements({ ...user, games_played: games.played, games_won: games.won }, known, events);
        let found = 0;
        for (const ach of candidates) {
            const [res] = await conn.query('INSERT IGNORE INTO achievements (discord_id, achievement_key) VALUES (?, ?)', [
                user.discord_id,
                ach.key
            ]);
            known.add(ach.key);
            if (res.affectedRows !== 1) continue;
            found++;
            const paid = await awardFlat(conn, user, 'achievement_reward', REWARDS.ACHIEVEMENT, { referenceId: res.insertId || null });
            unlocked.push({ ...ach, xp: paid ? paid.xp : 0 });
        }
        if (!found) break;
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

        // A streak chest pays once per streak run: only above the last chest paid, which a reset streak clears.
        const lastChest = Number(user.last_chest_streak) || 0;
        const chestXP = STREAK_CHESTS[reward.newStreak] && lastChest < reward.newStreak ? STREAK_CHESTS[reward.newStreak] : 0;
        const tx = await applyXP(conn, user, reward.totalXP, 'daily', {
            userUpdates: {
                ...reward.xp.userUpdates,
                last_chest_streak: chestXP ? reward.newStreak : reward.newStreak < lastChest ? 0 : lastChest,
                ...(reward.freezeUsed ? { streak_freezes: Number(user.streak_freezes) - reward.freezesUsed } : {}),
                streak_count: reward.newStreak,
                last_daily_claim: new Date(),
                last_active_day: todayInZone(user.timezone)
            }
        });
        let chest = null;
        if (chestXP) {
            await applyXP(conn, user, chestXP, 'streak_chest', { referenceId: reward.newStreak });
            chest = { streak: reward.newStreak, xp: chestXP };
        }
        const achievements = await unlockAchievements(conn, user);

        return {
            claimed: true,
            totalXP: reward.totalXP,
            baseXP: reward.xp.baseXP,
            classBonus: reward.xp.finalXP - reward.xp.baseXP,
            streakBonus: reward.streakBonus,
            skillDailyBonus: reward.skillDailyBonus,
            surpriseBonus: reward.surpriseBonus,
            chest,
            bonusInfo: reward.xp.bonusInfo,
            streak: reward.newStreak,
            previousStreak,
            streakBroken: reward.streakBroken,
            streakPreserved: reward.streakPreserved,
            freezeUsed: reward.freezeUsed,
            balance: Number(user.player_xp),
            level: Number(user.player_level),
            leveledUp: Number(user.player_level) > tx.previousLevel,
            achievements
        };
    });
}

// ─── Prestige ────────────────────────────────────────────────────────────────

/**
 * Start over for a permanent XP multiplier and a title. Resets the balance, level (lifetime_xp), class,
 * class ownership, skills, class counters and streak freezes. Achievements, quest claims, tasks, the
 * daily streak and lifetime_xp_total (which the XP achievements and the lifetime board read) are kept.
 */
async function prestige(discordId) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        const done = Number(user.prestige) || 0;
        if (Number(user.player_level) < PRESTIGE.MIN_LEVEL) throw errors.validation(`Reach level ${PRESTIGE.MIN_LEVEL} to prestige.`);
        if (done >= PRESTIGE.MAX) throw errors.conflict(`You have already prestiged ${PRESTIGE.MAX} times.`);

        const levelBefore = Number(user.player_level);
        const balanceBefore = Number(user.player_xp);
        // The balance leaves through the ledger, so the history shows where it went.
        await applyXP(conn, user, -balanceBefore, 'prestige', { referenceId: done + 1 });
        const owned = Object.fromEntries(PURCHASABLE_CLASS_KEYS.map((k) => [classOwnershipColumn(k), 0]));
        const sets = { lifetime_xp: 0, player_level: 1, player_class: 'DEFAULT', streak_freezes: 0, prestige: done + 1, ...owned, ...CLASS_COUNTER_RESET };
        const keys = Object.keys(sets);
        await conn.query(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE discord_id = ?`, [...keys.map((k) => sets[k]), user.discord_id]);
        Object.assign(user, sets);
        await conn.query('DELETE FROM user_skills WHERE discord_id = ?', [user.discord_id]);
        const achievements = await unlockAchievements(conn, user);
        return {
            prestige: done + 1,
            title: prestigeTitle(done + 1),
            bonusPercent: (done + 1) * PRESTIGE.BONUS_PERCENT,
            levelBefore,
            balanceLost: balanceBefore,
            balance: Number(user.player_xp),
            level: Number(user.player_level),
            achievements
        };
    });
}

/** What prestige would do for this user right now. */
async function getPrestige(discordId) {
    const user = (await getUser(discordId)) || {};
    const done = Number(user.prestige) || 0;
    return {
        prestige: done,
        title: prestigeTitle(done),
        nextTitle: done < PRESTIGE.MAX ? prestigeTitle(done + 1) : null,
        bonusPercent: Math.min(done, PRESTIGE.MAX) * PRESTIGE.BONUS_PERCENT,
        nextBonusPercent: done < PRESTIGE.MAX ? (done + 1) * PRESTIGE.BONUS_PERCENT : null,
        level: Number(user.player_level) || 1,
        minLevel: PRESTIGE.MIN_LEVEL,
        max: PRESTIGE.MAX,
        eligible: Boolean(user.gamification_enabled) && Number(user.player_level) >= PRESTIGE.MIN_LEVEL && done < PRESTIGE.MAX
    };
}

// ─── Streak freeze ───────────────────────────────────────────────────────────

/** Buy one streak freeze (kept until a daily claim would otherwise break the streak). */
async function buyStreakFreeze(discordId) {
    return withTransaction(async (conn) => {
        const user = await lockUser(conn, discordId);
        requireGamification(user);
        const limits = getFreezeLimits(await getUserSkills(user.discord_id, conn));
        const owned = Number(user.streak_freezes) || 0;
        if (owned >= limits.MAX) throw errors.conflict(`You can hold at most ${limits.MAX} streak freezes.`);
        if (Number(user.player_xp) < limits.COST) throw errors.insufficientXP(limits.COST, Number(user.player_xp));
        await applyXP(conn, user, -limits.COST, 'streak_freeze', { userUpdates: { streak_freezes: owned + 1 } });
        const achievements = await unlockAchievements(conn, user);
        return { freezes: owned + 1, max: limits.MAX, cost: limits.COST, balance: Number(user.player_xp), achievements };
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

        await applyXP(conn, user, -cost, 'class_purchase', {
            userUpdates: { [classOwnershipColumn(classKey)]: 1, player_class: classKey, ...CLASS_COUNTER_RESET }
        });
        const achievements = await unlockAchievements(conn, user);
        return { classKey, cost, balance: Number(user.player_xp), user, achievements };
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
    awardFlat,
    remainingFreeGameXP,
    unlockAchievements,
    checkAchievements,
    requireGamification,
    updateUserColumns,
    countToday,
    sumToday,
    dayWindow,
    userZone,
    claimDaily,
    buyStreakFreeze,
    buyClass,
    equipClass,
    unlockSkill,
    prestige,
    getPrestige,
    ownsClass,
    normaliseClassKey,
    CLASS_COUNTER_RESET
};
