/**
 * 🎮 TASKQUEST BOT - GAME LOGIC v3.9
 * Classes, Skills, Achievements, XP Calculations
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  ⚔️ CLASSES - 7 unique playstyles
// ═══════════════════════════════════════════════════════════════════════════════

const CLASSES = {
    DEFAULT: {
        name: 'Default',
        emoji: '⚪',
        cost: 0,
        description: 'No XP bonus. Balanced starter class.',
        playstyle: 'Standard XP gains with no modifiers'
    },
    HERO: {
        name: 'Hero',
        emoji: '⚔️',
        cost: 500,
        description: '+25 XP on every action. Reliable and simple.',
        playstyle: 'Consistent bonus XP on everything'
    },
    GAMBLER: {
        name: 'Gambler',
        emoji: '🎲',
        cost: 300,
        description: 'RNG-based XP. High-risk, high-reward.',
        playstyle: 'Variable 0.5x-2x XP. High risk, high reward!'
    },
    ASSASSIN: {
        name: 'Assassin',
        emoji: '🗡️',
        cost: 400,
        description: 'XP streak mechanic. +5% per stack (max 10).',
        playstyle: 'Streak bonuses stack multiplicatively'
    },
    WIZARD: {
        name: 'Wizard',
        emoji: '🔮',
        cost: 700,
        description: 'Spell combos + Wisdom scaling (+5 XP/level).',
        playstyle: 'Every 3rd task grants bonus, every 5th = 2x'
    },
    ARCHER: {
        name: 'Archer',
        emoji: '🏹',
        cost: 600,
        description: 'Precision shot system with crits.',
        playstyle: 'Hit/miss mechanics with streak bonuses'
    },
    TANK: {
        name: 'Tank',
        emoji: '🛡️',
        cost: 500,
        description: 'Shield momentum stacking. Strong early.',
        playstyle: 'Build stacks for massive XP bursts'
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  📊 XP & LEVELING
// ═══════════════════════════════════════════════════════════════════════════════

const XP_PER_LEVEL = 100;

function calculateLevel(totalXP) {
    return Math.floor(totalXP / XP_PER_LEVEL) + 1;
}

function addXP(user, amount) {
    if (!user.gamification_enabled) {
        return { xpGained: 0, leveledUp: false, newLevel: user.player_level };
    }
    
    const oldLevel = user.player_level;
    user.player_xp += amount;
    user.player_level = calculateLevel(user.player_xp);
    
    return {
        xpGained: amount,
        leveledUp: user.player_level > oldLevel,
        oldLevel,
        newLevel: user.player_level
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🎯 CLASS XP CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

function calculateClassXP(user, baseXP) {
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
            user.assassin_streak = (user.assassin_streak || 0) + 1;
            userUpdates.assassin_streak = user.assassin_streak;
            
            if (user.assassin_streak >= 3) {
                if ((user.assassin_stacks || 0) < 10) {
                    user.assassin_stacks = (user.assassin_stacks || 0) + 1;
                    userUpdates.assassin_stacks = user.assassin_stacks;
                }
                
                const percentBonus = 5 * user.assassin_stacks;
                const bonusXP = Math.floor((baseXP * percentBonus) / 100);
                finalXP = baseXP + bonusXP;
                
                bonusInfo = { type: 'ASSASSIN', details: `🗡️ Stack ${user.assassin_stacks}/10 +${bonusXP}`, classBonus: bonusXP };
            } else {
                bonusInfo = { type: 'ASSASSIN_BUILDING', details: `🗡️ Streak ${user.assassin_streak}/3`, classBonus: 0 };
            }
            break;
        }
        
        case 'WIZARD': {
            user.wizard_counter = (user.wizard_counter || 0) + 1;
            userUpdates.wizard_counter = user.wizard_counter;
            
            const wisdomBonus = user.player_level * 5;
            
            if (user.wizard_counter % 5 === 0) {
                finalXP = baseXP + (wisdomBonus * 2);
                bonusInfo = { type: 'WIZARD_CRIT', details: `🔮 BURST +${wisdomBonus * 2}`, classBonus: wisdomBonus * 2 };
            } else if (user.wizard_counter % 3 === 0) {
                finalXP = baseXP + wisdomBonus;
                bonusInfo = { type: 'WIZARD_COMBO', details: `✨ Combo +${wisdomBonus}`, classBonus: wisdomBonus };
            } else {
                bonusInfo = { type: 'WIZARD_CHARGE', details: `🔮 Charge ${user.wizard_counter % 5}/5`, classBonus: 0 };
            }
            
            if (user.wizard_counter >= 5) {
                user.wizard_counter = 0;
                userUpdates.wizard_counter = 0;
            }
            break;
        }
        
        case 'ARCHER': {
            let hitChance = Math.min(97, 80 + (user.player_level * 0.5));
            const roll = Math.random() * 100;
            
            if (roll < hitChance) {
                user.archer_streak = Math.min(15, (user.archer_streak || 0) + 1);
                userUpdates.archer_streak = user.archer_streak;
                
                const streakBonus = Math.floor((baseXP * (user.archer_streak * 8)) / 100) + (3 + user.archer_streak);
                finalXP = baseXP + streakBonus;
                let totalBonus = streakBonus;
                
                let details = `🎯 Hit x${user.archer_streak} +${streakBonus}`;
                
                // Headshot check
                const headshotChance = Math.min(30, hitChance * 0.2);
                if (roll < headshotChance) {
                    const critBonus = (baseXP * 2) + (user.archer_streak * 3);
                    finalXP += critBonus;
                    totalBonus += critBonus;
                    details += ` 💥+${critBonus}`;
                }
                
                // Perfect shot (5%)
                if (Math.random() < 0.05) {
                    const perfectBonus = (baseXP * 4) + (user.archer_streak * 10);
                    finalXP += perfectBonus;
                    totalBonus += perfectBonus;
                    details += ` 🌟+${perfectBonus}`;
                }
                
                bonusInfo = { type: 'ARCHER_HIT', details, classBonus: totalBonus };
            } else {
                user.archer_streak = Math.max(0, (user.archer_streak || 0) - 2);
                userUpdates.archer_streak = user.archer_streak;
                bonusInfo = { type: 'ARCHER_MISS', details: `💨 Miss! Streak: ${user.archer_streak}`, classBonus: 0 };
            }
            break;
        }
        
        case 'TANK': {
            user.tank_stacks = (user.tank_stacks || 0) + 1;
            const maxStacks = Math.max(3, 20 - user.player_level);
            
            if (user.tank_stacks > maxStacks) user.tank_stacks = maxStacks;
            userUpdates.tank_stacks = user.tank_stacks;
            
            const percentBonus = Math.floor((baseXP * (user.tank_stacks * 4)) / 100);
            const flatBonus = Math.floor(user.tank_stacks / 2);
            const totalBonus = percentBonus + flatBonus;
            finalXP = baseXP + totalBonus;
            
            bonusInfo = { type: 'TANK', details: `🛡️ Shield x${user.tank_stacks} +${totalBonus}`, classBonus: totalBonus };
            break;
        }
    }
    
    return { finalXP, bonusInfo, userUpdates };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🔥 STREAKS
// ═══════════════════════════════════════════════════════════════════════════════

function updateStreak(user) {
    const today = new Date().toISOString().split('T')[0];
    
    if (!user.last_active_day) {
        return { streakUpdated: true, newStreak: 1, userUpdates: { streak_count: 1, last_active_day: today } };
    }
    
    const lastDate = new Date(user.last_active_day);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
        return { streakUpdated: false, newStreak: user.streak_count, userUpdates: {} };
    } else if (diffDays === 1) {
        const newStreak = user.streak_count + 1;
        return { streakUpdated: true, newStreak, increased: true, userUpdates: { streak_count: newStreak, last_active_day: today } };
    } else {
        return { streakUpdated: true, newStreak: 1, broken: true, userUpdates: { streak_count: 1, last_active_day: today } };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🏆 ACHIEVEMENTS (Personal)
// ═══════════════════════════════════════════════════════════════════════════════

const ACHIEVEMENTS = {
    // Lists
    FIRST_LIST: { name: 'Getting Started', emoji: '📋', description: 'Create your first list', category: 'lists' },
    FIVE_LISTS: { name: 'List Master', emoji: '📚', description: 'Create 5 lists', category: 'lists' },
    TEN_LISTS: { name: 'Organization Pro', emoji: '🗂️', description: 'Create 10 lists', category: 'lists' },
    // Items
    FIRST_ITEM: { name: 'Task Beginner', emoji: '✏️', description: 'Add your first task', category: 'productivity' },
    TEN_ITEMS: { name: 'Busy Bee', emoji: '🐝', description: 'Add 10 tasks', category: 'productivity' },
    FIFTY_ITEMS: { name: 'Task Master', emoji: '📝', description: 'Add 50 tasks', category: 'productivity' },
    HUNDRED_ITEMS: { name: 'Productivity King', emoji: '👑', description: 'Add 100 tasks', category: 'productivity' },
    // Completions
    FIRST_COMPLETE: { name: 'First Victory', emoji: '✅', description: 'Complete your first task', category: 'completions' },
    TEN_COMPLETE: { name: 'Getting Things Done', emoji: '🎯', description: 'Complete 10 tasks', category: 'completions' },
    FIFTY_COMPLETE: { name: 'Achiever', emoji: '⭐', description: 'Complete 50 tasks', category: 'completions' },
    HUNDRED_COMPLETE: { name: 'Completionist', emoji: '🏅', description: 'Complete 100 tasks', category: 'completions' },
    // XP Milestones
    XP_100: { name: 'Novice', emoji: '🌱', description: 'Earn 100 XP', category: 'xp' },
    XP_500: { name: 'Apprentice', emoji: '📖', description: 'Earn 500 XP', category: 'xp' },
    XP_1000: { name: 'Journeyman', emoji: '🎒', description: 'Earn 1,000 XP', category: 'xp' },
    XP_5000: { name: 'Expert', emoji: '🔥', description: 'Earn 5,000 XP', category: 'xp' },
    XP_10000: { name: 'Master', emoji: '💎', description: 'Earn 10,000 XP', category: 'xp' },
    // Levels
    LEVEL_5: { name: 'Rising Star', emoji: '⭐', description: 'Reach level 5', category: 'levels' },
    LEVEL_10: { name: 'Veteran', emoji: '🌟', description: 'Reach level 10', category: 'levels' },
    LEVEL_25: { name: 'Elite', emoji: '💫', description: 'Reach level 25', category: 'levels' },
    LEVEL_50: { name: 'Legend', emoji: '🏆', description: 'Reach level 50', category: 'levels' },
    // Streaks
    STREAK_3: { name: 'On a Roll', emoji: '🔥', description: '3-day daily streak', category: 'streaks' },
    STREAK_7: { name: 'Week Warrior', emoji: '📅', description: '7-day daily streak', category: 'streaks' },
    STREAK_30: { name: 'Monthly Master', emoji: '🗓️', description: '30-day daily streak', category: 'streaks' },
    // Classes
    FIRST_CLASS: { name: 'Class Act', emoji: '🎭', description: 'Buy your first class', category: 'classes' },
    ALL_CLASSES: { name: 'Collector', emoji: '🎪', description: 'Own all classes', category: 'classes' },
    // Games
    FIRST_GAME: { name: 'Player One', emoji: '🎮', description: 'Play your first game', category: 'games' },
    GAME_WIN_10: { name: 'Winner', emoji: '🏅', description: 'Win 10 games', category: 'games' },
    BLACKJACK: { name: 'Blackjack!', emoji: '🃏', description: 'Get a natural blackjack', category: 'games' },
    HIGH_ROLLER: { name: 'High Roller', emoji: '💰', description: 'Win 500+ XP in one game', category: 'games' }
};

async function checkAchievements(db, userId) {
    const user = await db.getUser(userId);
    const userAchievements = await db.getAchievements(userId);
    const unlockedKeys = userAchievements.map(a => a.achievement_key);
    const newUnlocks = [];
    
    const checks = [
        { key: 'FIRST_LIST', condition: user.lists_created >= 1 },
        { key: 'FIVE_LISTS', condition: user.lists_created >= 5 },
        { key: 'TEN_LISTS', condition: user.lists_created >= 10 },
        { key: 'FIRST_ITEM', condition: user.items_created >= 1 },
        { key: 'TEN_ITEMS', condition: user.items_created >= 10 },
        { key: 'FIFTY_ITEMS', condition: user.items_created >= 50 },
        { key: 'HUNDRED_ITEMS', condition: user.items_created >= 100 },
        { key: 'FIRST_COMPLETE', condition: user.items_completed >= 1 },
        { key: 'TEN_COMPLETE', condition: user.items_completed >= 10 },
        { key: 'FIFTY_COMPLETE', condition: user.items_completed >= 50 },
        { key: 'HUNDRED_COMPLETE', condition: user.items_completed >= 100 },
        { key: 'XP_100', condition: user.player_xp >= 100 },
        { key: 'XP_500', condition: user.player_xp >= 500 },
        { key: 'XP_1000', condition: user.player_xp >= 1000 },
        { key: 'XP_5000', condition: user.player_xp >= 5000 },
        { key: 'XP_10000', condition: user.player_xp >= 10000 },
        { key: 'LEVEL_5', condition: user.player_level >= 5 },
        { key: 'LEVEL_10', condition: user.player_level >= 10 },
        { key: 'LEVEL_25', condition: user.player_level >= 25 },
        { key: 'LEVEL_50', condition: user.player_level >= 50 },
        { key: 'STREAK_3', condition: user.daily_streak >= 3 },
        { key: 'STREAK_7', condition: user.daily_streak >= 7 },
        { key: 'STREAK_30', condition: user.daily_streak >= 30 },
        { key: 'FIRST_CLASS', condition: user.owns_hero || user.owns_gambler || user.owns_assassin || user.owns_wizard || user.owns_archer || user.owns_tank },
        { key: 'ALL_CLASSES', condition: user.owns_hero && user.owns_gambler && user.owns_assassin && user.owns_wizard && user.owns_archer && user.owns_tank }
    ];
    
    for (const check of checks) {
        if (check.condition && !unlockedKeys.includes(check.key)) {
            await db.unlockAchievement(userId, check.key);
            newUnlocks.push({ key: check.key, ...ACHIEVEMENTS[check.key] });
        }
    }
    
    return newUnlocks;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🌳 SKILL TREES - Each class has unique skills
// ═══════════════════════════════════════════════════════════════════════════════

const SKILL_TREES = {
    DEFAULT: {
        name: 'Default',
        emoji: '⚪',
        description: 'Basic skills available to all classes',
        skills: {
            default_xp_boost: { name: 'Quick Learner', emoji: '📚', description: '+5% XP from all sources', maxLevel: 3, cost: 50, requires: null },
            default_daily_boost: { name: 'Early Bird', emoji: '🌅', description: '+10 bonus daily XP', maxLevel: 2, cost: 75, requires: 'default_xp_boost' },
            default_streak_shield: { name: 'Streak Shield', emoji: '🛡️', description: 'Protect streak on miss', maxLevel: 1, cost: 100, requires: 'default_daily_boost' }
        }
    },
    HERO: {
        name: 'Hero',
        emoji: '⚔️',
        description: 'Reliable XP gains, inspiring others',
        skills: {
            hero_valor: { name: 'Valor', emoji: '⚔️', description: '+10 flat XP per action', maxLevel: 3, cost: 100, requires: null },
            hero_inspire: { name: 'Inspire', emoji: '✨', description: '+8% XP bonus', maxLevel: 2, cost: 150, requires: 'hero_valor' },
            hero_champion: { name: 'Champion', emoji: '👑', description: 'Double XP on level milestones', maxLevel: 1, cost: 200, requires: 'hero_inspire' },
            hero_legend: { name: 'Legendary', emoji: '🏆', description: '+25% permanent XP multiplier', maxLevel: 1, cost: 300, requires: 'hero_champion' }
        }
    },
    GAMBLER: {
        name: 'Gambler',
        emoji: '🎲',
        description: 'High risk, high reward playstyle',
        skills: {
            gambler_lucky: { name: 'Lucky Streak', emoji: '🍀', description: '+5% better RNG outcomes', maxLevel: 3, cost: 80, requires: null },
            gambler_double: { name: 'Double Down', emoji: '🎰', description: 'Chance for double rewards', maxLevel: 2, cost: 120, requires: 'gambler_lucky' },
            gambler_safety: { name: 'Safety Net', emoji: '🪢', description: 'Reduce maximum losses', maxLevel: 2, cost: 150, requires: 'gambler_double' },
            gambler_jackpot: { name: 'Jackpot', emoji: '💎', description: 'Rare massive payouts', maxLevel: 1, cost: 250, requires: 'gambler_safety' }
        }
    },
    ASSASSIN: {
        name: 'Assassin',
        emoji: '🗡️',
        description: 'Streak-based damage dealer',
        skills: {
            assassin_swift: { name: 'Swift Strike', emoji: '💨', description: 'Faster streak building', maxLevel: 3, cost: 90, requires: null },
            assassin_critical: { name: 'Critical Hit', emoji: '🎯', description: '+10% crit chance per level', maxLevel: 2, cost: 130, requires: 'assassin_swift' },
            assassin_shadow: { name: 'Shadow Step', emoji: '🌑', description: 'Preserve streak on fail', maxLevel: 1, cost: 180, requires: 'assassin_critical' },
            assassin_execute: { name: 'Execute', emoji: '☠️', description: 'Massive bonus at max streak', maxLevel: 1, cost: 280, requires: 'assassin_shadow' }
        }
    },
    WIZARD: {
        name: 'Wizard',
        emoji: '🔮',
        description: 'Spell combos and wisdom scaling',
        skills: {
            wizard_study: { name: 'Arcane Study', emoji: '📖', description: '+3 flat XP per level', maxLevel: 3, cost: 100, requires: null },
            wizard_combo: { name: 'Spell Combo', emoji: '🔥', description: 'Chaining bonus XP', maxLevel: 2, cost: 150, requires: 'wizard_study' },
            wizard_focus: { name: 'Focus', emoji: '🧘', description: 'Bonus XP for consecutive tasks', maxLevel: 2, cost: 200, requires: 'wizard_combo' },
            wizard_mastery: { name: 'Arcane Mastery', emoji: '🌟', description: 'Ultimate wisdom power', maxLevel: 1, cost: 350, requires: 'wizard_focus' }
        }
    },
    ARCHER: {
        name: 'Archer',
        emoji: '🏹',
        description: 'Precision and critical strikes',
        skills: {
            archer_aim: { name: 'Steady Aim', emoji: '🎯', description: '+3% XP per level', maxLevel: 3, cost: 85, requires: null },
            archer_multishot: { name: 'Multishot', emoji: '🏹', description: 'Multiple task completion bonus', maxLevel: 2, cost: 140, requires: 'archer_aim' },
            archer_piercing: { name: 'Piercing Shot', emoji: '💫', description: 'Ignore XP penalties', maxLevel: 1, cost: 190, requires: 'archer_multishot' },
            archer_sniper: { name: 'Sniper', emoji: '🦅', description: 'Guaranteed crits on priority tasks', maxLevel: 1, cost: 300, requires: 'archer_piercing' }
        }
    },
    TANK: {
        name: 'Tank',
        emoji: '🛡️',
        description: 'Slow but unstoppable momentum',
        skills: {
            tank_fortify: { name: 'Fortify', emoji: '🧱', description: '+5 flat XP per level', maxLevel: 3, cost: 95, requires: null },
            tank_absorb: { name: 'Absorb', emoji: '💪', description: 'Convert damage to XP', maxLevel: 2, cost: 145, requires: 'tank_fortify' },
            tank_revenge: { name: 'Revenge', emoji: '⚡', description: 'Bonus XP after losses', maxLevel: 2, cost: 200, requires: 'tank_absorb' },
            tank_unstoppable: { name: 'Unstoppable', emoji: '🚀', description: 'Cannot lose streak', maxLevel: 1, cost: 320, requires: 'tank_revenge' }
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  🌟 SKILL BONUSES - All 11 active skills
// ═══════════════════════════════════════════════════════════════════════════════

function getSkillBonuses(userSkills) {
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
    
    // Default tree
    if (skillMap.has('default_xp_boost')) {
        bonuses.xpMultiplier += skillMap.get('default_xp_boost') * 0.05; // +5% per level
    }
    if (skillMap.has('default_daily_boost')) {
        bonuses.dailyBonus += skillMap.get('default_daily_boost') * 10; // +10 daily XP per level
    }
    if (skillMap.has('default_streak_shield')) {
        bonuses.streakProtect = true;
    }
    
    // Hero tree
    if (skillMap.has('hero_valor')) {
        bonuses.flatXPBonus += skillMap.get('hero_valor') * 10; // +10 flat XP per level
    }
    if (skillMap.has('hero_inspire')) {
        bonuses.xpMultiplier += skillMap.get('hero_inspire') * 0.08; // +8% per level
    }
    if (skillMap.has('hero_legend')) {
        bonuses.xpMultiplier += 0.25; // +25% XP
    }
    
    // Gambler tree
    if (skillMap.has('gambler_lucky')) {
        bonuses.luckBonus += skillMap.get('gambler_lucky') * 5; // +5% luck per level
    }
    
    // Assassin tree
    if (skillMap.has('assassin_critical')) {
        bonuses.critChance += skillMap.get('assassin_critical') * 10; // +10% crit per level
    }
    
    // Archer tree
    if (skillMap.has('archer_aim')) {
        bonuses.xpMultiplier += skillMap.get('archer_aim') * 0.03; // +3% per level
    }
    
    // Tank tree
    if (skillMap.has('tank_fortify')) {
        bonuses.flatXPBonus += skillMap.get('tank_fortify') * 5; // +5 flat XP per level
    }
    
    // Wizard tree
    if (skillMap.has('wizard_study')) {
        bonuses.flatXPBonus += skillMap.get('wizard_study') * 3; // +3 flat XP per level
    }
    
    return bonuses;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🎯 CALCULATE FINAL XP - Class + Skills combined with breakdown
// ═══════════════════════════════════════════════════════════════════════════════

function calculateFinalXP(user, userSkills, baseXP) {
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
    
    // Build readable details string for embeds/toasts
    const parts = [];
    parts.push(`Base: ${baseXP}`);
    
    if (bonusInfo.classBonus !== 0) {
        parts.push(bonusInfo.details);
    }
    
    if (totalSkillBonus > 0) {
        parts.push(`📚 Skill +${totalSkillBonus}`);
    }
    
    if (critBonus > 0) {
        parts.push(`💥 Crit +${critBonus}`);
    }
    
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

module.exports = {
    CLASSES,
    SKILL_TREES,
    ACHIEVEMENTS,
    XP_PER_LEVEL,
    calculateLevel,
    addXP,
    updateStreak,
    calculateClassXP,
    getSkillBonuses,
    calculateFinalXP,
    checkAchievements
};
