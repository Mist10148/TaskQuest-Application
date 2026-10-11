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
        description: '+25 flat XP on every action (never more than 3× the base reward, so tiny actions stay small). Reliable and simple.',
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
        description: 'From the 3rd consecutive action, gain one stack per action (max 10). Each stack adds +5% XP. Stacks reset when you change class or after 36 hours without acting.',
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
        description: 'Every action adds a shield stack (cap = min(15, 3 + level ÷ 3), plus Absorb). Each stack adds +4% XP plus +1 XP per two stacks.',
        playstyle: 'Strong early, steady momentum.'
    },
    MONK: {
        name: 'Monk',
        emoji: '🧘',
        cost: 550,
        description: 'Rhythm: act on consecutive days to build Rhythm (max 14). Every action adds 3% of the base XP per Rhythm day plus 1 XP per Rhythm day. Skip a day and it restarts at 1.',
        playstyle: 'Rewards doing something small every single day.'
    },
    ARTISAN: {
        name: 'Artisan',
        emoji: '🛠️',
        cost: 650,
        description: 'Project: every action adds 1 progress (max 10) and pays +2 XP per progress. Finishing the last open task of a list that has at least 3 tasks completes the project: +5 XP per progress, then the progress resets.',
        playstyle: 'Rewards steady work and finishing whole lists.'
    },
    RANGER: {
        name: 'Ranger',
        emoji: '🧭',
        cost: 600,
        description: 'Deadline Hunter: finishing a task with a due date early pays 10% of the base XP plus 2 XP per day early (up to 7 days); due today pays 25% of the base; overdue pays nothing. Every other action gives +3 XP.',
        playstyle: 'Rewards planning ahead and finishing before the deadline.'
    },
    NECROMANCER: {
        name: 'Necromancer',
        emoji: '💀',
        cost: 600,
        description: 'Revive: completing an overdue task pays +150% of the base XP plus 3 XP per day overdue (max 30) and binds a soul (max 5). Every soul adds +5% of the base XP to every action.',
        playstyle: 'Turns neglected tasks into power.'
    },
    PALADIN: {
        name: 'Paladin',
        emoji: '⚜️',
        cost: 750,
        description: 'Vow: completing a HIGH priority task pays +100% of the base XP plus 10; every other action gives +5 XP. Your daily streak always has the Streak Shield window (72 hours) for free.',
        playstyle: 'Rewards taking on the hard tasks, and forgives a missed day.'
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
            default_streak_shield: { name: 'Streak Shield', emoji: '🛡️', description: 'Your daily streak survives one missed day (72h window instead of 48h)', maxLevel: 1, cost: 100, requires: 'default_daily_boost' },
            default_momentum: { name: 'Momentum', emoji: '🔥', description: '+0.5% XP per level for each day of your current daily streak (counted up to 10 days, so +15% at level 3)', maxLevel: 3, cost: 70, requires: 'default_xp_boost' },
            default_freeze_cache: { name: 'Freeze Cache', emoji: '🧊', description: 'Hold 5 streak freezes instead of 3, and each costs 120 XP instead of 150', maxLevel: 1, cost: 120, requires: 'default_streak_shield' },
            default_daily_surprise: { name: 'Daily Surprise', emoji: '🎁', description: 'Your daily reward has a 15% chance to add +50 XP', maxLevel: 1, cost: 140, requires: 'default_freeze_cache' }
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
            hero_legend: { name: 'Legendary', emoji: '🏆', description: '+25% XP on every action', maxLevel: 1, cost: 300, requires: 'hero_champion' },
            hero_oath: { name: 'Oath', emoji: '🛡️', description: 'Hero bonus becomes min(25 + level, 50), still capped at 3× the base reward (Hero)', maxLevel: 1, cost: 250, requires: 'hero_legend' },
            hero_rally: { name: 'Rally', emoji: '📣', description: '+15 flat XP when you complete a HIGH priority task', maxLevel: 1, cost: 220, requires: 'hero_oath' }
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
            gambler_jackpot: { name: 'Jackpot', emoji: '💎', description: '1% chance for 10× XP on an action', maxLevel: 1, cost: 250, requires: 'gambler_safety' },
            gambler_insurance: { name: 'Insurance', emoji: '🎟️', description: 'Bad luck can never cut a reward below 60% of the base XP (Gambler)', maxLevel: 1, cost: 200, requires: 'gambler_jackpot' },
            gambler_hothand: { name: 'Hot Hand', emoji: '🔁', description: 'After 3 lucky rolls in a row the next roll cannot be bad luck (Gambler)', maxLevel: 1, cost: 230, requires: 'gambler_insurance' }
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
            assassin_execute: { name: 'Execute', emoji: '☠️', description: '+100% XP while at 10/10 Assassin stacks', maxLevel: 1, cost: 280, requires: 'assassin_shadow' },
            assassin_nightowl: { name: 'Night Owl', emoji: '🌙', description: 'Your Assassin streak survives 48 hours of inactivity instead of 36 (Assassin)', maxLevel: 1, cost: 200, requires: 'assassin_execute' },
            assassin_bleed: { name: 'Bleed', emoji: '🩸', description: 'After a critical hit your next 3 actions get +20% XP', maxLevel: 1, cost: 240, requires: 'assassin_nightowl' }
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
            wizard_mastery: { name: 'Arcane Mastery', emoji: '🌟', description: 'Wizard Burst grants 3× Wisdom instead of 2×', maxLevel: 1, cost: 350, requires: 'wizard_focus' },
            wizard_overcharge: { name: 'Overcharge', emoji: '🕯️', description: 'After a Burst the Wizard cycle restarts at 2 charges instead of 0 (Wizard)', maxLevel: 1, cost: 300, requires: 'wizard_mastery' },
            wizard_tome: { name: 'Tome', emoji: '📚', description: 'Wisdom grows by 1 for every 20 tasks you have ever completed (Wizard)', maxLevel: 1, cost: 260, requires: 'wizard_overcharge' }
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
            archer_sniper: { name: 'Sniper', emoji: '🦅', description: 'Completing a task in a HIGH priority list is always a headshot (Archer)', maxLevel: 1, cost: 300, requires: 'archer_piercing' },
            archer_quiver: { name: 'Quiver', emoji: '🪶', description: '+3% Archer hit chance per level (still capped at 97%)', maxLevel: 2, cost: 150, requires: 'archer_sniper' },
            archer_eagle: { name: 'Eagle Eye', emoji: '🦉', description: 'Archer headshot chance ×1.5', maxLevel: 1, cost: 260, requires: 'archer_quiver' }
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
            tank_unstoppable: { name: 'Unstoppable', emoji: '🚀', description: 'Your daily streak never resets; a missed day only pauses it', maxLevel: 1, cost: 320, requires: 'tank_revenge' },
            tank_bulwark: { name: 'Bulwark', emoji: '🏰', description: 'Each action adds 2 Tank shield stacks instead of 1 (Tank)', maxLevel: 1, cost: 240, requires: 'tank_unstoppable' },
            tank_anchor: { name: 'Anchor', emoji: '⚓', description: '+8 flat XP when you complete a recurring task', maxLevel: 1, cost: 260, requires: 'tank_bulwark' }
        }
    },
    MONK: {
        name: 'Monk',
        emoji: '🧘',
        description: 'Daily rhythm and calm focus',
        skills: {
            monk_breath: { name: 'Steady Breath', emoji: '🌬️', description: '+1 XP per Rhythm day on every action, per level (Monk)', maxLevel: 3, cost: 120, requires: null },
            monk_focus: { name: 'Inner Focus', emoji: '🧠', description: 'Monk bonus +25% per level (Monk)', maxLevel: 2, cost: 180, requires: 'monk_breath' },
            monk_discipline: { name: 'Discipline', emoji: '🪷', description: 'Maximum Rhythm +4 (14 → 18) (Monk)', maxLevel: 1, cost: 260, requires: 'monk_focus' },
            monk_serenity: { name: 'Serenity', emoji: '☯️', description: 'Rhythm survives one missed day (Monk)', maxLevel: 1, cost: 340, requires: 'monk_discipline' }
        }
    },
    ARTISAN: {
        name: 'Artisan',
        emoji: '🛠️',
        description: 'Craft projects and finish lists',
        skills: {
            artisan_toolkit: { name: 'Toolkit', emoji: '🔧', description: '+1 XP per progress on every action, per level (Artisan)', maxLevel: 3, cost: 130, requires: null },
            artisan_blueprint: { name: 'Blueprint', emoji: '📐', description: 'Maximum progress +3 per level (10 → 16) (Artisan)', maxLevel: 2, cost: 190, requires: 'artisan_toolkit' },
            artisan_assembly: { name: 'Assembly Line', emoji: '🏭', description: 'Each action adds 2 progress instead of 1 (Artisan)', maxLevel: 1, cost: 280, requires: 'artisan_blueprint' },
            artisan_masterwork: { name: 'Masterwork', emoji: '🏆', description: 'Completing a project pays +50% more (Artisan)', maxLevel: 1, cost: 360, requires: 'artisan_assembly' }
        }
    },
    RANGER: {
        name: 'Ranger',
        emoji: '🧭',
        description: 'Deadlines and foresight',
        skills: {
            ranger_scout: { name: 'Scout', emoji: '🔭', description: '+2 XP per day early on early completions, per level (Ranger)', maxLevel: 3, cost: 130, requires: null },
            ranger_longsight: { name: 'Long Sight', emoji: '🗺️', description: 'The early bonus counts up to 10 days instead of 7 (Ranger)', maxLevel: 1, cost: 220, requires: 'ranger_scout' },
            ranger_bullseye: { name: 'Bullseye', emoji: '🎯', description: '+10 XP when you complete a task on its due date (Ranger)', maxLevel: 1, cost: 280, requires: 'ranger_longsight' },
            ranger_secondwind: { name: 'Second Wind', emoji: '🌅', description: 'Overdue completions pay half the due-today bonus (Ranger)', maxLevel: 1, cost: 330, requires: 'ranger_bullseye' }
        }
    },
    NECROMANCER: {
        name: 'Necromancer',
        emoji: '💀',
        description: 'Revive overdue work, collect souls',
        skills: {
            necro_siphon: { name: 'Siphon', emoji: '🫧', description: 'Each soul adds +2% more XP per level (Necromancer)', maxLevel: 3, cost: 130, requires: null },
            necro_jar: { name: 'Soul Jar', emoji: '🏺', description: 'Hold up to 8 souls instead of 5 (Necromancer)', maxLevel: 1, cost: 210, requires: 'necro_siphon' },
            necro_ritual: { name: 'Dark Ritual', emoji: '🕯️', description: 'Reviving pays +50% more (Necromancer)', maxLevel: 1, cost: 280, requires: 'necro_jar' },
            necro_lich: { name: 'Lichdom', emoji: '☠️', description: 'Reviving also pays +3 XP per soul you hold (Necromancer)', maxLevel: 1, cost: 350, requires: 'necro_ritual' }
        }
    },
    PALADIN: {
        name: 'Paladin',
        emoji: '⚜️',
        description: 'Oaths, high priorities and a forgiving streak',
        skills: {
            paladin_aura: { name: 'Holy Aura', emoji: '✨', description: '+2 XP on every action per level (Paladin)', maxLevel: 3, cost: 140, requires: null },
            paladin_smite: { name: 'Smite', emoji: '⚔️', description: 'The HIGH priority Vow bonus is +25% larger per level (Paladin)', maxLevel: 2, cost: 210, requires: 'paladin_aura' },
            paladin_crusade: { name: 'Crusade', emoji: '📯', description: '+20% XP when you complete a HIGH priority task (Paladin)', maxLevel: 1, cost: 290, requires: 'paladin_smite' },
            paladin_sanctuary: { name: 'Sanctuary', emoji: '🏛️', description: 'Your daily streak survives two missed days (96h window) (Paladin)', maxLevel: 1, cost: 350, requires: 'paladin_crusade' }
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
    ALL_CLASSES: { name: 'Collector', emoji: '🎪', description: 'Own every class', category: 'classes' },
    // Games
    FIRST_GAME: { name: 'Player One', emoji: '🎮', description: 'Finish your first game', category: 'games' },
    GAME_WIN_10: { name: 'Winner', emoji: '🥇', description: 'Win 10 games', category: 'games' },
    BLACKJACK: { name: 'Blackjack!', emoji: '🃏', description: 'Get a natural blackjack', category: 'games' },
    HIGH_ROLLER: { name: 'High Roller', emoji: '💰', description: 'Win 500+ XP in one game', category: 'games' },
    // Spending (classes, skills and streak freezes)
    SPEND_1000: { name: 'Big Spender', emoji: '🛍️', description: 'Spend 1,000 XP on classes, skills and upgrades', category: 'economy' },
    SPEND_5000: { name: 'Investor', emoji: '📈', description: 'Spend 5,000 XP on classes, skills and upgrades', category: 'economy' },
    SPEND_10000: { name: 'Tycoon', emoji: '🏦', description: 'Spend 10,000 XP on classes, skills and upgrades', category: 'economy' }
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
    HANGMAN_MIN: 10,
    // Bonus XP sources: flat amounts, no class or skill modifiers, each with its own cap in LIMITS.
    FIRST_OF_DAY: 10,
    LIST_CLEARED: 25,
    EARLY_FINISH_PER_DAY: 5,
    OVERDUE_CLEAR: 10,
    SUBTASKS_DONE: 10,
    ACHIEVEMENT: 25,
    HABIT_PER_STREAK: 2,
    HABIT_MIN_STREAK: 2
};

/** How early (in days) a repeating task may be finished and still continue its habit streak: under one period. */
const HABIT_PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 28 };

/** Streak milestones: the daily claim that reaches the day pays the chest once per streak run. */
const STREAK_CHESTS = { 7: 100, 14: 250, 30: 600 };

/**
 * Bonuses paid on top of a task's first completion. The key is the xp_transactions source; UIs
 * show `label` next to the XP in the completion result's `bonuses` list.
 */
const BONUS_LABELS = {
    first_of_day: 'First task of the day',
    list_cleared: 'List cleared',
    early_finish: 'Finished early',
    overdue_clear: 'Overdue cleared',
    subtasks_done: 'All subtasks done',
    streak_chest: 'Streak chest',
    achievement_reward: 'Achievement reward',
    habit_bonus: 'Habit streak'
};

/**
 * Daily and weekly quests. `metric` names a progress query in db/quests.js; rewards are flat XP
 * (no class or skill modifiers) and each quest can be claimed once per period.
 */
const QUESTS = {
    DAILY_COMPLETE_3: { name: 'Daily Grind', emoji: '⚒️', description: 'Complete 3 tasks today', period: 'daily', metric: 'completions', target: 3, reward: 30 },
    DAILY_HIGH_1: { name: 'Heavy Lifter', emoji: '🏋️', description: 'Complete a high-priority task today', period: 'daily', metric: 'high_completions', target: 1, reward: 25 },
    DAILY_ADD_3: { name: 'Planner', emoji: '🗒️', description: 'Add 3 tasks today', period: 'daily', metric: 'adds', target: 3, reward: 15 },
    WEEKLY_COMPLETE_15: { name: 'Weekly Warrior', emoji: '🛡️', description: 'Complete 15 tasks this week', period: 'weekly', metric: 'completions', target: 15, reward: 120 },
    WEEKLY_DAILY_5: { name: 'Regular', emoji: '📆', description: 'Claim your daily reward on 5 days this week', period: 'weekly', metric: 'daily_claims', target: 5, reward: 80 }
};

/** Leaderboard tabs. `weekly` counts XP earned since Monday from these sources (not bets or refunds). */
const LEADERBOARDS = ['lifetime', 'xp', 'streak', 'weekly'];
const WEEKLY_XP_SOURCES = [
    'list_create', 'item_add', 'item_complete', 'daily', 'game_reward', 'quest_reward',
    'first_of_day', 'list_cleared', 'early_finish', 'overdue_clear', 'subtasks_done', 'streak_chest',
    'achievement_reward', 'habit_bonus'
];

/** Streak freeze: a consumable that saves a daily streak that would otherwise break. */
const STREAK_FREEZE = { COST: 150, MAX: 3 };

/** Streak freezes with the Freeze Cache skill (default_freeze_cache). */
const STREAK_FREEZE_CACHE = { COST: 120, MAX: 5 };

/**
 * Tunable numbers behind classes and the conditional skills. xp.js reads them; docs/GAMEPLAY.md
 * tables them. Percentages are plain numbers (20 = 20%).
 */
const CLASS_RULES = {
    HERO: { FLAT: 25, MAX_BASE_MULTIPLE: 3, OATH_CAP: 50, RALLY_XP: 15 },
    GAMBLER: { LOSS_CHANCE: 0.2, MIN_LOSS_CHANCE: 0.05, INSURANCE_FLOOR: 0.6, HOT_HAND_STREAK: 3 },
    ASSASSIN: { DECAY_HOURS: 36, NIGHT_OWL_DECAY_HOURS: 48, MAX_STACKS: 10, BLEED_ACTIONS: 3, BLEED_BONUS_PERCENT: 20 },
    WIZARD: { OVERCHARGE_START: 2, TOME_TASKS_PER_WISDOM: 20 },
    ARCHER: { QUIVER_HIT_PERCENT: 3, EAGLE_HEADSHOT_MULTIPLIER: 1.5, MAX_HIT_CHANCE: 97 },
    TANK: { CAP_MAX: 15, CAP_BASE: 3, CAP_LEVELS_PER_STACK: 3, BULWARK_STACKS: 2, ANCHOR_XP: 8 },
    PALADIN: { HIGH_FLAT: 10, OTHER_FLAT: 5, AURA_FLAT: 2, SMITE_PERCENT: 25, CRUSADE_PERCENT: 20 },
    NECROMANCER: { MAX_SOULS: 5, REVIVE_PERCENT: 150, REVIVE_XP_PER_OVERDUE_DAY: 3, REVIVE_OVERDUE_CAP: 30, SOUL_PERCENT: 5, SIPHON_PERCENT: 2, JAR_SOULS: 3, RITUAL_PERCENT: 50, LICH_XP_PER_SOUL: 3 },
    RANGER: { MAX_EARLY_DAYS: 7, EARLY_PERCENT_PER_DAY: 10, EARLY_FLAT_PER_DAY: 2, DUE_TODAY_PERCENT: 25, OTHER_FLAT: 3, SCOUT_FLAT_PER_DAY: 2, LONGSIGHT_DAYS: 3, BULLSEYE_FLAT: 10, SECOND_WIND_PERCENT: 50 },
    ARTISAN: { MAX_PROGRESS: 10, XP_PER_PROGRESS: 2, CLEAR_XP_PER_PROGRESS: 5, MIN_LIST_SIZE: 3, TOOLKIT_XP_PER_PROGRESS: 1, BLUEPRINT_CAP: 3, ASSEMBLY_STEP: 2, MASTERWORK_PERCENT: 50 },
    MONK: { MAX_RHYTHM: 14, PERCENT_PER_DAY: 3, FLAT_PER_DAY: 1, BREATH_FLAT_PER_DAY: 1, FOCUS_PERCENT: 25, DISCIPLINE_CAP: 4 }
};

/** Numbers behind the default-tree skills. */
const SKILL_RULES = {
    MOMENTUM_PERCENT_PER_DAY: 0.5,
    MOMENTUM_MAX_DAYS: 10,
    DAILY_SURPRISE_CHANCE: 0.15,
    DAILY_SURPRISE_XP: 50
};

/** xp_transactions sources that count as "spending" for xp_spent and the spending achievements. */
const SPEND_SOURCES = ['class_purchase', 'skill_purchase', 'streak_freeze'];

/** Anti-farming limits (per user, per UTC day unless noted). */
const LIMITS = {
    /** Only the first N list creations per day award XP. */
    LIST_CREATE_REWARDS_PER_DAY: 10,
    /** Only the first N item additions per day award XP. */
    ITEM_ADD_REWARDS_PER_DAY: 50,
    /** Only the first N task completions per day award XP (stops add/complete/delete loops). */
    ITEM_COMPLETE_REWARDS_PER_DAY: 50,
    /** LIST_CLEARED pays at most this many lists a day (and each list only once). */
    LIST_CLEARED_PER_DAY: 5,
    /** EARLY_FINISH never pays more than this per task (5 XP per day early). */
    EARLY_FINISH_MAX: 20,
    /** early_finish + overdue_clear share this many XP a day. */
    DEADLINE_BONUS_XP_PER_DAY: 100,
    /** subtasks_done pays at most this many XP a day (one parent). */
    SUBTASKS_DONE_XP_PER_DAY: 10,
    /** habit_bonus pays 2 XP per streak step, at most this per completion... */
    HABIT_MAX: 20,
    /** ...and at most this much a day. */
    HABIT_XP_PER_DAY: 60,
    /** Total XP that free games (RPS, Hangman, arcade) may award per day. */
    FREE_GAME_XP_PER_DAY: 500,
    /** Minimum time between two free-game rounds. */
    GAME_COOLDOWN_MS: 3000,
    /** Active game sessions expire (and refund escrowed bets) after this long. */
    GAME_SESSION_TTL_MINUTES: 30,
    /** Per-user storage quota enforced on import (lists/tasks already owned count). */
    MAX_LISTS_PER_USER: 200,
    MAX_ITEMS_PER_USER: 5000
};

const DAILY = {
    COOLDOWN_MS: 24 * 60 * 60 * 1000,
    STREAK_WINDOW_MS: 48 * 60 * 60 * 1000,
    SHIELDED_STREAK_WINDOW_MS: 72 * 60 * 60 * 1000,
    /** Paladin with the Sanctuary skill. */
    SANCTUARY_STREAK_WINDOW_MS: 96 * 60 * 60 * 1000
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
    BONUS_LABELS,
    HABIT_PERIOD_DAYS,
    STREAK_CHESTS,
    STREAK_FREEZE,
    STREAK_FREEZE_CACHE,
    CLASS_RULES,
    SKILL_RULES,
    SPEND_SOURCES,
    QUESTS,
    LEADERBOARDS,
    WEEKLY_XP_SOURCES,
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
