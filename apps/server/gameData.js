/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🎮 GAME DATA - Synced from Discord Bot v3.8.2
 *  ALL content must match Discord bot exactly
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  ⚔️ CLASSES (from bot/utils/gameLogic.js)
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
        playstyle: 'Variable 0.5x-2x XP on tasks. High risk, high reward!'
    },
    ASSASSIN: {
        name: 'Assassin',
        emoji: '🗡️',
        cost: 400,
        description: 'XP streak mechanic. +5% per stack (max 10).',
        playstyle: 'Streak bonuses stack multiplicatively.'
    },
    WIZARD: {
        name: 'Wizard',
        emoji: '🔮',
        cost: 700,
        description: 'Spell combos + Wisdom scaling (+5 XP/level).',
        playstyle: 'Every 3rd task grants 2x XP.'
    },
    ARCHER: {
        name: 'Archer',
        emoji: '🏹',
        cost: 600,
        description: 'Precision shot system with crits.',
        playstyle: 'Bonus XP for high priority and on-time tasks.'
    },
    TANK: {
        name: 'Tank',
        emoji: '🛡️',
        cost: 500,
        description: 'Shield momentum stacking. Strong early.',
        playstyle: 'Build stacks for massive XP bursts.'
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  🌳 SKILL TREES (from bot/utils/gameLogic.js)
//  NOTE: First tree is "Default" not "Novice"
// ═══════════════════════════════════════════════════════════════════════════════

const SKILL_TREES = {
    DEFAULT: {
        name: 'Default',
        description: 'Basic skills available to all classes',
        skills: {
            'default_xp_boost': {
                name: 'Quick Learner',
                emoji: '📚',
                description: '+5% XP from all sources',
                cost: 50,
                maxLevel: 3,
                effect: (level) => `+${level * 5}% XP`,
                requires: null
            },
            'default_daily_boost': {
                name: 'Early Bird',
                emoji: '🌅',
                description: '+10 bonus daily XP',
                cost: 75,
                maxLevel: 2,
                effect: (level) => `+${level * 10} daily XP`,
                requires: 'default_xp_boost'
            },
            'default_streak_shield': {
                name: 'Streak Shield',
                emoji: '🛡️',
                description: 'Protect streak on miss',
                cost: 100,
                maxLevel: 1,
                effect: () => '1 free miss/week',
                requires: 'default_daily_boost'
            }
        }
    },
    HERO: {
        name: 'Hero',
        description: 'Reliable XP gains, inspiring others',
        skills: {
            'hero_valor': {
                name: 'Valor',
                emoji: '⚔️',
                description: '+10 flat XP per action',
                cost: 100,
                maxLevel: 3,
                effect: (level) => `+${level * 10} XP`,
                requires: null
            },
            'hero_inspire': {
                name: 'Inspire',
                emoji: '✨',
                description: 'Bonus XP when helping others',
                cost: 150,
                maxLevel: 2,
                effect: (level) => `+${level * 15}% team XP`,
                requires: 'hero_valor'
            },
            'hero_champion': {
                name: 'Champion',
                emoji: '👑',
                description: 'Double XP on level milestones',
                cost: 200,
                maxLevel: 1,
                effect: () => '2x XP every 5 levels',
                requires: 'hero_inspire'
            },
            'hero_legend': {
                name: 'Legendary',
                emoji: '🏆',
                description: 'Permanent XP multiplier',
                cost: 300,
                maxLevel: 1,
                effect: () => '+25% all XP',
                requires: 'hero_champion'
            }
        }
    },
    GAMBLER: {
        name: 'Gambler',
        description: 'High risk, high reward playstyle',
        skills: {
            'gambler_lucky': {
                name: 'Lucky Streak',
                emoji: '🍀',
                description: 'Better RNG outcomes',
                cost: 80,
                maxLevel: 3,
                effect: (level) => `+${level * 5}% luck`,
                requires: null
            },
            'gambler_double': {
                name: 'Double Down',
                emoji: '🎰',
                description: 'Chance for double rewards',
                cost: 120,
                maxLevel: 2,
                effect: (level) => `${level * 10}% double chance`,
                requires: 'gambler_lucky'
            },
            'gambler_safety': {
                name: 'Safety Net',
                emoji: '🪢',
                description: 'Reduce maximum losses',
                cost: 150,
                maxLevel: 2,
                effect: (level) => `-${level * 20}% max loss`,
                requires: 'gambler_double'
            },
            'gambler_jackpot': {
                name: 'Jackpot',
                emoji: '💎',
                description: 'Rare massive payouts',
                cost: 250,
                maxLevel: 1,
                effect: () => '1% chance for 10x',
                requires: 'gambler_safety'
            }
        }
    },
    ASSASSIN: {
        name: 'Assassin',
        description: 'Streak-based damage dealer',
        skills: {
            'assassin_swift': {
                name: 'Swift Strike',
                emoji: '💨',
                description: 'Faster streak building',
                cost: 90,
                maxLevel: 3,
                effect: (level) => `+${level} streak/action`,
                requires: null
            },
            'assassin_critical': {
                name: 'Critical Hit',
                emoji: '🎯',
                description: 'Crit chance on tasks',
                cost: 130,
                maxLevel: 2,
                effect: (level) => `${level * 10}% crit (2x XP)`,
                requires: 'assassin_swift'
            },
            'assassin_shadow': {
                name: 'Shadow Step',
                emoji: '🌑',
                description: 'Preserve streak on fail',
                cost: 180,
                maxLevel: 1,
                effect: () => 'No streak loss on miss',
                requires: 'assassin_critical'
            },
            'assassin_execute': {
                name: 'Execute',
                emoji: '☠️',
                description: 'Massive bonus at max streak',
                cost: 280,
                maxLevel: 1,
                effect: () => '+100% XP at 10 streak',
                requires: 'assassin_shadow'
            }
        }
    },
    WIZARD: {
        name: 'Wizard',
        description: 'Spell combos and wisdom scaling',
        skills: {
            'wizard_study': {
                name: 'Arcane Study',
                emoji: '📖',
                description: 'XP scales with level',
                cost: 100,
                maxLevel: 3,
                effect: (level) => `+${level * 2} XP/level`,
                requires: null
            },
            'wizard_combo': {
                name: 'Spell Combo',
                emoji: '🔥',
                description: 'Chaining bonus XP',
                cost: 150,
                maxLevel: 2,
                effect: (level) => `${level}x combo multiplier`,
                requires: 'wizard_study'
            },
            'wizard_focus': {
                name: 'Focus',
                emoji: '🧘',
                description: 'Bonus XP for consecutive tasks',
                cost: 200,
                maxLevel: 2,
                effect: (level) => `+${level * 15}% focus bonus`,
                requires: 'wizard_combo'
            },
            'wizard_mastery': {
                name: 'Arcane Mastery',
                emoji: '🌟',
                description: 'Ultimate wisdom power',
                cost: 350,
                maxLevel: 1,
                effect: () => 'Triple every 10th action',
                requires: 'wizard_focus'
            }
        }
    },
    ARCHER: {
        name: 'Archer',
        description: 'Precision and critical strikes',
        skills: {
            'archer_aim': {
                name: 'Steady Aim',
                emoji: '🎯',
                description: 'Increased base accuracy',
                cost: 85,
                maxLevel: 3,
                effect: (level) => `+${level * 10}% precision`,
                requires: null
            },
            'archer_multishot': {
                name: 'Multishot',
                emoji: '🏹',
                description: 'Multiple task completion bonus',
                cost: 140,
                maxLevel: 2,
                effect: (level) => `+${level * 5} XP per extra task`,
                requires: 'archer_aim'
            },
            'archer_piercing': {
                name: 'Piercing Shot',
                emoji: '💫',
                description: 'Ignore XP penalties',
                cost: 190,
                maxLevel: 1,
                effect: () => 'No negative modifiers',
                requires: 'archer_multishot'
            },
            'archer_sniper': {
                name: 'Sniper',
                emoji: '🦅',
                description: 'Guaranteed crits on priority tasks',
                cost: 300,
                maxLevel: 1,
                effect: () => 'Auto-crit HIGH priority',
                requires: 'archer_piercing'
            }
        }
    },
    TANK: {
        name: 'Tank',
        description: 'Slow but unstoppable momentum',
        skills: {
            'tank_fortify': {
                name: 'Fortify',
                emoji: '🧱',
                description: 'Build defensive stacks',
                cost: 95,
                maxLevel: 3,
                effect: (level) => `+${level} stack cap`,
                requires: null
            },
            'tank_absorb': {
                name: 'Absorb',
                emoji: '💪',
                description: 'Convert damage to XP',
                cost: 145,
                maxLevel: 2,
                effect: (level) => `${level * 25}% damage→XP`,
                requires: 'tank_fortify'
            },
            'tank_revenge': {
                name: 'Revenge',
                emoji: '⚡',
                description: 'Bonus XP after losses',
                cost: 200,
                maxLevel: 2,
                effect: (level) => `+${level * 20}% after loss`,
                requires: 'tank_absorb'
            },
            'tank_unstoppable': {
                name: 'Unstoppable',
                emoji: '🚀',
                description: 'Cannot lose streak',
                cost: 320,
                maxLevel: 1,
                effect: () => 'Streak never resets',
                requires: 'tank_revenge'
            }
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  🏆 ACHIEVEMENTS (from bot/utils/gameLogic.js) - EXACT MATCH
// ═══════════════════════════════════════════════════════════════════════════════

const ACHIEVEMENTS = {
    // Lists
    FIRST_LIST: { name: 'Getting Started', description: 'Create your first list', emoji: '📋', category: 'lists' },
    FIVE_LISTS: { name: 'List Master', description: 'Create 5 lists', emoji: '📚', category: 'lists' },
    TEN_LISTS: { name: 'Organization Pro', description: 'Create 10 lists', emoji: '🗂️', category: 'lists' },
    
    // Items/Tasks
    FIRST_ITEM: { name: 'Task Beginner', description: 'Add your first item', emoji: '✏️', category: 'productivity' },
    TEN_ITEMS: { name: 'Busy Bee', description: 'Add 10 items', emoji: '🐝', category: 'productivity' },
    FIFTY_ITEMS: { name: 'Productivity Machine', description: 'Add 50 items', emoji: '⚙️', category: 'productivity' },
    HUNDRED_ITEMS: { name: 'Task Centurion', description: 'Add 100 items', emoji: '💯', category: 'productivity' },
    
    // Completions
    FIRST_COMPLETE: { name: 'First Victory', description: 'Complete your first item', emoji: '✅', category: 'completion' },
    TEN_COMPLETE: { name: 'Getting Things Done', description: 'Complete 10 items', emoji: '📈', category: 'completion' },
    FIFTY_COMPLETE: { name: 'Achievement Hunter', description: 'Complete 50 items', emoji: '🎯', category: 'completion' },
    HUNDRED_COMPLETE: { name: 'Completion Master', description: 'Complete 100 items', emoji: '🏅', category: 'completion' },
    
    // Streaks
    STREAK_3: { name: 'Consistent', description: '3 day streak', emoji: '🔥', category: 'streaks' },
    STREAK_7: { name: 'Week Warrior', description: '7 day streak', emoji: '⚡', category: 'streaks' },
    STREAK_14: { name: 'Fortnight Fighter', description: '14 day streak', emoji: '💪', category: 'streaks' },
    STREAK_30: { name: 'Monthly Dedication', description: '30 day streak', emoji: '📅', category: 'streaks' },
    
    // Levels
    LEVEL_5: { name: 'Rising Star', description: 'Reach level 5', emoji: '⭐', category: 'levels' },
    LEVEL_10: { name: 'Veteran', description: 'Reach level 10', emoji: '🎖️', category: 'levels' },
    LEVEL_25: { name: 'Elite', description: 'Reach level 25', emoji: '💎', category: 'levels' },
    LEVEL_50: { name: 'Legend', description: 'Reach level 50', emoji: '👑', category: 'levels' },
    
    // Classes
    BUY_CLASS: { name: 'Class Act', description: 'Purchase your first class', emoji: '🎭', category: 'classes' },
    ALL_CLASSES: { name: 'Collector', description: 'Own all classes', emoji: '🏆', category: 'classes' },
    
    // XP Milestones
    XP_1000: { name: 'XP Hunter', description: 'Earn 1,000 total XP', emoji: '💰', category: 'levels' },
    XP_5000: { name: 'XP Master', description: 'Earn 5,000 total XP', emoji: '💵', category: 'levels' },
    XP_10000: { name: 'XP Legend', description: 'Earn 10,000 total XP', emoji: '🤑', category: 'levels' }
};

// Check achievements for a user - EXACT logic from bot
function checkAchievements(user, unlockedKeys) {
    const newAchs = [];
    
    const check = (key, condition) => {
        if (!unlockedKeys.includes(key) && condition) {
            newAchs.push({ key, ...ACHIEVEMENTS[key] });
        }
    };
    
    // Lists - use total_lists_created from user record
    check('FIRST_LIST', (user.total_lists_created || 0) >= 1);
    check('FIVE_LISTS', (user.total_lists_created || 0) >= 5);
    check('TEN_LISTS', (user.total_lists_created || 0) >= 10);
    
    // Items - use total_items_added from user record
    check('FIRST_ITEM', (user.total_items_added || 0) >= 1);
    check('TEN_ITEMS', (user.total_items_added || 0) >= 10);
    check('FIFTY_ITEMS', (user.total_items_added || 0) >= 50);
    check('HUNDRED_ITEMS', (user.total_items_added || 0) >= 100);
    
    // Completions - use total_items_completed from user record
    check('FIRST_COMPLETE', (user.total_items_completed || 0) >= 1);
    check('TEN_COMPLETE', (user.total_items_completed || 0) >= 10);
    check('FIFTY_COMPLETE', (user.total_items_completed || 0) >= 50);
    check('HUNDRED_COMPLETE', (user.total_items_completed || 0) >= 100);
    
    // Streaks
    check('STREAK_3', (user.streak_count || 0) >= 3);
    check('STREAK_7', (user.streak_count || 0) >= 7);
    check('STREAK_14', (user.streak_count || 0) >= 14);
    check('STREAK_30', (user.streak_count || 0) >= 30);
    
    // Levels
    check('LEVEL_5', (user.player_level || 1) >= 5);
    check('LEVEL_10', (user.player_level || 1) >= 10);
    check('LEVEL_25', (user.player_level || 1) >= 25);
    check('LEVEL_50', (user.player_level || 1) >= 50);
    
    // Classes
    const ownsAny = user.owns_hero || user.owns_gambler || user.owns_assassin || user.owns_wizard || user.owns_archer || user.owns_tank;
    const ownsAll = user.owns_hero && user.owns_gambler && user.owns_assassin && user.owns_wizard && user.owns_archer && user.owns_tank;
    check('BUY_CLASS', ownsAny);
    check('ALL_CLASSES', ownsAll);
    
    // XP
    check('XP_1000', (user.player_xp || 0) >= 1000);
    check('XP_5000', (user.player_xp || 0) >= 5000);
    check('XP_10000', (user.player_xp || 0) >= 10000);
    
    return newAchs;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  🎮 GAME DATA (from bot/commands/game.js)
// ═══════════════════════════════════════════════════════════════════════════════

// Hangman words - exact match from Discord bot
const HANGMAN_WORDS = [
    'APPLE', 'TABLE', 'CHAIR', 'PHONE', 'RIVER',
    'HOUSE', 'LIGHT', 'TRAIN', 'WATER', 'BREAD',
    'PAPER', 'MUSIC', 'HAPPY', 'DREAM', 'SMILE',
    'BEACH', 'CLOUD', 'DANCE', 'MONEY', 'CLOCK',
    'EARTH', 'FLOWER', 'GRASS', 'HORSE', 'JUICE',
    'CANDY', 'PIZZA', 'TIGER', 'WHALE', 'ZEBRA',
    'NIGHT', 'PIANO', 'STORM', 'QUEEN', 'MAGIC'
];

// Blackjack config - exact match from Discord bot
const BLACKJACK_CONFIG = {
    MIN_BET: 10,
    MAX_BET_PERCENT: 0.25,  // 25% of balance
    HARD_CAP: 1000,
    BLACKJACK_MULTIPLIER: 1.5,  // 3:2 payout
    WIN_MULTIPLIER: 1.0
};

export { CLASSES, SKILL_TREES, ACHIEVEMENTS, checkAchievements, HANGMAN_WORDS, BLACKJACK_CONFIG };
