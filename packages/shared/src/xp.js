/**
 * XP, level, class and skill calculations.
 *
 * All functions are pure: they never mutate the user object passed in and
 * never touch the database. Callers persist `userUpdates` and the XP delta
 * atomically (see db/progression.js).
 *
 * Randomness is injectable (`rng`) so behaviour can be unit tested.
 */

'use strict';

const { XP_PER_LEVEL, REWARDS, DAILY } = require('./constants');
const { secureRandom } = require('./random');

// ─── Levels ───────────────────────────────────────────────────────────────────

/** Level for a given amount of lifetime XP. Level never drops when XP is spent. */
function levelFromXP(lifetimeXP) {
    const xp = Math.max(0, Number(lifetimeXP) || 0);
    return Math.floor(xp / XP_PER_LEVEL) + 1;
}

/** Progress inside the current level: { level, current, needed, percent }. */
function levelProgress(lifetimeXP) {
    const xp = Math.max(0, Number(lifetimeXP) || 0);
    const level = levelFromXP(xp);
    const current = xp - (level - 1) * XP_PER_LEVEL;
    return { level, current, needed: XP_PER_LEVEL, percent: Math.floor((current / XP_PER_LEVEL) * 100) };
}

// ─── Skills ───────────────────────────────────────────────────────────────────

/** Normalise user skill rows ([{ skill_id, skill_level }]) into a Map. */
function toSkillMap(userSkills) {
    if (userSkills instanceof Map) return userSkills;
    const map = new Map();
    for (const s of userSkills || []) {
        if (s && s.skill_id) map.set(s.skill_id, Number(s.skill_level) || 0);
    }
    return map;
}

/**
 * Aggregate the unconditional skill bonuses. Class-conditional effects are
 * applied in calculateClassXP / calculateFinalXP where the state is known.
 */
function getSkillBonuses(userSkills) {
    const skills = toSkillMap(userSkills);
    const lvl = (id) => skills.get(id) || 0;

    return {
        xpMultiplier: 1
            + lvl('default_xp_boost') * 0.05
            + lvl('hero_inspire') * 0.08
            + (lvl('hero_legend') ? 0.25 : 0)
            + lvl('wizard_focus') * 0.10
            + lvl('archer_aim') * 0.03,
        flatXPBonus: lvl('hero_valor') * 10 + lvl('tank_fortify') * 5 + lvl('wizard_study') * 3,
        dailyBonus: lvl('default_daily_boost') * 10,
        critChance: lvl('assassin_critical') * 10,
        critMultiplier: lvl('assassin_shadow') ? 2.0 : 1.5,
        doubleChance: lvl('gambler_double') * 10,
        jackpotChance: lvl('gambler_jackpot') ? 1 : 0,
        streakShield: lvl('default_streak_shield') > 0,
        streakUnstoppable: lvl('tank_unstoppable') > 0
    };
}

// ─── Class XP ─────────────────────────────────────────────────────────────────

/**
 * Apply the equipped class mechanic to a base XP amount.
 *
 * @param {object} user     users row (read only)
 * @param {number} baseXP   base reward
 * @param {object} [opts]
 * @param {Map|Array} [opts.skills]  user skills
 * @param {object} [opts.context]    { action, priority }
 * @param {function} [opts.rng]
 * @returns {{ finalXP: number, bonusInfo: object, userUpdates: object }}
 */
function calculateClassXP(user, baseXP, opts = {}) {
    const rng = opts.rng || secureRandom;
    const skills = toSkillMap(opts.skills);
    const context = opts.context || {};
    const lvl = (id) => skills.get(id) || 0;
    const level = Number(user.player_level) || 1;

    let finalXP = baseXP;
    let bonusInfo = { type: 'DEFAULT', details: '', classBonus: 0 };
    const userUpdates = {};

    switch (user.player_class) {
        case 'HERO':
            finalXP += 25;
            bonusInfo = { type: 'HERO', details: '⚔️ Hero +25', classBonus: 25 };
            break;

        case 'GAMBLER': {
            const bonus = Math.floor(rng() * (baseXP + 100));
            const lossChance = Math.max(0.05, 0.2 - lvl('gambler_lucky') * 0.05);
            if (rng() < lossChance) {
                const rawLoss = Math.min(bonus, baseXP - 1);
                const lost = Math.max(0, Math.floor(rawLoss * (1 - lvl('gambler_safety') * 0.25)));
                finalXP = Math.max(1, baseXP - lost);
                bonusInfo = { type: 'GAMBLER_LOSS', details: `🎲 Bad luck -${lost}`, classBonus: -lost };
            } else {
                finalXP = baseXP + bonus;
                bonusInfo = { type: 'GAMBLER_WIN', details: `🎲 Lucky +${bonus}`, classBonus: bonus };
            }
            break;
        }

        case 'ASSASSIN': {
            const streak = (Number(user.assassin_streak) || 0) + 1 + lvl('assassin_swift');
            userUpdates.assassin_streak = streak;
            if (streak >= 3) {
                const stacks = Math.min(10, (Number(user.assassin_stacks) || 0) + 1);
                userUpdates.assassin_stacks = stacks;
                const bonusXP = Math.floor((baseXP * 5 * stacks) / 100);
                finalXP = baseXP + bonusXP;
                bonusInfo = { type: 'ASSASSIN', details: `🗡️ Stack ${stacks}/10 +${bonusXP}`, classBonus: bonusXP };
            } else {
                bonusInfo = { type: 'ASSASSIN_BUILDING', details: `🗡️ Streak ${streak}/3`, classBonus: 0 };
            }
            break;
        }

        case 'WIZARD': {
            const counter = (Number(user.wizard_counter) || 0) + 1;
            userUpdates.wizard_counter = counter >= 5 ? 0 : counter;
            const wisdom = level * 5;
            if (counter % 5 === 0) {
                const burst = wisdom * (lvl('wizard_mastery') ? 3 : 2);
                finalXP = baseXP + burst;
                bonusInfo = { type: 'WIZARD_BURST', details: `🔮 Burst +${burst}`, classBonus: burst };
            } else if (counter % 3 === 0) {
                const combo = Math.floor(wisdom * (1 + lvl('wizard_combo') * 0.5));
                finalXP = baseXP + combo;
                bonusInfo = { type: 'WIZARD_COMBO', details: `✨ Combo +${combo}`, classBonus: combo };
            } else {
                bonusInfo = { type: 'WIZARD_CHARGE', details: `🔮 Charge ${counter}/5`, classBonus: 0 };
            }
            break;
        }

        case 'ARCHER': {
            const hitChance = Math.min(97, 80 + level * 0.5);
            const sniper = lvl('archer_sniper') && context.action === 'item_complete' && context.priority === 'HIGH';
            const roll = rng() * 100;
            if (sniper || roll < hitChance) {
                const streak = Math.min(15, (Number(user.archer_streak) || 0) + 1);
                userUpdates.archer_streak = streak;
                const streakBonus = Math.floor((baseXP * streak * 8) / 100) + 3 + streak;
                let total = streakBonus;
                let details = `🎯 Hit x${streak} +${streakBonus}`;

                const headshotChance = Math.min(30, hitChance * 0.2);
                if (sniper || roll < headshotChance) {
                    const crit = baseXP * 2 + streak * 3;
                    total += crit;
                    details += ` 💥+${crit}`;
                }
                if (rng() < 0.05) {
                    const perfect = baseXP * 4 + streak * 10;
                    total += perfect;
                    details += ` 🌟+${perfect}`;
                }
                finalXP = baseXP + total;
                bonusInfo = { type: 'ARCHER_HIT', details, classBonus: total };
            } else {
                const penalty = lvl('archer_piercing') ? 0 : 2;
                const streak = Math.max(0, (Number(user.archer_streak) || 0) - penalty);
                userUpdates.archer_streak = streak;
                bonusInfo = { type: 'ARCHER_MISS', details: `💨 Miss! Streak: ${streak}`, classBonus: 0 };
            }
            break;
        }

        case 'TANK': {
            const cap = tankStackCap(level, skills);
            const stacks = Math.min(cap, (Number(user.tank_stacks) || 0) + 1);
            userUpdates.tank_stacks = stacks;
            const total = Math.floor((baseXP * stacks * 4) / 100) + Math.floor(stacks / 2);
            finalXP = baseXP + total;
            bonusInfo = { type: 'TANK', details: `🛡️ Shield x${stacks} +${total}`, classBonus: total };
            break;
        }

        default:
            break;
    }

    return { finalXP, bonusInfo, userUpdates };
}

function tankStackCap(level, skills) {
    const absorb = toSkillMap(skills).get('tank_absorb') || 0;
    return Math.max(3, 20 - level) + absorb * 2;
}

// ─── Final XP ─────────────────────────────────────────────────────────────────

/**
 * Class mechanic + skill bonuses + random procs, with a readable breakdown.
 *
 * @param {object} user
 * @param {Array|Map} userSkills
 * @param {number} baseXP
 * @param {object} [opts] { context: { action, priority }, rng }
 */
function calculateFinalXP(user, userSkills, baseXP, opts = {}) {
    const rng = opts.rng || secureRandom;
    const context = opts.context || {};
    const skills = toSkillMap(userSkills);
    const lvl = (id) => skills.get(id) || 0;
    const level = Number(user.player_level) || 1;

    const { finalXP: classXP, bonusInfo, userUpdates } = calculateClassXP(user, baseXP, { skills, context, rng });
    const bonuses = getSkillBonuses(skills);

    // Conditional multipliers that depend on class state after this action.
    let multiplier = bonuses.xpMultiplier;
    if (user.player_class === 'ASSASSIN' && lvl('assassin_execute') && userUpdates.assassin_stacks === 10) {
        multiplier += 1.0;
    }
    if (user.player_class === 'TANK' && lvl('tank_revenge') && userUpdates.tank_stacks === tankStackCap(level, skills)) {
        multiplier += lvl('tank_revenge') * 0.10;
    }

    let flat = bonuses.flatXPBonus;
    if (context.action === 'item_complete') flat += lvl('archer_multishot') * 5;

    let finalXP = Math.floor(classXP * multiplier) + flat;
    const skillBonus = finalXP - classXP;
    const procs = [];

    if (lvl('hero_champion') && level % 5 === 0) {
        finalXP *= 2;
        procs.push('👑 Champion x2');
    }

    let critBonus = 0;
    if (bonuses.critChance > 0 && rng() * 100 < bonuses.critChance) {
        critBonus = Math.floor(finalXP * (bonuses.critMultiplier - 1));
        finalXP += critBonus;
    }

    if (bonuses.doubleChance > 0 && rng() * 100 < bonuses.doubleChance) {
        finalXP *= 2;
        procs.push('🎰 Double');
    }
    if (bonuses.jackpotChance > 0 && rng() * 100 < bonuses.jackpotChance) {
        finalXP *= 10;
        procs.push('💎 JACKPOT x10');
    }

    finalXP = Math.max(0, Math.floor(finalXP));

    const parts = [`Base: ${baseXP}`];
    if (bonusInfo.classBonus !== 0) parts.push(bonusInfo.details);
    if (skillBonus > 0) parts.push(`📚 Skill +${skillBonus}`);
    if (critBonus > 0) parts.push(`💥 Crit +${critBonus}`);
    parts.push(...procs);
    const hasBonus = finalXP !== baseXP || procs.length > 0;

    return {
        baseXP,
        finalXP,
        bonusInfo: {
            ...bonusInfo,
            details: hasBonus ? parts.join(' | ') : '',
            skillBonus,
            critBonus,
            procs,
            totalBonus: finalXP - baseXP
        },
        userUpdates
    };
}

// ─── Daily reward ────────────────────────────────────────────────────────────

/**
 * Work out the daily reward for a user at `now`. Does not write anything.
 *
 * @returns {{ eligible: false, remainingMs: number, streak: number }
 *         | { eligible: true, newStreak, streakBroken, streakPreserved, streakBonus,
 *             skillDailyBonus, xp: object, totalXP: number }}
 */
function calculateDailyReward(user, userSkills, now = Date.now(), opts = {}) {
    const lastClaim = user.last_daily_claim ? new Date(user.last_daily_claim).getTime() : 0;
    const since = now - lastClaim;
    const streak = Number(user.streak_count) || 0;

    if (lastClaim && since < DAILY.COOLDOWN_MS) {
        return { eligible: false, remainingMs: DAILY.COOLDOWN_MS - since, streak };
    }

    const bonuses = getSkillBonuses(userSkills);
    const window = bonuses.streakShield ? DAILY.SHIELDED_STREAK_WINDOW_MS : DAILY.STREAK_WINDOW_MS;

    let newStreak = 1;
    let streakBroken = false;
    let streakPreserved = false;
    if (lastClaim && since <= window) {
        newStreak = streak + 1;
    } else if (lastClaim && bonuses.streakUnstoppable) {
        newStreak = streak + 1;
        streakPreserved = true;
    } else if (lastClaim) {
        streakBroken = streak > 1;
    }

    const streakBonus = Math.min((newStreak - 1) * REWARDS.DAILY_STREAK_STEP, REWARDS.DAILY_STREAK_MAX_BONUS);
    const xp = calculateFinalXP(user, userSkills, REWARDS.DAILY_BASE, { ...opts, context: { action: 'daily' } });
    const totalXP = xp.finalXP + streakBonus + bonuses.dailyBonus;

    return {
        eligible: true,
        newStreak,
        streakBroken,
        streakPreserved,
        streakBonus,
        skillDailyBonus: bonuses.dailyBonus,
        xp,
        totalXP
    };
}

module.exports = {
    levelFromXP,
    levelProgress,
    toSkillMap,
    getSkillBonuses,
    calculateClassXP,
    calculateFinalXP,
    calculateDailyReward,
    tankStackCap
};
