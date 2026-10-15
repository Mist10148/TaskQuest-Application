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

const { XP_PER_LEVEL, REWARDS, DAILY, SMALL_ACTION_CAP, STREAK_FREEZE, STREAK_FREEZE_CACHE, CLASS_RULES, SKILL_RULES, PRESTIGE, PRESTIGE_TITLES } = require('./constants');
const { secureRandom } = require('./random');
const { daysBetween, todayInZone } = require('./dates');

/** YYYY-MM-DD for a DATE column value (string or Date); null when empty. */
function dayString(value) {
    if (!value) return null;
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/** Milliseconds for a Date, ISO string or number; null for empty/invalid. */
function toMs(value) {
    if (value === null || value === undefined || value === '') return null;
    const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

// ─── Levels ───────────────────────────────────────────────────────────────────

/** The permanent XP multiplier from prestige, added to the other multipliers (0.02 per prestige, max 10). */
function prestigeMultiplier(user) {
    const n = Math.min(PRESTIGE.MAX, Math.max(0, Number(user && user.prestige) || 0));
    return (n * PRESTIGE.BONUS_PERCENT) / 100;
}

/** The title for a number of prestiges ('' for none). */
function prestigeTitle(prestige) {
    const n = Math.min(PRESTIGE.MAX, Math.max(0, Math.trunc(Number(prestige)) || 0));
    return PRESTIGE_TITLES[n];
}

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
        streakUnstoppable: lvl('tank_unstoppable') > 0,
        momentumPerDay: lvl('default_momentum') * (SKILL_RULES.MOMENTUM_PERCENT_PER_DAY / 100),
        rallyXP: lvl('hero_rally') ? CLASS_RULES.HERO.RALLY_XP : 0,
        anchorXP: lvl('tank_anchor') ? CLASS_RULES.TANK.ANCHOR_XP : 0,
        dailySurprise: lvl('default_daily_surprise') > 0,
        paladinSanctuary: lvl('paladin_sanctuary') > 0
    };
}

/** Streak freeze limits: { max, cost }. Freeze Cache raises the cap and lowers the price. */
function getFreezeLimits(userSkills) {
    const cache = (toSkillMap(userSkills).get('default_freeze_cache') || 0) > 0;
    return cache ? { ...STREAK_FREEZE_CACHE } : { ...STREAK_FREEZE };
}

// ─── Class XP ─────────────────────────────────────────────────────────────────

/**
 * Apply the equipped class mechanic to a base XP amount.
 *
 * @param {object} user     users row (read only)
 * @param {number} baseXP   base reward
 * @param {object} [opts]
 * @param {Map|Array} [opts.skills]  user skills
 * @param {object} [opts.context]    { action, priority, recurring, dueDate, overdueDays, listCleared }
 * @param {number|Date} [opts.now]   clock for time-based mechanics (Assassin decay)
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
        case 'HERO': {
            const flat = lvl('hero_oath') ? Math.min(CLASS_RULES.HERO.FLAT + level, CLASS_RULES.HERO.OATH_CAP) : CLASS_RULES.HERO.FLAT;
            const bonus = Math.min(flat, baseXP * CLASS_RULES.HERO.MAX_BASE_MULTIPLE);
            finalXP += bonus;
            bonusInfo = { type: 'HERO', details: `⚔️ Hero +${bonus}`, classBonus: bonus };
            break;
        }

        case 'GAMBLER': {
            const bonus = Math.floor(rng() * (baseXP + 100));
            const lossChance = Math.max(CLASS_RULES.GAMBLER.MIN_LOSS_CHANCE, CLASS_RULES.GAMBLER.LOSS_CHANCE - lvl('gambler_lucky') * 0.05);
            const streak = Number(user.gambler_streak) || 0;
            // Hot Hand: a run of lucky rolls guarantees the next one is not bad luck (the roll is still drawn).
            const hotHand = lvl('gambler_hothand') > 0 && streak >= CLASS_RULES.GAMBLER.HOT_HAND_STREAK;
            const bad = rng() < lossChance && !hotHand;
            if (bad) {
                const rawLoss = Math.min(bonus, baseXP - 1);
                let lost = Math.max(0, Math.floor(rawLoss * (1 - lvl('gambler_safety') * 0.25)));
                if (lvl('gambler_insurance')) lost = Math.min(lost, baseXP - Math.ceil(baseXP * CLASS_RULES.GAMBLER.INSURANCE_FLOOR));
                lost = Math.max(0, lost);
                finalXP = Math.max(1, baseXP - lost);
                userUpdates.gambler_streak = 0;
                bonusInfo = { type: 'GAMBLER_LOSS', details: `🎲 Bad luck -${lost}`, classBonus: -lost };
            } else {
                finalXP = baseXP + bonus;
                userUpdates.gambler_streak = hotHand ? 0 : streak + 1;
                bonusInfo = { type: 'GAMBLER_WIN', details: `🎲 ${hotHand ? 'Hot hand' : 'Lucky'} +${bonus}`, classBonus: bonus };
            }
            break;
        }

        case 'ASSASSIN': {
            // A streak only lives while you keep acting: after the decay window it starts over.
            const nowMs = toMs(opts.now) ?? Date.now();
            const lastAt = toMs(user.assassin_last_at);
            const decayHours = lvl('assassin_nightowl') ? CLASS_RULES.ASSASSIN.NIGHT_OWL_DECAY_HOURS : CLASS_RULES.ASSASSIN.DECAY_HOURS;
            const decayed = lastAt !== null && nowMs - lastAt > decayHours * 3600e3;
            userUpdates.assassin_last_at = new Date(nowMs);
            const prevStreak = decayed ? 0 : Number(user.assassin_streak) || 0;
            const prevStacks = decayed ? 0 : Number(user.assassin_stacks) || 0;
            if (decayed) userUpdates.assassin_stacks = 0;
            const streak = prevStreak + 1 + lvl('assassin_swift');
            userUpdates.assassin_streak = streak;
            if (streak >= 3) {
                const stacks = Math.min(CLASS_RULES.ASSASSIN.MAX_STACKS, prevStacks + 1);
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
            userUpdates.wizard_counter = counter >= 5 ? (lvl('wizard_overcharge') ? CLASS_RULES.WIZARD.OVERCHARGE_START : 0) : counter;
            const tome = lvl('wizard_tome') ? Math.floor((Number(user.total_items_completed) || 0) / CLASS_RULES.WIZARD.TOME_TASKS_PER_WISDOM) : 0;
            const wisdom = level * 5 + tome;
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
            const hitChance = Math.min(CLASS_RULES.ARCHER.MAX_HIT_CHANCE, 80 + level * 0.5 + lvl('archer_quiver') * CLASS_RULES.ARCHER.QUIVER_HIT_PERCENT);
            const sniper = lvl('archer_sniper') && context.action === 'item_complete' && context.priority === 'HIGH';
            const roll = rng() * 100;
            if (sniper || roll < hitChance) {
                const streak = Math.min(15, (Number(user.archer_streak) || 0) + 1);
                userUpdates.archer_streak = streak;
                const streakBonus = Math.floor((baseXP * streak * 8) / 100) + 3 + streak;
                let total = streakBonus;
                let details = `🎯 Hit x${streak} +${streakBonus}`;

                const headshotChance = Math.min(30, hitChance * 0.2) * (lvl('archer_eagle') ? CLASS_RULES.ARCHER.EAGLE_HEADSHOT_MULTIPLIER : 1);
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
            const stacks = Math.min(cap, (Number(user.tank_stacks) || 0) + (lvl('tank_bulwark') ? CLASS_RULES.TANK.BULWARK_STACKS : 1));
            userUpdates.tank_stacks = stacks;
            const total = Math.floor((baseXP * stacks * 4) / 100) + Math.floor(stacks / 2);
            finalXP = baseXP + total;
            bonusInfo = { type: 'TANK', details: `🛡️ Shield x${stacks} +${total}`, classBonus: total };
            break;
        }

        case 'MONK': {
            const m = CLASS_RULES.MONK;
            const today = todayInZone(user.timezone, new Date(toMs(opts.now) ?? Date.now())); // the user's own day
            const last = dayString(user.monk_day);
            const cap = m.MAX_RHYTHM + (lvl('monk_discipline') ? m.DISCIPLINE_CAP : 0);
            const gap = last ? daysBetween(last, today) : null;
            let rhythm = Math.max(0, Number(user.monk_rhythm) || 0);
            if (gap !== null && gap <= 0 && rhythm > 0) {
                // Same day: the rhythm holds.
            } else if (gap !== null && (gap === 1 || (gap === 2 && lvl('monk_serenity')))) {
                rhythm += 1;
            } else {
                rhythm = 1;
            }
            rhythm = Math.min(rhythm, cap);
            userUpdates.monk_rhythm = rhythm;
            userUpdates.monk_day = today;
            const raw = Math.floor((baseXP * rhythm * m.PERCENT_PER_DAY) / 100) + rhythm * (m.FLAT_PER_DAY + lvl('monk_breath') * m.BREATH_FLAT_PER_DAY);
            const bonus = Math.floor((raw * (100 + lvl('monk_focus') * m.FOCUS_PERCENT)) / 100);
            finalXP = baseXP + bonus;
            bonusInfo = { type: 'MONK', details: `🧘 Rhythm ${rhythm}/${cap} +${bonus}`, classBonus: bonus };
            break;
        }

        case 'ARTISAN': {
            const a = CLASS_RULES.ARTISAN;
            const cap = a.MAX_PROGRESS + lvl('artisan_blueprint') * a.BLUEPRINT_CAP;
            const progress = Math.min(cap, Math.max(0, Number(user.artisan_progress) || 0) + (lvl('artisan_assembly') ? a.ASSEMBLY_STEP : 1));
            let bonus = progress * (a.XP_PER_PROGRESS + lvl('artisan_toolkit') * a.TOOLKIT_XP_PER_PROGRESS);
            const cleared = context.action === 'item_complete' && context.listCleared === true;
            if (cleared) {
                const clear = progress * a.CLEAR_XP_PER_PROGRESS;
                bonus += lvl('artisan_masterwork') ? Math.floor((clear * (100 + a.MASTERWORK_PERCENT)) / 100) : clear;
            }
            userUpdates.artisan_progress = cleared ? 0 : progress;
            finalXP = baseXP + bonus;
            bonusInfo = cleared
                ? { type: 'ARTISAN_CLEAR', details: `🛠️ Project complete! +${bonus}`, classBonus: bonus }
                : { type: 'ARTISAN', details: `🛠️ Project ${progress}/${cap} +${bonus}`, classBonus: bonus };
            break;
        }

        case 'RANGER': {
            const r = CLASS_RULES.RANGER;
            const dueDate = context.action === 'item_complete' && context.dueDate ? String(context.dueDate).slice(0, 10) : null;
            if (!dueDate) {
                finalXP = baseXP + r.OTHER_FLAT;
                bonusInfo = { type: 'RANGER', details: `🧭 Ranger +${r.OTHER_FLAT}`, classBonus: r.OTHER_FLAT };
                break;
            }
            const today = context.today ? String(context.today).slice(0, 10) : todayInZone(user.timezone, new Date(toMs(opts.now) ?? Date.now()));
            const daysEarly = daysBetween(today, dueDate);
            const dueTodayBonus = Math.floor((baseXP * r.DUE_TODAY_PERCENT) / 100) + (lvl('ranger_bullseye') ? r.BULLSEYE_FLAT : 0);
            let bonus = 0;
            if (daysEarly > 0) {
                const days = Math.min(daysEarly, r.MAX_EARLY_DAYS + (lvl('ranger_longsight') ? r.LONGSIGHT_DAYS : 0));
                bonus = Math.floor((baseXP * r.EARLY_PERCENT_PER_DAY * days) / 100) + days * (r.EARLY_FLAT_PER_DAY + lvl('ranger_scout') * r.SCOUT_FLAT_PER_DAY);
                bonusInfo = { type: 'RANGER_EARLY', details: `🧭 ${days}d early +${bonus}`, classBonus: bonus };
            } else if (daysEarly === 0) {
                bonus = dueTodayBonus;
                bonusInfo = { type: 'RANGER_DUE', details: `🧭 On the day +${bonus}`, classBonus: bonus };
            } else {
                bonus = lvl('ranger_secondwind') ? Math.floor((dueTodayBonus * r.SECOND_WIND_PERCENT) / 100) : 0;
                bonusInfo = { type: 'RANGER_LATE', details: bonus ? `🧭 Late +${bonus}` : '🧭 Overdue', classBonus: bonus };
            }
            finalXP = baseXP + bonus;
            break;
        }

        case 'NECROMANCER': {
            const n = CLASS_RULES.NECROMANCER;
            const revive = context.action === 'item_complete' && Number(context.overdueDays) > 0;
            const cap = n.MAX_SOULS + (lvl('necro_jar') ? n.JAR_SOULS : 0);
            const souls = Math.min(cap, Math.max(0, Number(user.necro_souls) || 0) + (revive ? 1 : 0));
            userUpdates.necro_souls = souls;
            const soulBonus = Math.floor((baseXP * souls * (n.SOUL_PERCENT + lvl('necro_siphon') * n.SIPHON_PERCENT)) / 100);
            let reviveBonus = 0;
            if (revive) {
                reviveBonus = Math.floor((baseXP * n.REVIVE_PERCENT) / 100) + Math.min(n.REVIVE_OVERDUE_CAP, n.REVIVE_XP_PER_OVERDUE_DAY * Number(context.overdueDays));
                if (lvl('necro_ritual')) reviveBonus = Math.floor((reviveBonus * (100 + n.RITUAL_PERCENT)) / 100);
                if (lvl('necro_lich')) reviveBonus += souls * n.LICH_XP_PER_SOUL;
            }
            const bonus = soulBonus + reviveBonus;
            finalXP = baseXP + bonus;
            bonusInfo = revive
                ? { type: 'NECROMANCER_REVIVE', details: `💀 Revived! Souls ${souls}/${cap} +${bonus}`, classBonus: bonus }
                : { type: 'NECROMANCER', details: souls ? `💀 Souls ${souls}/${cap} +${bonus}` : '', classBonus: bonus };
            break;
        }

        case 'PALADIN': {
            const p = CLASS_RULES.PALADIN;
            const high = context.action === 'item_complete' && context.priority === 'HIGH';
            let bonus = high ? baseXP + p.HIGH_FLAT : p.OTHER_FLAT;
            if (high) bonus = Math.floor((bonus * (100 + lvl('paladin_smite') * p.SMITE_PERCENT)) / 100);
            bonus += lvl('paladin_aura') * p.AURA_FLAT;
            finalXP = baseXP + bonus;
            bonusInfo = { type: high ? 'PALADIN_VOW' : 'PALADIN', details: `⚜️ ${high ? 'Vow' : 'Paladin'} +${bonus}`, classBonus: bonus };
            break;
        }

        default:
            break;
    }

    return { finalXP, bonusInfo, userUpdates };
}

function tankStackCap(level, skills) {
    const absorb = toSkillMap(skills).get('tank_absorb') || 0;
    const t = CLASS_RULES.TANK;
    return Math.min(t.CAP_MAX, t.CAP_BASE + Math.floor(level / t.CAP_LEVELS_PER_STACK)) + absorb * 2;
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

    const { finalXP: classXP, bonusInfo, userUpdates } = calculateClassXP(user, baseXP, { skills, context, rng, now: opts.now });
    const bonuses = getSkillBonuses(skills);

    // Conditional multipliers that depend on class state after this action.
    let multiplier = bonuses.xpMultiplier + prestigeMultiplier(user);
    if (user.player_class === 'ASSASSIN' && lvl('assassin_execute') && userUpdates.assassin_stacks === CLASS_RULES.ASSASSIN.MAX_STACKS) {
        multiplier += 1.0;
    }
    if (user.player_class === 'TANK' && lvl('tank_revenge') && userUpdates.tank_stacks === tankStackCap(level, skills)) {
        multiplier += lvl('tank_revenge') * 0.10;
    }

    if (user.player_class === 'PALADIN' && lvl('paladin_crusade') && context.action === 'item_complete' && context.priority === 'HIGH') {
        multiplier += CLASS_RULES.PALADIN.CRUSADE_PERCENT / 100;
    }

    // Momentum: the live daily streak (0 once it has lapsed, until the next claim), counted up to a cap.
    multiplier += bonuses.momentumPerDay * Math.min(SKILL_RULES.MOMENTUM_MAX_DAYS, liveStreak(user, skills, opts.now));

    // Bleed: a crit makes the next few actions worth more, whatever class you play.
    const procs = [];
    let bleedLeft = Number(user.assassin_bleed) || 0;
    if (lvl('assassin_bleed') && bleedLeft > 0) {
        multiplier += CLASS_RULES.ASSASSIN.BLEED_BONUS_PERCENT / 100;
        bleedLeft -= 1;
        procs.push('🩸 Bleed');
    }

    let flat = bonuses.flatXPBonus;
    if (context.action === 'item_complete') {
        flat += lvl('archer_multishot') * 5;
        if (context.priority === 'HIGH') flat += bonuses.rallyXP;
        if (context.recurring) flat += bonuses.anchorXP;
    }

    // The epsilon keeps 100 * 1.15 (114.99999999999999 in floats) from losing a whole XP.
    let finalXP = Math.floor(classXP * multiplier + 1e-9) + flat;
    const skillBonus = finalXP - classXP;

    if (lvl('hero_champion') && level % 5 === 0) {
        finalXP *= 2;
        procs.push('👑 Champion x2');
    }

    let critBonus = 0;
    if (bonuses.critChance > 0 && rng() * 100 < bonuses.critChance) {
        critBonus = Math.floor(finalXP * (bonuses.critMultiplier - 1));
        finalXP += critBonus;
        if (lvl('assassin_bleed')) bleedLeft = CLASS_RULES.ASSASSIN.BLEED_ACTIONS;
    }
    if (lvl('assassin_bleed')) userUpdates.assassin_bleed = bleedLeft;

    if (bonuses.doubleChance > 0 && rng() * 100 < bonuses.doubleChance) {
        finalXP *= 2;
        procs.push('🎰 Double');
    }
    if (bonuses.jackpotChance > 0 && rng() * 100 < bonuses.jackpotChance) {
        finalXP *= 10;
        procs.push('💎 JACKPOT x10');
    }

    // Small actions never pay more than a few times their base, whatever the class and skills add.
    if (SMALL_ACTION_CAP.ACTIONS.includes(context.action)) finalXP = Math.min(finalXP, baseXP * SMALL_ACTION_CAP.MAX_MULTIPLE);

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
 *         | { eligible: true, newStreak, streakBroken, streakPreserved, freezeUsed, streakBonus,
 *             skillDailyBonus, xp: object, totalXP: number }}
 */
/** How long after a claim the streak survives: 48 h, 72 h with Streak Shield or as a Paladin, 96 h with Sanctuary. */
function streakWindowMs(user, bonuses) {
    const paladin = user.player_class === 'PALADIN';
    if (paladin && bonuses.paladinSanctuary) return DAILY.SANCTUARY_STREAK_WINDOW_MS;
    return bonuses.streakShield || paladin ? DAILY.SHIELDED_STREAK_WINDOW_MS : DAILY.STREAK_WINDOW_MS;
}

/**
 * The streak as it stands right now: the stored count while the next claim would still continue it (Unstoppable never
 * lapses), 0 once it has lapsed but nobody has claimed to reset it yet. `skills` is a skill list or the map from toSkillMap.
 */
function liveStreak(user, skills, now = Date.now()) {
    const count = Number(user.streak_count) || 0;
    const last = user.last_daily_claim ? new Date(user.last_daily_claim).getTime() : 0;
    if (!count) return 0;
    if (!last) return count; // no claim on record to measure a gap from
    const bonuses = getSkillBonuses(skills);
    const at = now === undefined || now === null ? Date.now() : new Date(now).getTime();
    return bonuses.streakUnstoppable || at - last <= streakWindowMs(user, bonuses) ? count : 0;
}

function calculateDailyReward(user, userSkills, now = Date.now(), opts = {}) {
    const lastClaim = user.last_daily_claim ? new Date(user.last_daily_claim).getTime() : 0;
    const since = now - lastClaim;
    const streak = Number(user.streak_count) || 0;

    if (lastClaim && since < DAILY.COOLDOWN_MS) {
        return { eligible: false, remainingMs: DAILY.COOLDOWN_MS - since, streak };
    }

    const bonuses = getSkillBonuses(userSkills);
    // Paladins always get the Shield window; Sanctuary stretches it further.
    const window = streakWindowMs(user, bonuses);

    let newStreak = 1;
    let streakBroken = false;
    let streakPreserved = false;
    let freezeUsed = false;
    let freezesUsed = 0;
    // One freeze covers one missed day: every started 24 h past the window needs its own.
    const missedDays = lastClaim ? Math.max(1, Math.ceil((since - window) / DAILY.COOLDOWN_MS)) : 0;
    if (lastClaim && since <= window) {
        newStreak = streak + 1;
    } else if (lastClaim && bonuses.streakUnstoppable) {
        newStreak = streak + 1;
        streakPreserved = true;
    } else if (lastClaim && streak > 1 && (Number(user.streak_freezes) || 0) >= missedDays) {
        // Bought streak freezes save the streak (the skill above is free, so it goes first), one per missed day.
        newStreak = streak + 1;
        streakPreserved = true;
        freezeUsed = true;
        freezesUsed = missedDays;
    } else if (lastClaim) {
        streakBroken = streak > 1;
    }

    const streakBonus = Math.min((newStreak - 1) * REWARDS.DAILY_STREAK_STEP, REWARDS.DAILY_STREAK_MAX_BONUS);
    const xp = calculateFinalXP(user, userSkills, REWARDS.DAILY_BASE, { ...opts, context: { action: 'daily' } });
    // Daily Surprise: a chance at a flat bonus (the rng is injectable for tests).
    const surpriseBonus = bonuses.dailySurprise && (opts.rng || secureRandom)() < SKILL_RULES.DAILY_SURPRISE_CHANCE ? SKILL_RULES.DAILY_SURPRISE_XP : 0;
    const totalXP = xp.finalXP + streakBonus + bonuses.dailyBonus + surpriseBonus;

    return {
        eligible: true,
        newStreak,
        streakBroken,
        streakPreserved,
        freezeUsed,
        freezesUsed,
        streakBonus,
        skillDailyBonus: bonuses.dailyBonus,
        surpriseBonus,
        xp,
        totalXP
    };
}

module.exports = {
    prestigeMultiplier,
    prestigeTitle,
    levelFromXP,
    levelProgress,
    toSkillMap,
    getSkillBonuses,
    getFreezeLimits,
    calculateClassXP,
    calculateFinalXP,
    calculateDailyReward,
    liveStreak,
    tankStackCap
};
