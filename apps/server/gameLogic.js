/**
 * 🎮 TASKQUEST WEB - GAME LOGIC
 * Classes, Skills, XP calculations
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  ⚔️ CLASSES
// ═══════════════════════════════════════════════════════════════════════════════

export const CLASSES = {
    DEFAULT: { name: 'Default', emoji: '⚪', cost: 0, description: 'No XP bonus. Balanced starter class.' },
    HERO: { name: 'Hero', emoji: '⚔️', cost: 500, description: '+25 XP on every action. Reliable and simple.' },
    GAMBLER: { name: 'Gambler', emoji: '🎲', cost: 300, description: 'RNG-based XP. High-risk, high-reward.' },
    ASSASSIN: { name: 'Assassin', emoji: '🗡️', cost: 400, description: 'XP streak mechanic. +5% per stack (max 10).' },
    WIZARD: { name: 'Wizard', emoji: '🔮', cost: 700, description: 'Spell combos + Wisdom scaling (+5 XP/level).' },
    ARCHER: { name: 'Archer', emoji: '🏹', cost: 600, description: 'Precision shot system with crits.' },
    TANK: { name: 'Tank', emoji: '🛡️', cost: 500, description: 'Shield momentum stacking. Strong early.' }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  🎯 CLASS XP CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateClassXP(user, baseXP) {
    let finalXP = baseXP;
    let bonusInfo = { type: 'DEFAULT', details: '', classBonus: 0 };
    const userUpdates = {};
    
    switch (user.player_class) {
        case 'DEFAULT':
            bonusInfo = { type: 'DEFAULT', details: '', classBonus: 0 };
            break;
            
        case 'HERO':
            finalXP += 25;
            bonusInfo = { type: 'HERO', details: '⚔️ Hero +25', classBonus: 25 };
            break;
            
        case 'GAMBLER': {
            const bonus = Math.floor(Math.random() * (baseXP + 100));
            const lose = Math.random() < 0.2;
            
            if (lose) {
                const lost = Math.min(bonus, baseXP - 1);
                finalXP = Math.max(1, baseXP - lost);
                bonusInfo = { type: 'GAMBLER_LOSS', details: `🎲 Bad luck -${lost}`, classBonus: -lost };
            } else {
                finalXP = baseXP + bonus;
                bonusInfo = { type: 'GAMBLER_WIN', details: `🎲 Lucky +${bonus}`, classBonus: bonus };
            }
            break;
        }
        
        case 'ASSASSIN': {
            const currentStreak = (user.assassin_streak || 0) + 1;
            userUpdates.assassin_streak = currentStreak;
            
            if (currentStreak >= 3) {
                const currentStacks = Math.min(10, (user.assassin_stacks || 0) + 1);
                userUpdates.assassin_stacks = currentStacks;
                
                const percentBonus = 5 * currentStacks;
                const bonusXP = Math.floor((baseXP * percentBonus) / 100);
                finalXP = baseXP + bonusXP;
                
                bonusInfo = { type: 'ASSASSIN', details: `🗡️ Stack ${currentStacks} +${bonusXP}`, classBonus: bonusXP };
            } else {
                bonusInfo = { type: 'ASSASSIN_BUILDING', details: `🗡️ Streak ${currentStreak}/3`, classBonus: 0 };
            }
            break;
        }
        
        case 'WIZARD': {
            const counter = (user.wizard_counter || 0) + 1;
            userUpdates.wizard_counter = counter >= 5 ? 0 : counter;
            
            const wisdomBonus = user.player_level * 5;
            
            if (counter % 5 === 0) {
                finalXP = baseXP + (wisdomBonus * 2);
                bonusInfo = { type: 'WIZARD_CRIT', details: `🔮 BURST +${wisdomBonus * 2}`, classBonus: wisdomBonus * 2 };
            } else if (counter % 3 === 0) {
                finalXP = baseXP + wisdomBonus;
                bonusInfo = { type: 'WIZARD_COMBO', details: `✨ Combo +${wisdomBonus}`, classBonus: wisdomBonus };
            } else {
                bonusInfo = { type: 'WIZARD_CHARGE', details: `🔮 Charge ${counter}/5`, classBonus: 0 };
            }
            break;
        }
        
        case 'ARCHER': {
            const hitChance = Math.min(97, 80 + (user.player_level * 0.5));
            const roll = Math.random() * 100;
            
            if (roll < hitChance) {
                const streak = Math.min(15, (user.archer_streak || 0) + 1);
                userUpdates.archer_streak = streak;
                
                const streakBonus = Math.floor((baseXP * (streak * 8)) / 100) + (3 + streak);
                finalXP = baseXP + streakBonus;
                let totalBonus = streakBonus;
                
                let details = `🎯 Hit x${streak} +${streakBonus}`;
                
                // Headshot check
                const headshotChance = Math.min(30, hitChance * 0.2);
                if (roll < headshotChance) {
                    const critBonus = (baseXP * 2) + (streak * 3);
                    finalXP += critBonus;
                    totalBonus += critBonus;
                    details += ` 💥+${critBonus}`;
                }
                
                // Perfect shot (5%)
                if (Math.random() < 0.05) {
                    const perfectBonus = (baseXP * 4) + (streak * 10);
                    finalXP += perfectBonus;
                    totalBonus += perfectBonus;
                    details += ` 🌟+${perfectBonus}`;
                }
                
                bonusInfo = { type: 'ARCHER_HIT', details, classBonus: totalBonus };
            } else {
                const streak = Math.max(0, (user.archer_streak || 0) - 2);
                userUpdates.archer_streak = streak;
                bonusInfo = { type: 'ARCHER_MISS', details: `💨 Miss! Streak: ${streak}`, classBonus: 0 };
            }
            break;
        }
        
        case 'TANK': {
            const stacks = (user.tank_stacks || 0) + 1;
            const maxStacks = Math.max(3, 20 - user.player_level);
            userUpdates.tank_stacks = Math.min(stacks, maxStacks);
            
            const percentBonus = Math.floor((baseXP * (userUpdates.tank_stacks * 4)) / 100);
            const flatBonus = Math.floor(userUpdates.tank_stacks / 2);
            const totalBonus = percentBonus + flatBonus;
            finalXP = baseXP + totalBonus;
            
            bonusInfo = { type: 'TANK', details: `🛡️ Shield x${userUpdates.tank_stacks} +${totalBonus}`, classBonus: totalBonus };
            break;
        }
    }
    
    return { finalXP, bonusInfo, userUpdates };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🌟 SKILL BONUSES
// ═══════════════════════════════════════════════════════════════════════════════

export function getSkillBonuses(userSkills) {
    const bonuses = {
        xpMultiplier: 1.0,
        flatXPBonus: 0,
        dailyBonus: 0,
        critChance: 0,
        luckBonus: 0,
        streakProtect: false
    };
    
    if (!userSkills || !userSkills.length) return bonuses;
    
    const skillMap = new Map(userSkills.map(s => [s.skill_id, s.skill_level]));
    
    // Default tree skills
    if (skillMap.has('default_xp_boost')) {
        bonuses.xpMultiplier += skillMap.get('default_xp_boost') * 0.05; // +5% per level
    }
    if (skillMap.has('default_daily_boost')) {
        bonuses.dailyBonus += skillMap.get('default_daily_boost') * 10; // +10 daily XP per level
    }
    if (skillMap.has('default_streak_shield')) {
        bonuses.streakProtect = true; // Protect streak on miss
    }
    
    // Hero tree skills
    if (skillMap.has('hero_valor')) {
        bonuses.flatXPBonus += skillMap.get('hero_valor') * 10; // +10 flat XP per level
    }
    if (skillMap.has('hero_inspire')) {
        bonuses.xpMultiplier += skillMap.get('hero_inspire') * 0.08; // +8% per level
    }
    if (skillMap.has('hero_legend')) {
        bonuses.xpMultiplier += 0.25; // +25% XP
    }
    
    // Gambler tree skills
    if (skillMap.has('gambler_lucky')) {
        bonuses.luckBonus += skillMap.get('gambler_lucky') * 5; // +5% luck per level
    }
    
    // Assassin tree skills
    if (skillMap.has('assassin_critical')) {
        bonuses.critChance += skillMap.get('assassin_critical') * 10; // +10% crit per level
    }
    
    // Archer tree skills
    if (skillMap.has('archer_aim')) {
        bonuses.xpMultiplier += skillMap.get('archer_aim') * 0.03; // +3% per level
    }
    
    // Tank tree skills
    if (skillMap.has('tank_fortify')) {
        bonuses.flatXPBonus += skillMap.get('tank_fortify') * 5; // +5 flat XP per level
    }
    
    // Wizard tree skills
    if (skillMap.has('wizard_study')) {
        bonuses.flatXPBonus += skillMap.get('wizard_study') * 3; // +3 flat XP per level
    }
    
    return bonuses;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🎯 APPLY ALL BONUSES - Returns full breakdown for toast
// ═══════════════════════════════════════════════════════════════════════════════

export function calculateFinalXP(user, userSkills, baseXP) {
    // Step 1: Apply class bonus
    const { finalXP: classXP, bonusInfo, userUpdates } = calculateClassXP(user, baseXP);
    
    // Step 2: Get skill bonuses
    const skillBonuses = getSkillBonuses(userSkills);
    
    // Step 3: Apply skill multiplier and flat bonus
    let finalXP = Math.floor(classXP * skillBonuses.xpMultiplier) + skillBonuses.flatXPBonus;
    
    // Track skill bonus for display
    const skillMultiplierBonus = Math.floor(classXP * skillBonuses.xpMultiplier) - classXP;
    const totalSkillBonus = skillMultiplierBonus + skillBonuses.flatXPBonus;
    
    // Step 4: Crit chance from skills
    let critBonus = 0;
    if (skillBonuses.critChance > 0 && Math.random() * 100 < skillBonuses.critChance) {
        critBonus = Math.floor(finalXP * 0.5);
        finalXP += critBonus;
    }
    
    // Build readable details string for toast
    const parts = [];
    parts.push(`Base: ${baseXP}`);
    
    if (bonusInfo.classBonus !== 0) {
        const sign = bonusInfo.classBonus > 0 ? '+' : '';
        parts.push(`${bonusInfo.details}`);
    }
    
    if (totalSkillBonus > 0) {
        parts.push(`📚 Skill +${totalSkillBonus}`);
    }
    
    if (critBonus > 0) {
        parts.push(`💥 Crit +${critBonus}`);
    }
    
    // Only show details if there are bonuses
    const hasBonus = bonusInfo.classBonus !== 0 || totalSkillBonus > 0 || critBonus > 0;
    const detailsString = hasBonus ? parts.join(' | ') : '';
    
    return {
        baseXP,
        finalXP,
        bonusInfo: {
            ...bonusInfo,
            details: detailsString,
            skillBonus: totalSkillBonus,
            critBonus,
            totalBonus: (bonusInfo.classBonus || 0) + totalSkillBonus + critBonus
        },
        userUpdates
    };
}
