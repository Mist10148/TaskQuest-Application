/**
 * TaskQuest shared game data.
 *
 * This file is the single source of truth for classes, skills, achievements,
 * rewards and limits. Both the Discord bot (apps/bot) and the web API
 * (apps/server) import it, so a balance change here applies everywhere.
 *
 * Everything exported from this module is plain JSON-serialisable data.
 */

'use strict';

// ─── Classes ──────────────────────────────────────────────────────────────────

const CLASSES = {
    DEFAULT: {
        name: 'Default',
        emoji: '⚪',
        cost: 0,
        description: 'No XP bonus. Balanced starter class.',
        playstyle: 'Standard XP gains with no modifiers.'
    },
    HERO: {
        name: 'Hero',
        emoji: '⚔️',
        cost: 500,
        description: '+25 flat XP on every action. Reliable and simple.',
        playstyle: 'Consistent bonus XP on everything.'
    },
    GAMBLER: {
        name: 'Gambler',
        emoji: '🎲',
        cost: 300,
        description: 'Each action rolls a random bonus of 0 to (base + 99) XP, but 20% of rolls are bad luck and shrink the reward instead (never below 1 XP).',
        playstyle: 'High variance. Big wins, occasional losses.'
    },
    ASSASSIN: {
        name: 'Assassin',
        emoji: '🗡️',
        cost: 400,
        description: 'From the 3rd consecutive action, gain one stack per action (max 10). Each stack adds +5% XP. Stacks reset when you change class.',
        playstyle: 'Rewards long, uninterrupted streaks of activity.'
    },
    WIZARD: {
        name: 'Wizard',
        emoji: '🔮',
        cost: 700,
        description: 'Wisdom = level × 5. Every 3rd action adds +Wisdom XP (Combo), every 5th action adds +2× Wisdom XP (Burst). The cycle then restarts.',
        playstyle: 'Scales with level. Strongest late game.'
    },
    ARCHER: {
        name: 'Archer',
        emoji: '🏹',
        cost: 600,
        description: 'Each action is a shot with a min(97%, 80% + 0.5% × level) hit chance. Hits build a streak (max 15) for bonus XP and can headshot or land a perfect shot; misses drop the streak by 2.',
        playstyle: 'Precision streaks with critical spikes.'
    },
    TANK: {
        name: 'Tank',
        emoji: '🛡️',
        cost: 500,
        description: 'Every action adds a shield stack (cap = max(3, 20 − level)). Each stack adds +4% XP plus +1 XP per two stacks.',
        playstyle: 'Strong early, steady momentum.'
    }
};

const CLASS_KEYS = Object.keys(CLASSES);
const PURCHASABLE_CLASS_KEYS = CLASS_KEYS.filter((k) => k !== 'DEFAULT');

/** users.owns_<class> column for a class key, or null for DEFAULT/unknown. */
function classOwnershipColumn(classKey) {
    return PURCHASABLE_CLASS_KEYS.includes(classKey) ? `owns_${classKey.toLowerCase()}` : null;
}

// ─── Skill trees ──────────────────────────────────────────────────────────────
// `effect` is a human-readable description of what ONE level does. The actual
// behaviour lives in xp.js (getSkillBonuses / calculateFinalXP) and
// progression code (daily streak protection). Skill costs are charged per level.

const SKILL_TREES = {
    DEFAULT: {
        name: 'Default',
        emoji: '⚪',
        description: 'Basic skills available to everyone',
        skills: {
            default_xp_boost: { name: 'Quick Learner', emoji: '📚', description: '+5% XP from all actions per level', maxLevel: 3, cost: 50, requires: null },
            default_daily_boost: { name: 'Early Bird', emoji: '🌅', description: '+10 daily reward XP per level', maxLevel: 2, cost: 75, requires: 'default_xp_boost' },
            default_streak_shield: { name: 'Streak Shield', emoji: '🛡️', description: 'Your daily streak survives one missed day (72h window instead of 48h)', maxLevel: 1, cost: 100, requires: 'default_daily_boost' }
        }
    },
    HERO: {
        name: 'Hero',
        emoji: '⚔️',
        description: 'Reliable XP gains',
        skills: {
            hero_valor: { name: 'Valor', emoji: '⚔️', description: '+10 flat XP per action per level', maxLevel: 3, cost: 100, requires: null },
            hero_inspire: { name: 'Inspire', emoji: '✨', description: '+8% XP per level', maxLevel: 2, cost: 150, requires: 'hero_valor' },
            hero_champion: { name: 'Champion', emoji: '👑', description: 'Double XP while your level is a multiple of 5', maxLevel: 1, cost: 200, requires: 'hero_inspire' },
            hero_legend: { name: 'Legendary', emoji: '🏆', description: '+25% XP on every action', maxLevel: 1, cost: 300, requires: 'hero_champion' }
        }
    },
    GAMBLER: {
        name: 'Gambler',
        emoji: '🎲',
        description: 'High risk, high reward',
        skills: {
            gambler_lucky: { name: 'Lucky Streak', emoji: '🍀', description: 'Gambler bad-luck chance −5% per level (20% → 5%)', maxLevel: 3, cost: 80, requires: null },
            gambler_double: { name: 'Double Down', emoji: '🎰', description: '10% chance per level to double the XP of an action', maxLevel: 2, cost: 120, requires: 'gambler_lucky' },
            gambler_safety: { name: 'Safety Net', emoji: '🪢', description: 'Gambler bad-luck losses are 25% smaller per level', maxLevel: 2, cost: 150, requires: 'gambler_double' },
            gambler_jackpot: { name: 'Jackpot', emoji: '💎', description: '1% chance for 10× XP on an action', maxLevel: 1, cost: 250, requires: 'gambler_safety' }
        }
    },
    ASSASSIN: {
        name: 'Assassin',
        emoji: '🗡️',
        description: 'Streaks and critical hits',
        skills: {
            assassin_swift: { name: 'Swift Strike', emoji: '💨', description: 'Assassin streak builds +1 faster per level', maxLevel: 3, cost: 90, requires: null },
            assassin_critical: { name: 'Critical Hit', emoji: '🎯', description: '+10% chance per level to crit for +50% XP', maxLevel: 2, cost: 130, requires: 'assassin_swift' },
            assassin_shadow: { name: 'Shadow Step', emoji: '🌑', description: 'Critical hits grant +100% XP instead of +50%', maxLevel: 1, cost: 180, requires: 'assassin_critical' },
            assassin_execute: { name: 'Execute', emoji: '☠️', description: '+100% XP while at 10/10 Assassin stacks', maxLevel: 1, cost: 280, requires: 'assassin_shadow' }
        }
    },
    WIZARD: {
        name: 'Wizard',
        emoji: '🔮',
        description: 'Spell combos and wisdom scaling',
        skills: {
            wizard_study: { name: 'Arcane Study', emoji: '📖', description: '+3 flat XP per action per level', maxLevel: 3, cost: 100, requires: null },
            wizard_combo: { name: 'Spell Combo', emoji: '🔥', description: 'Wizard Combo bonus +50% per level', maxLevel: 2, cost: 150, requires: 'wizard_study' },
            wizard_focus: { name: 'Focus', emoji: '🧘', description: '+10% XP per level', maxLevel: 2, cost: 200, requires: 'wizard_combo' },
            wizard_mastery: { name: 'Arcane Mastery', emoji: '🌟', description: 'Wizard Burst grants 3× Wisdom instead of 2×', maxLevel: 1, cost: 350, requires: 'wizard_focus' }
        }
    },
    ARCHER: {
        name: 'Archer',
        emoji: '🏹',
        description: 'Precision and critical strikes',
        skills: {
            archer_aim: { name: 'Steady Aim', emoji: '🎯', description: '+3% XP per level', maxLevel: 3, cost: 85, requires: null },
            archer_multishot: { name: 'Multishot', emoji: '🏹', description: '+5 XP per level when completing a task', maxLevel: 2, cost: 140, requires: 'archer_aim' },
            archer_piercing: { name: 'Piercing Shot', emoji: '💫', description: 'Archer misses no longer reduce your streak', maxLevel: 1, cost: 190, requires: 'archer_multishot' },
            archer_sniper: { name: 'Sniper', emoji: '🦅', description: 'Completing a task in a HIGH priority list is always a headshot (Archer)', maxLevel: 1, cost: 300, requires: 'archer_piercing' }
        }
    },
    TANK: {
        name: 'Tank',
        emoji: '🛡️',
        description: 'Slow but unstoppable momentum',
        skills: {
            tank_fortify: { name: 'Fortify', emoji: '🧱', description: '+5 flat XP per action per level', maxLevel: 3, cost: 95, requires: null },
            tank_absorb: { name: 'Absorb', emoji: '💪', description: '+2 Tank max shield stacks per level', maxLevel: 2, cost: 145, requires: 'tank_fortify' },
            tank_revenge: { name: 'Revenge', emoji: '⚡', description: '+10% XP per level while at max shield stacks', maxLevel: 2, cost: 200, requires: 'tank_absorb' },
            tank_unstoppable: { name: 'Unstoppable', emoji: '🚀', description: 'Your daily streak never resets; a missed day only pauses it', maxLevel: 1, cost: 320, requires: 'tank_revenge' }
        }
    }
};

/** Find a skill definition by id. Returns { treeKey, skill } or null. */
function findSkill(skillId) {
    if (typeof skillId !== 'string') return null;
    for (const [treeKey, tree] of Object.entries(SKILL_TREES)) {
        if (Object.prototype.hasOwnProperty.call(tree.skills, skillId)) {
            return { treeKey, skill: tree.skills[skillId] };
        }
    }
    return null;
}

// ─── Achievements ─────────────────────────────────────────────────────────────
// Union of the bot and web achievement sets. `BUY_CLASS` (old web key) was
// merged into `FIRST_CLASS` by migration 002.

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
    // Lifetime XP
    XP_100: { name: 'Novice', emoji: '🌱', description: 'Earn 100 lifetime XP', category: 'xp' },
    XP_500: { name: 'Apprentice', emoji: '📖', description: 'Earn 500 lifetime XP', category: 'xp' },
    XP_1000: { name: 'Journeyman', emoji: '🎒', description: 'Earn 1,000 lifetime XP', category: 'xp' },
    XP_5000: { name: 'Expert', emoji: '🔥', description: 'Earn 5,000 lifetime XP', category: 'xp' },
    XP_10000: { name: 'Master', emoji: '💎', description: 'Earn 10,000 lifetime XP', category: 'xp' },
    // Levels
    LEVEL_5: { name: 'Rising Star', emoji: '⭐', description: 'Reach level 5', category: 'levels' },
    LEVEL_10: { name: 'Veteran', emoji: '🌟', description: 'Reach level 10', category: 'levels' },
    LEVEL_25: { name: 'Elite', emoji: '💫', description: 'Reach level 25', category: 'levels' },
    LEVEL_50: { name: 'Legend', emoji: '🏆', description: 'Reach level 50', category: 'levels' },
    // Daily streaks
    STREAK_3: { name: 'On a Roll', emoji: '🔥', description: '3-day daily streak', category: 'streaks' },
    STREAK_7: { name: 'Week Warrior', emoji: '📅', description: '7-day daily streak', category: 'streaks' },
    STREAK_14: { name: 'Fortnight Fighter', emoji: '💪', description: '14-day daily streak', category: 'streaks' },
    STREAK_30: { name: 'Monthly Master', emoji: '🗓️', description: '30-day daily streak', category: 'streaks' },
    // Classes
    FIRST_CLASS: { name: 'Class Act', emoji: '🎭', description: 'Buy your first class', category: 'classes' },
    ALL_CLASSES: { name: 'Collector', emoji: '🎪', description: 'Own all classes', category: 'classes' },
    // Games
    FIRST_GAME: { name: 'Player One', emoji: '🎮', description: 'Finish your first game', category: 'games' },
    GAME_WIN_10: { name: 'Winner', emoji: '🥇', description: 'Win 10 games', category: 'games' },
    BLACKJACK: { name: 'Blackjack!', emoji: '🃏', description: 'Get a natural blackjack', category: 'games' },
    HIGH_ROLLER: { name: 'High Roller', emoji: '💰', description: 'Win 500+ XP in one game', category: 'games' }
};

// ─── Leveling ────────────────────────────────────────────────────────────────

const XP_PER_LEVEL = 100;

// ─── Rewards & limits ─────────────────────────────────────────────────────────

/** Base XP for actions, before class and skill modifiers. */
const REWARDS = {
    LIST_CREATE: 10,
    ITEM_ADD: 5,
    ITEM_COMPLETE: 10,
    DAILY_BASE: 100,
    DAILY_STREAK_STEP: 5,
    DAILY_STREAK_MAX_BONUS: 50,
    RPS_WIN: 10,
    HANGMAN_PER_LIFE: 10,
    HANGMAN_MIN: 10
};

/** Anti-farming limits (per user, per UTC day unless noted). */
const LIMITS = {
    /** Only the first N list creations per day award XP. */
    LIST_CREATE_REWARDS_PER_DAY: 10,
    /** Only the first N item additions per day award XP. */
    ITEM_ADD_REWARDS_PER_DAY: 50,
    /** Total XP that free games (RPS, Hangman, arcade) may award per day. */
    FREE_GAME_XP_PER_DAY: 500,
    /** Minimum time between two free-game rounds. */
    GAME_COOLDOWN_MS: 3000,
    /** Active game sessions expire (and refund escrowed bets) after this long. */
    GAME_SESSION_TTL_MINUTES: 30
};

const DAILY = {
    COOLDOWN_MS: 24 * 60 * 60 * 1000,
    STREAK_WINDOW_MS: 48 * 60 * 60 * 1000,
    SHIELDED_STREAK_WINDOW_MS: 72 * 60 * 60 * 1000
};

/** Maximum lengths, matching the database column sizes. */
const TEXT_LIMITS = {
    LIST_NAME: 100,
    ITEM_NAME: 200,
    CATEGORY: 50,
    DESCRIPTION: 1000
};

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

// ─── Games ────────────────────────────────────────────────────────────────────

const BLACKJACK_CONFIG = {
    MIN_BET: 10,
    MAX_BET_PERCENT: 0.25,
    HARD_CAP: 1000,
    BLACKJACK_MULTIPLIER: 1.5,
    WIN_MULTIPLIER: 1.0
};

const HANGMAN_CONFIG = {
    LIVES: 6
};

const HANGMAN_WORDS = [
    'APPLE', 'TABLE', 'CHAIR', 'PHONE', 'RIVER',
    'HOUSE', 'LIGHT', 'TRAIN', 'WATER', 'BREAD',
    'PAPER', 'MUSIC', 'HAPPY', 'DREAM', 'SMILE',
    'BEACH', 'CLOUD', 'DANCE', 'MONEY', 'CLOCK',
    'EARTH', 'FLOWER', 'GRASS', 'HORSE', 'JUICE',
    'CANDY', 'PIZZA', 'TIGER', 'WHALE', 'ZEBRA',
    'NIGHT', 'PIANO', 'STORM', 'QUEEN', 'MAGIC'
];

/**
 * Arcade games are played client-side (web only). The server only accepts a
 * score for a run it started, and caps how fast points can plausibly accrue.
 */
const ARCADE_CONFIG = {
    snake: { name: 'Snake', xpPerPoint: 2, maxXP: 100, maxPointsPerSecond: 2 },
    dino: { name: 'Dino Runner', xpPerPoint: 1, maxXP: 100, maxPointsPerSecond: 2 },
    invaders: { name: 'Space Invaders', xpPerPoint: 3, maxXP: 150, maxPointsPerSecond: 3 }
};

const GAME_TYPES = ['blackjack', 'rps', 'hangman', ...Object.keys(ARCADE_CONFIG)];

/** Terminal game session states stored in game_sessions.state. */
const GAME_STATES = ['active', 'won', 'lost', 'push', 'blackjack', 'expired', 'cancelled'];

module.exports = {
    CLASSES,
    CLASS_KEYS,
    PURCHASABLE_CLASS_KEYS,
    classOwnershipColumn,
    SKILL_TREES,
    findSkill,
    ACHIEVEMENTS,
    XP_PER_LEVEL,
    REWARDS,
    LIMITS,
    DAILY,
    TEXT_LIMITS,
    PRIORITIES,
    BLACKJACK_CONFIG,
    HANGMAN_CONFIG,
    HANGMAN_WORDS,
    ARCADE_CONFIG,
    GAME_TYPES,
    GAME_STATES
};
