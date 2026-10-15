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
        cost: 450,
        description: 'Each action rolls a random bonus of 0 to (2 x base + 40) XP, but 20% of rolls are bad luck and shrink the reward instead (never below 1 XP).',
        playstyle: 'High variance. Big wins, occasional losses.'
    },
    ASSASSIN: {
        name: 'Assassin',
        emoji: '🗡️',
        cost: 400,
        description: 'From the 3rd consecutive action, gain one stack per action (max 10). Each stack adds +7% XP. Stacks reset when you change class or after 48 hours without acting.',
        playstyle: 'Rewards long, uninterrupted streaks of activity.'
    },
    WIZARD: {
        name: 'Wizard',
        emoji: '🔮',
        cost: 700,
        description: 'Wisdom = level × 2. Every 3rd action adds +Wisdom XP (Combo), every 5th action adds +2× Wisdom XP (Burst). The cycle then restarts.',
        playstyle: 'Scales with level. Strongest late game.'
    },
    ARCHER: {
        name: 'Archer',
        emoji: '🏹',
        cost: 600,
        description: 'Each action is a shot with a min(97%, 80% + 0.5% × level) hit chance. Hits build a streak (max 15) for bonus XP (6% of the base per streak step) and can headshot or land a perfect shot (3%); misses drop the streak by 2.',
        playstyle: 'Precision streaks with critical spikes.'
    },
    TANK: {
        name: 'Tank',
        emoji: '🛡️',
        cost: 500,
        description: 'Every action adds a shield stack (cap = min(15, 5 + level ÷ 3), plus Absorb). Each stack adds +6% XP plus +1 XP per two stacks.',
        playstyle: 'Strong early, steady momentum.'
    },
    MONK: {
        name: 'Monk',
        emoji: '🧘',
        cost: 550,
        description: 'Rhythm: act on consecutive days to build Rhythm (max 14). Every action adds 2% of the base XP per Rhythm day plus 1 XP per Rhythm day. Skip a day and it restarts at 1.',
        playstyle: 'Rewards doing something small every single day.'
    },
    ARTISAN: {
        name: 'Artisan',
        emoji: '🛠️',
        cost: 650,
        description: 'Project: every action adds 1 progress (max 10) and pays +2 XP per progress. Finishing the last open task of a list that has at least 3 tasks completes the project: +6 XP per progress, and half of the progress is kept.',
        playstyle: 'Rewards steady work and finishing whole lists.'
    },
    RANGER: {
        name: 'Ranger',
        emoji: '🧭',
        cost: 600,
        description: 'Deadline Hunter: finishing a task with a due date early pays 10% of the base XP plus 2 XP per day early (up to 7 days); due today pays 25% of the base; overdue pays nothing. Every other action gives +5 XP.',
        playstyle: 'Rewards planning ahead and finishing before the deadline.'
    },
    NECROMANCER: {
        name: 'Necromancer',
        emoji: '💀',
        cost: 600,
        description: 'Revive: completing an overdue task pays +150% of the base XP plus 3 XP per day overdue (max 30) and binds a soul (max 5). Every 10th task you complete also binds a soul, and every soul adds +8% of the base XP to every action.',
        playstyle: 'Turns neglected tasks into power.'
    },
    PALADIN: {
        name: 'Paladin',
        emoji: '⚜️',
        cost: 600,
        description: 'Vow: completing a HIGH priority task pays +100% of the base XP plus 10; every other action gives +8 XP. Your daily streak always has the Streak Shield window (one missed day forgiven) for free.',
        playstyle: 'Rewards taking on the hard tasks, and forgives a missed day.'
    },
    BARD: {
        name: 'Bard',
        emoji: '🎵',
        cost: 600,
        description: 'Variety: finishing tasks from different lists in a row builds a medley. Every list beyond the first among your last 5 completions adds 4% of the base XP plus 3 XP. Every other action gives +2 XP.',
        playstyle: 'Rewards hopping between lists instead of grinding one.'
    },
    ALCHEMIST: {
        name: 'Alchemist',
        emoji: '⚗️',
        cost: 650,
        description: 'Brew: every task you complete adds its priority (LOW, MEDIUM, HIGH) to the brew and pays +2 XP per ingredient in it. Completing the third different priority finishes the brew: +150% of the base XP plus 15, and the brew starts over. Other actions give +2 XP.',
        playstyle: 'Rewards using every priority honestly.'
    },
    DRUID: {
        name: 'Druid',
        emoji: '🌿',
        cost: 600,
        description: 'Habits: finishing a repeating task pays 6% of the base XP plus 2 XP per step of its habit streak (up to 10 steps). Every other action gives +3 XP.',
        playstyle: 'Rewards steady habits.'
    },
    CHRONOMANCER: {
        name: 'Chronomancer',
        emoji: '⏳',
        cost: 650,
        description: 'Flow: the first 3 tasks you complete within 30 minutes after finishing a focus session pay +100% of the base XP plus 5. Every other action gives +2 XP.',
        playstyle: 'Rewards finishing tasks right after a focus session.'
    },
    WARDEN: {
        name: 'Warden',
        emoji: '🤝',
        cost: 600,
        description: 'Guard: finishing a task on a shared list pays 10% of the base XP plus 2 XP for every other person on that list (up to 5). Every other action gives +2 XP.',
        playstyle: 'Rewards working together on shared lists.'
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
            default_streak_shield: { name: 'Streak Shield', emoji: '🛡️', description: 'Your daily streak survives one missed day (a claim up to 2 days after the last one still continues it)', maxLevel: 1, cost: 100, requires: 'default_daily_boost' },
            default_momentum: { name: 'Momentum', emoji: '🔥', description: '+0.5% XP per level for each day of your current daily streak (counted up to 10 days, so +15% at level 3)', maxLevel: 3, cost: 70, requires: 'default_xp_boost' },
            default_freeze_cache: { name: 'Freeze Cache', emoji: '🧊', description: 'Hold 5 streak freezes instead of 3, and each costs 120 XP instead of 150', maxLevel: 1, cost: 120, requires: 'default_streak_shield' },
            default_daily_surprise: { name: 'Daily Surprise', emoji: '🎁', description: 'Your daily reward has a 15% chance to add +50 XP', maxLevel: 1, cost: 140, requires: 'default_freeze_cache' },
            default_scholar: { name: 'Scholar', emoji: '🎓', description: '+15% XP on the first task you complete each day', maxLevel: 1, cost: 90, requires: 'default_xp_boost' },
            default_nightshift: { name: 'Night Shift', emoji: '🌃', description: '+5% XP per level on actions between 21:00 and 05:00 (your time)', maxLevel: 2, cost: 80, requires: 'default_scholar' },
            default_tidymind: { name: 'Tidy Mind', emoji: '🧹', description: '+8 XP per level when your completion clears a list', maxLevel: 2, cost: 90, requires: 'default_momentum' }
        }
    },
    HERO: {
        name: 'Hero',
        emoji: '⚔️',
        description: 'Reliable XP gains',
        skills: {
            hero_valor: { name: 'Valor', emoji: '⚔️', description: '+10 flat XP per action per level', maxLevel: 3, cost: 100, requires: null },
            hero_inspire: { name: 'Inspire', emoji: '✨', description: '+8% XP per level', maxLevel: 2, cost: 150, requires: 'hero_valor' },
            hero_champion: { name: 'Champion', emoji: '👑', description: '+50% XP while your level is a multiple of 5 (Hero)', maxLevel: 1, cost: 200, requires: 'hero_inspire', classOnly: true },
            hero_legend: { name: 'Legendary', emoji: '🏆', description: '+15% XP on every action (Hero)', maxLevel: 1, cost: 300, requires: 'hero_champion', classOnly: true },
            hero_oath: { name: 'Oath', emoji: '🛡️', description: 'Hero bonus becomes min(25 + level, 50), still capped at 3× the base reward (Hero)', maxLevel: 1, cost: 250, requires: 'hero_legend' },
            hero_rally: { name: 'Rally', emoji: '📣', description: '+15 flat XP when you complete a HIGH priority task', maxLevel: 1, cost: 220, requires: 'hero_oath' },
            hero_laststand: { name: 'Last Stand', emoji: '🚩', description: '+20 flat XP when your completion clears a list', maxLevel: 1, cost: 260, requires: 'hero_rally' }
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
            gambler_hothand: { name: 'Hot Hand', emoji: '🔁', description: 'After 3 lucky rolls in a row the next roll cannot be bad luck (Gambler)', maxLevel: 1, cost: 230, requires: 'gambler_insurance' },
            gambler_loaded: { name: 'Loaded Dice', emoji: '🎯', description: 'Lucky rolls never roll below a quarter of the range (Gambler)', maxLevel: 1, cost: 260, requires: 'gambler_hothand' }
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
            assassin_nightowl: { name: 'Night Owl', emoji: '🌙', description: 'Your Assassin streak survives 72 hours of inactivity instead of 48 (Assassin)', maxLevel: 1, cost: 200, requires: 'assassin_execute' },
            assassin_bleed: { name: 'Bleed', emoji: '🩸', description: 'After a critical hit your next 3 actions get +20% XP', maxLevel: 1, cost: 240, requires: 'assassin_nightowl' },
            assassin_vanish: { name: 'Vanish', emoji: '🌫️', description: 'When the streak decays it halves instead of resetting (Assassin)', maxLevel: 1, cost: 260, requires: 'assassin_bleed' }
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
            wizard_tome: { name: 'Tome', emoji: '📚', description: 'Wisdom grows by 1 for every 20 tasks you have ever completed (Wizard)', maxLevel: 1, cost: 260, requires: 'wizard_overcharge' },
            wizard_cantrip: { name: 'Cantrip', emoji: '✨', description: 'The 2nd and 4th action of a cycle add a quarter of your Wisdom (Wizard)', maxLevel: 1, cost: 280, requires: 'wizard_tome' }
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
            archer_sniper: { name: 'Sniper', emoji: '🦅', description: 'Completing a HIGH-priority task (its own priority, else the priority of its list) is always a headshot (Archer)', maxLevel: 1, cost: 300, requires: 'archer_piercing' },
            archer_quiver: { name: 'Quiver', emoji: '🪶', description: '+3% Archer hit chance per level (still capped at 97%)', maxLevel: 2, cost: 150, requires: 'archer_sniper' },
            archer_eagle: { name: 'Eagle Eye', emoji: '🦉', description: 'Archer headshot chance ×1.5', maxLevel: 1, cost: 260, requires: 'archer_quiver' },
            archer_ricochet: { name: 'Ricochet', emoji: '🪃', description: 'Every hit adds +1 XP per streak step (Archer)', maxLevel: 1, cost: 280, requires: 'archer_eagle' }
        }
    },
    TANK: {
        name: 'Tank',
        emoji: '🛡️',
        description: 'Slow but unstoppable momentum',
        skills: {
            tank_fortify: { name: 'Fortify', emoji: '🧱', description: '+5 flat XP per action per level', maxLevel: 3, cost: 70, requires: null },
            tank_absorb: { name: 'Absorb', emoji: '💪', description: '+2 Tank max shield stacks per level', maxLevel: 2, cost: 145, requires: 'tank_fortify' },
            tank_revenge: { name: 'Revenge', emoji: '⚡', description: '+10% XP per level while at max shield stacks', maxLevel: 2, cost: 200, requires: 'tank_absorb' },
            tank_unstoppable: { name: 'Unstoppable', emoji: '🚀', description: 'Your daily streak never resets; a missed day only pauses it', maxLevel: 1, cost: 320, requires: 'tank_revenge' },
            tank_bulwark: { name: 'Bulwark', emoji: '🏰', description: 'Each action adds 2 Tank shield stacks instead of 1 (Tank)', maxLevel: 1, cost: 240, requires: 'tank_unstoppable' },
            tank_anchor: { name: 'Anchor', emoji: '⚓', description: '+8 flat XP when you complete a recurring task', maxLevel: 1, cost: 260, requires: 'tank_bulwark' },
            tank_taunt: { name: 'Taunt', emoji: '📢', description: 'Completing a HIGH priority task adds one extra shield stack (Tank)', maxLevel: 1, cost: 280, requires: 'tank_anchor' }
        }
    },
    MONK: {
        name: 'Monk',
        emoji: '🧘',
        description: 'Daily rhythm and calm focus',
        skills: {
            monk_breath: { name: 'Steady Breath', emoji: '🌬️', description: '+0.5 XP per Rhythm day on every action, per level (Monk)', maxLevel: 3, cost: 120, requires: null },
            monk_focus: { name: 'Inner Focus', emoji: '🧠', description: 'Monk bonus +15% per level (Monk)', maxLevel: 2, cost: 180, requires: 'monk_breath' },
            monk_discipline: { name: 'Discipline', emoji: '🪷', description: 'Maximum Rhythm +2 (14 → 16) (Monk)', maxLevel: 1, cost: 260, requires: 'monk_focus' },
            monk_serenity: { name: 'Serenity', emoji: '☯️', description: 'Rhythm survives one missed day (Monk)', maxLevel: 1, cost: 340, requires: 'monk_discipline' },
            monk_meditation: { name: 'Meditation', emoji: '🕯️', description: 'The first action of each new day pays double the Monk bonus (Monk)', maxLevel: 1, cost: 300, requires: 'monk_serenity' }
        }
    },
    ARTISAN: {
        name: 'Artisan',
        emoji: '🛠️',
        description: 'Craft projects and finish lists',
        skills: {
            artisan_toolkit: { name: 'Toolkit', emoji: '🔧', description: '+0.5 XP per progress on every action, per level (Artisan)', maxLevel: 3, cost: 130, requires: null },
            artisan_blueprint: { name: 'Blueprint', emoji: '📐', description: 'Maximum progress +3 per level (10 → 16) (Artisan)', maxLevel: 2, cost: 190, requires: 'artisan_toolkit' },
            artisan_assembly: { name: 'Assembly Line', emoji: '🏭', description: 'Each action adds 2 progress instead of 1 (Artisan)', maxLevel: 1, cost: 280, requires: 'artisan_blueprint' },
            artisan_masterwork: { name: 'Masterwork', emoji: '🏆', description: 'Completing a project pays +50% more (Artisan)', maxLevel: 1, cost: 360, requires: 'artisan_assembly' },
            artisan_prototype: { name: 'Prototype', emoji: '🧩', description: 'A finished project keeps 75% of its progress instead of 50% (Artisan)', maxLevel: 1, cost: 320, requires: 'artisan_masterwork' }
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
            ranger_secondwind: { name: 'Second Wind', emoji: '🌅', description: 'Overdue completions pay half the due-today bonus (Ranger)', maxLevel: 1, cost: 330, requires: 'ranger_bullseye' },
            ranger_tracker: { name: 'Tracker', emoji: '👣', description: 'Actions that are not early, on time or late pay +4 XP more (Ranger)', maxLevel: 1, cost: 240, requires: 'ranger_secondwind' }
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
            necro_lich: { name: 'Lichdom', emoji: '☠️', description: 'Reviving also pays +3 XP per soul you hold (Necromancer)', maxLevel: 1, cost: 350, requires: 'necro_ritual' },
            necro_souleater: { name: 'Soul Eater', emoji: '👻', description: 'A revive pays 25% more while you hold 3 or more souls (Necromancer)', maxLevel: 1, cost: 320, requires: 'necro_lich' }
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
            paladin_sanctuary: { name: 'Sanctuary', emoji: '🏛️', description: 'Your daily streak survives two missed days (a claim up to 3 days after the last one) (Paladin)', maxLevel: 1, cost: 350, requires: 'paladin_crusade' },
            paladin_aegis: { name: 'Aegis', emoji: '🔰', description: 'The +8 on non-HIGH actions is 50% larger (Paladin)', maxLevel: 1, cost: 300, requires: 'paladin_sanctuary' }
        }
    },
    BARD: {
        name: 'Bard',
        emoji: '🎵',
        description: 'Variety and medleys',
        skills: {
            bard_encore: { name: 'Encore', emoji: '🎶', description: '+1 XP per medley step on every completion, per level (Bard)', maxLevel: 3, cost: 110, requires: null },
            bard_harmony: { name: 'Harmony', emoji: '🎼', description: 'The medley looks at your last 7 completions instead of 5 (Bard)', maxLevel: 1, cost: 200, requires: 'bard_encore' },
            bard_crescendo: { name: 'Crescendo', emoji: '📯', description: '+25% Bard bonus when every task of the medley is from a different list (Bard)', maxLevel: 1, cost: 260, requires: 'bard_harmony' },
            bard_ballad: { name: 'Ballad', emoji: '🪕', description: 'The first task you complete each day counts as a full medley (Bard)', maxLevel: 1, cost: 300, requires: 'bard_crescendo' }
        }
    },
    ALCHEMIST: {
        name: 'Alchemist',
        emoji: '⚗️',
        description: 'Brews and transmutation',
        skills: {
            alch_catalyst: { name: 'Catalyst', emoji: '🧪', description: '+5 XP on a finished brew, per level (Alchemist)', maxLevel: 3, cost: 110, requires: null },
            alch_elixir: { name: 'Elixir', emoji: '🍶', description: 'Each ingredient in the brew pays +2 XP more (Alchemist)', maxLevel: 1, cost: 200, requires: 'alch_catalyst' },
            alch_transmute: { name: 'Transmute', emoji: '💎', description: 'A finished brew pays 50% more (Alchemist)', maxLevel: 1, cost: 260, requires: 'alch_elixir' },
            alch_distill: { name: 'Distill', emoji: '🫗', description: 'After a brew the next one starts with a MEDIUM ingredient already in it (Alchemist)', maxLevel: 1, cost: 300, requires: 'alch_transmute' }
        }
    },
    DRUID: {
        name: 'Druid',
        emoji: '🌿',
        description: 'Habits and seasons',
        skills: {
            druid_roots: { name: 'Roots', emoji: '🌱', description: '+1 XP per habit streak step on repeating tasks, per level (Druid)', maxLevel: 3, cost: 110, requires: null },
            druid_bloom: { name: 'Bloom', emoji: '🌸', description: 'The habit streak counts up to 15 steps instead of 10 (Druid)', maxLevel: 1, cost: 200, requires: 'druid_roots' },
            druid_seasons: { name: 'Seasons', emoji: '🍂', description: 'Weekly and monthly habits count their streak twice (Druid)', maxLevel: 1, cost: 260, requires: 'druid_bloom' },
            druid_grove: { name: 'Grove', emoji: '🌳', description: 'Every other action pays +3 XP more (Druid)', maxLevel: 1, cost: 300, requires: 'druid_seasons' }
        }
    },
    CHRONOMANCER: {
        name: 'Chronomancer',
        emoji: '⏳',
        description: 'Focus and flow',
        skills: {
            chrono_hourglass: { name: 'Hourglass', emoji: '⌛', description: '+5 XP on tasks completed in the flow, per level (Chronomancer)', maxLevel: 3, cost: 110, requires: null },
            chrono_dilation: { name: 'Time Dilation', emoji: '🕰️', description: 'The flow lasts 45 minutes after a focus session instead of 30 (Chronomancer)', maxLevel: 1, cost: 200, requires: 'chrono_hourglass' },
            chrono_echo: { name: 'Echo', emoji: '🔔', description: 'The flow covers 5 tasks instead of 3 (Chronomancer)', maxLevel: 1, cost: 260, requires: 'chrono_dilation' },
            chrono_surge: { name: 'Temporal Surge', emoji: '⚡', description: '+25% Chronomancer bonus when the task is also your first of the day (Chronomancer)', maxLevel: 1, cost: 300, requires: 'chrono_echo' }
        }
    },
    WARDEN: {
        name: 'Warden',
        emoji: '🤝',
        description: 'Shared lists and parties',
        skills: {
            warden_beacon: { name: 'Beacon', emoji: '🔦', description: '+2 XP per person on the list for tasks finished on a shared list, per level (Warden)', maxLevel: 3, cost: 110, requires: null },
            warden_wall: { name: 'Shield Wall', emoji: '🏰', description: 'Up to 8 people on the list count instead of 5 (Warden)', maxLevel: 1, cost: 200, requires: 'warden_beacon' },
            warden_rally: { name: 'Rally Cry', emoji: '🥁', description: '+25% Warden bonus on lists with 3 or more other people (Warden)', maxLevel: 1, cost: 260, requires: 'warden_wall' },
            warden_vigil: { name: 'Vigil', emoji: '🏮', description: '+15 XP when your completion clears a shared list (Warden)', maxLevel: 1, cost: 300, requires: 'warden_rally' }
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
    HABIT_MIN_STREAK: 2,
    FOCUS_XP_PER_MINUTE: 0.6,
    WEEKLY_REVIEW: 40,
    // Engagement sources (migration 024): flat, capped, no class or skill modifiers.
    PERFECT_DAY: 30,
    INBOX_ZERO: 40,
    BOSS_DEFEATED: 30,
    COMEBACK: 25,
    REFLECTION: 10,
    WEEKLY_GOAL_BASE: 10,
    WEEKLY_GOAL_PER_TASK: 2,
    PARTY_ASSIST: 3,
    ESTIMATE_ACCURACY: 10
};

/** quest_claims.quest_key under which the weekly review claim is stored. */
const WEEKLY_REVIEW_KEY = 'WEEKLY_REVIEW';

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
    habit_bonus: 'Habit streak',
    perfect_day: 'Perfect day',
    inbox_zero: 'Inbox zero',
    boss_defeated: 'Boss defeated',
    comeback: 'Welcome back',
    party_assist: 'Party assist',
    estimate_accuracy: 'Good estimate'
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
    WEEKLY_DAILY_5: { name: 'Regular', emoji: '📆', description: 'Claim your daily reward on 5 days this week', period: 'weekly', metric: 'daily_claims', target: 5, reward: 80 },
    // The rotating weekly pool: exactly one of these is live each ISO week (see ROTATING_QUESTS).
    WEEKLY_ROT_A: { name: 'Early Riser', emoji: '🌅', description: 'Finish 5 tasks before their due date', period: 'weekly', rotating: true, metric: 'early_completions', target: 5, reward: 60 },
    WEEKLY_ROT_B: { name: 'Tidy Up', emoji: '🧹', description: 'Clear 2 lists', period: 'weekly', rotating: true, metric: 'lists_cleared', target: 2, reward: 60 },
    WEEKLY_ROT_C: { name: 'Spring Cleaning', emoji: '🪣', description: 'Complete 10 overdue tasks', period: 'weekly', rotating: true, metric: 'overdue_completions', target: 10, reward: 80 },
    WEEKLY_ROT_D: { name: 'Planner Pro', emoji: '🗓️', description: 'Add 10 tasks with due dates', period: 'weekly', rotating: true, metric: 'dated_adds', target: 10, reward: 50 },
    BOSS_COMPLETE_50: { name: 'Monthly Boss', emoji: '🐉', description: 'Complete 50 tasks this month', period: 'monthly', metric: 'completions', target: 50, reward: 400 }
};

/** The rotating weekly quests in rotation order: ISO week number mod 4 picks the live one. */
const ROTATING_QUESTS = ['WEEKLY_ROT_A', 'WEEKLY_ROT_B', 'WEEKLY_ROT_C', 'WEEKLY_ROT_D'];

/**
 * Prestige: from MIN_LEVEL a player may start over (level, balance, classes and skills reset; achievements,
 * quest claims, tasks and the daily streak stay) for a permanent +BONUS_PERCENT% XP multiplier and a title.
 * PRESTIGE_TITLES[n] is the title for n prestiges (index 0: none).
 */
const PRESTIGE = { MIN_LEVEL: 30, MAX: 10, BONUS_PERCENT: 2, FLAT_PER_PRESTIGE: 1, CONFIRM: 'PRESTIGE' };
const PRESTIGE_TITLES = ['', 'Veteran', 'Seasoned', 'Champion', 'Elite', 'Master', 'Grandmaster', 'Legend', 'Mythic', 'Ascendant', 'Eternal'];

/** Leaderboard tabs. `weekly` counts XP earned since Monday from these sources (not bets or refunds). */
const LEADERBOARDS = ['lifetime', 'xp', 'streak', 'weekly'];
const WEEKLY_XP_SOURCES = [
    'list_create', 'item_add', 'item_complete', 'daily', 'game_reward', 'quest_reward',
    'first_of_day', 'list_cleared', 'early_finish', 'overdue_clear', 'subtasks_done', 'streak_chest',
    'achievement_reward', 'habit_bonus', 'focus_session', 'weekly_review', 'party_quest',
    'perfect_day', 'inbox_zero', 'boss_defeated', 'comeback', 'reflection', 'weekly_goal', 'party_assist', 'estimate_accuracy'
];

/**
 * The weekly modifier: each UTC ISO week (the same week for everyone, like the weekly board) doubles one flat bonus
 * source. The week number mod 4 picks it, so the four rotate. Daily caps still apply to the doubled amount.
 */
const SEASONS = [
    { key: 'early', name: 'Early-bird week', doubles: 'early_finish', blurb: 'Finishing early pays double.' },
    { key: 'cleanup', name: 'Cleanup week', doubles: 'overdue_clear', blurb: 'Clearing overdue tasks pays double.' },
    { key: 'habit', name: 'Habit week', doubles: 'habit_bonus', blurb: 'Habit streaks pay double.' },
    { key: 'tidy', name: 'Tidy week', doubles: 'list_cleared', blurb: 'Clearing a list pays double.' }
];

/** The streak-at-risk warning: only for streaks of at least MIN_STREAK days, once a day, from FROM_HOUR local time on. */
const STREAK_WARNING = { MIN_STREAK: 3, FROM_HOUR: 18 };

/** Streak freeze: a consumable that saves a daily streak that would otherwise break. */
const STREAK_FREEZE = { COST: 150, MAX: 3 };

/** Streak freezes with the Freeze Cache skill (default_freeze_cache). */
const STREAK_FREEZE_CACHE = { COST: 120, MAX: 5 };

/**
 * Tunable numbers behind classes and the conditional skills. xp.js reads them; docs/GAMEPLAY.md
 * tables them. Percentages are plain numbers (20 = 20%).
 */
const CLASS_RULES = {
    HERO: { LAST_STAND_XP: 20, FLAT: 25, MAX_BASE_MULTIPLE: 3, OATH_CAP: 50, RALLY_XP: 15, CHAMPION_MULTIPLIER: 1.5, LEGEND_PERCENT: 15 },
    GAMBLER: { BONUS_BASE_MULTIPLE: 2, BONUS_FLAT: 40, LOADED_FLOOR: 0.25, LOSS_CHANCE: 0.2, MIN_LOSS_CHANCE: 0.05, INSURANCE_FLOOR: 0.6, HOT_HAND_STREAK: 3 },
    ASSASSIN: { VANISH_KEEP_PERCENT: 50, DECAY_HOURS: 48, NIGHT_OWL_DECAY_HOURS: 72, STACK_PERCENT: 8, MAX_STACKS: 10, BLEED_ACTIONS: 3, BLEED_BONUS_PERCENT: 20 },
    WIZARD: { CANTRIP_PERCENT: 25, WISDOM_PER_LEVEL: 2, OVERCHARGE_START: 2, TOME_TASKS_PER_WISDOM: 20 },
    ARCHER: { RICOCHET_PER_STREAK: 1, QUIVER_HIT_PERCENT: 3, EAGLE_HEADSHOT_MULTIPLIER: 1.5, MAX_HIT_CHANCE: 97, STREAK_PERCENT: 6, HIT_FLAT: 2, HEADSHOT_BASE_MULTIPLE: 1.5, HEADSHOT_PER_STREAK: 2, PERFECT_CHANCE: 0.03, PERFECT_BASE_MULTIPLE: 3, PERFECT_PER_STREAK: 6 },
    TANK: { TAUNT_STACKS: 1, CAP_MAX: 15, CAP_BASE: 5, CAP_LEVELS_PER_STACK: 3, STACK_PERCENT: 7, BULWARK_STACKS: 2, ANCHOR_XP: 8 },
    PALADIN: { AEGIS_PERCENT: 50, HIGH_FLAT: 10, OTHER_FLAT: 8, AURA_FLAT: 3, SMITE_PERCENT: 25, CRUSADE_PERCENT: 20 },
    NECROMANCER: { SOUL_EATER_PERCENT: 25, SOUL_EATER_SOULS: 3, MAX_SOULS: 5, REVIVE_PERCENT: 150, REVIVE_XP_PER_OVERDUE_DAY: 3, REVIVE_OVERDUE_CAP: 30, SOUL_PERCENT: 8, SIPHON_PERCENT: 2, HARVEST_EVERY: 10, JAR_SOULS: 3, RITUAL_PERCENT: 50, LICH_XP_PER_SOUL: 3 },
    RANGER: { TRACKER_FLAT: 4, MAX_EARLY_DAYS: 7, EARLY_PERCENT_PER_DAY: 10, EARLY_FLAT_PER_DAY: 3, DUE_TODAY_PERCENT: 25, OTHER_FLAT: 5, SCOUT_FLAT_PER_DAY: 2, LONGSIGHT_DAYS: 3, BULLSEYE_FLAT: 10, SECOND_WIND_PERCENT: 50 },
    ARTISAN: { PROTOTYPE_KEEP_PERCENT: 75, MAX_PROGRESS: 10, XP_PER_PROGRESS: 2, CLEAR_XP_PER_PROGRESS: 6, CLEAR_KEEP_PERCENT: 50, MIN_LIST_SIZE: 3, TOOLKIT_XP_PER_PROGRESS: 0.5, BLUEPRINT_CAP: 3, ASSEMBLY_STEP: 2, MASTERWORK_PERCENT: 50 },
    MONK: { MEDITATION_MULTIPLIER: 2, MAX_RHYTHM: 14, PERCENT_PER_DAY: 2, FLAT_PER_DAY: 1, BREATH_FLAT_PER_DAY: 0.5, FOCUS_PERCENT: 15, DISCIPLINE_CAP: 2 },
    BARD: { WINDOW: 5, HARMONY_WINDOW: 7, PERCENT_PER_STEP: 4, FLAT_PER_STEP: 3, OTHER_FLAT: 2, ENCORE_PER_STEP: 1, CRESCENDO_PERCENT: 25 },
    ALCHEMIST: { STEP_FLAT: 2, BREW_PERCENT: 150, BREW_FLAT: 15, OTHER_FLAT: 2, CATALYST_FLAT: 5, ELIXIR_STEP: 2, TRANSMUTE_PERCENT: 50 },
    DRUID: { STREAK_CAP: 10, BLOOM_CAP_EXTRA: 5, PERCENT_PER_STEP: 6, FLAT_PER_STEP: 2, OTHER_FLAT: 3, ROOTS_PER_STEP: 1, SEASONS_MULTIPLIER: 2, GROVE_FLAT: 3 },
    CHRONOMANCER: { WINDOW_MINUTES: 30, DILATION_MINUTES: 45, WINDOW_COMPLETIONS: 3, ECHO_COMPLETIONS: 5, PERCENT: 100, FLAT: 5, OTHER_FLAT: 2, HOURGLASS_FLAT: 5, SURGE_PERCENT: 25 },
    WARDEN: { MEMBER_CAP: 5, WALL_EXTRA: 3, PERCENT_PER_MEMBER: 10, FLAT_PER_MEMBER: 2, OTHER_FLAT: 2, BEACON_PER_MEMBER: 2, RALLY_PERCENT: 25, RALLY_MEMBERS: 3, VIGIL_XP: 15 }
};

/**
 * Class and skill bonuses on small actions (adding a task, creating a list) are limited: the whole reward never
 * exceeds MAX_MULTIPLE x the base, like the Hero's own cap. Completions, the daily reward and games are not limited.
 */
const SMALL_ACTION_CAP = { ACTIONS: ['item_add', 'list_create'], MAX_MULTIPLE: 4 };

/** Numbers behind the default-tree skills. */
const SKILL_RULES = {
    SCHOLAR_PERCENT: 15,
    NIGHT_SHIFT_PERCENT: 5,
    NIGHT_SHIFT_FROM: 21,
    NIGHT_SHIFT_UNTIL: 5,
    TIDY_MIND_XP: 8,
    MOMENTUM_PERCENT_PER_DAY: 0.5,
    MOMENTUM_MAX_DAYS: 10,
    DAILY_SURPRISE_CHANCE: 0.15,
    DAILY_SURPRISE_XP: 50
};

/** xp_transactions sources that count as "spending" for xp_spent and the spending achievements. */
const SPEND_SOURCES = ['class_purchase', 'skill_purchase', 'streak_freeze', 'cosmetic_purchase'];

/**
 * Cosmetics: an XP sink with no gameplay effect. A title shows beside the name, a frame rings the avatar,
 * an accent colours the profile. Each costs XP once and is owned for good (kept through prestige, cleared
 * by a progress reset). `requires` makes a few of them earned first: { level }, { prestige } or { achievement }.
 * `color`: frames, a CSS background for the ring; accents, a hex readable as text on the light cards (colorDark: on the dark ones;
 * both pass 4.5:1, which lib/theme.test.ts in the web app checks).
 */
const COSMETIC_KINDS = ['title', 'frame', 'accent'];
const COSMETICS = {
    title_diligent: { kind: 'title', name: 'the Diligent', cost: 300 },
    title_taskbreaker: { kind: 'title', name: 'Taskbreaker', cost: 600, requires: { achievement: 'FIRST_COMPLETE' } },
    title_night_owl: { kind: 'title', name: 'Night Owl', cost: 400 },
    title_early_bird: { kind: 'title', name: 'Early Bird', cost: 400 },
    title_organiser: { kind: 'title', name: 'the Organiser', cost: 500, requires: { achievement: 'TEN_LISTS' } },
    title_relentless: { kind: 'title', name: 'the Relentless', cost: 1200, requires: { level: 20 } },
    title_completionist: { kind: 'title', name: 'Completionist', cost: 1500, requires: { achievement: 'HUNDRED_COMPLETE' } },
    title_reborn: { kind: 'title', name: 'the Reborn', cost: 2000, requires: { prestige: 1 } },
    frame_bronze: { kind: 'frame', name: 'Bronze ring', cost: 250, color: 'linear-gradient(135deg, #b8733a, #e9a766)' },
    frame_silver: { kind: 'frame', name: 'Silver ring', cost: 400, color: 'linear-gradient(135deg, #9aa4b2, #e3e8ef)' },
    frame_gold: { kind: 'frame', name: 'Gold ring', cost: 600, requires: { level: 10 }, color: 'linear-gradient(135deg, #c9951c, #f8dc7a)' },
    frame_aurora: { kind: 'frame', name: 'Aurora ring', cost: 750, requires: { level: 15 }, color: 'linear-gradient(135deg, #2dd4bf, #6366f1, #d946ef)' },
    frame_ember: { kind: 'frame', name: 'Ember ring', cost: 800, requires: { achievement: 'FIFTY_COMPLETE' }, color: 'linear-gradient(135deg, #ef4444, #f59e0b)' },
    frame_prestige: { kind: 'frame', name: 'Ascendant ring', cost: 1000, requires: { prestige: 1 }, color: 'linear-gradient(135deg, #7c3aed, #f0abfc, #7c3aed)' },
    accent_ocean: { kind: 'accent', name: 'Ocean', cost: 200, color: '#1d6fa5', colorDark: '#5bb0e6' },
    accent_forest: { kind: 'accent', name: 'Forest', cost: 200, color: '#2a7343', colorDark: '#5fc283' },
    accent_plum: { kind: 'accent', name: 'Plum', cost: 300, color: '#8a3fa0', colorDark: '#c58ad9' },
    accent_ember: { kind: 'accent', name: 'Ember', cost: 300, color: '#b8460f', colorDark: '#ee8a52' },
    accent_rose: { kind: 'accent', name: 'Rose', cost: 400, requires: { level: 5 }, color: '#b8305f', colorDark: '#ee7aa0' },
    accent_slate: { kind: 'accent', name: 'Slate', cost: 500, requires: { level: 10 }, color: '#4b5d78', colorDark: '#98aac6' }
};
/** users column holding the equipped cosmetic of each kind. */
const COSMETIC_COLUMNS = { title: 'equipped_title', frame: 'equipped_frame', accent: 'equipped_accent' };

/** Anti-farming limits (per user, per UTC day unless noted). */
const LIMITS = {
    /** Only the first N list creations per day award XP. */
    LIST_CREATE_REWARDS_PER_DAY: 10,
    /** Only the first N item additions per day award XP. */
    ITEM_ADD_REWARDS_PER_DAY: 50,
    /** Only the first N task completions per day award XP (stops add/complete/delete loops). */
    ITEM_COMPLETE_REWARDS_PER_DAY: 50,
    /** Skill respec: a tree's skills are removed and this share of what they cost comes back (not as lifetime XP); once a day. */
    RESPEC_REFUND_PERCENT: 75,
    RESPEC_COOLDOWN_HOURS: 24,
    /** perfect_day: this many top-level tasks due today (on your own lists), all done. */
    PERFECT_DAY_MIN_TASKS: 3,
    /** inbox_zero: this many overdue tasks cleared in the week, and none left overdue. */
    INBOX_ZERO_MIN_OVERDUE: 3,
    /** boss_defeated: a task with at least this many subtasks is a boss; 60 XP a day. */
    BOSS_MIN_SUBTASKS: 4,
    BOSS_XP_PER_DAY: 60,
    /** comeback: the first completion after this many idle days, at most once per cooldown. */
    COMEBACK_AFTER_DAYS: 3,
    COMEBACK_COOLDOWN_DAYS: 7,
    /** reflection: the longest note. */
    REFLECTION_MAX_LENGTH: 200,
    /** weekly_goal: the target range and the most XP the reward can reach. */
    WEEKLY_GOAL_MIN: 3,
    WEEKLY_GOAL_MAX: 60,
    WEEKLY_GOAL_MAX_XP: 80,
    /** party_assist: 15 XP a day. */
    PARTY_ASSIST_XP_PER_DAY: 15,
    /** estimate_accuracy: the longest estimate, how close a guess must be, and 30 XP a day. */
    ESTIMATE_MAX_MINUTES: 600,
    ESTIMATE_TOLERANCE_PERCENT: 25,
    ESTIMATE_XP_PER_DAY: 30,
    /** HIGH priority is the player's own label: only the first N HIGH completions a day count as HIGH for classes and skills (Vow, Rally, Sniper, Crusade). */
    HIGH_BONUS_PER_DAY: 3,
    /** LIST_CLEARED pays at most this many lists a day (and each list only once). */
    LIST_CLEARED_PER_DAY: 5,
    /** EARLY_FINISH never pays more than this per task (5 XP per day early). */
    EARLY_FINISH_MAX: 20,
    /** A due date must have been set this many hours before the completion to count as early or overdue (stops backdating). */
    DUE_DATE_MIN_AGE_HOURS: 24,
    /** early_finish + overdue_clear share this many XP a day. */
    DEADLINE_BONUS_XP_PER_DAY: 100,
    /** subtasks_done pays at most this many XP a day (one parent). */
    SUBTASKS_DONE_XP_PER_DAY: 10,
    /** habit_bonus pays 2 XP per streak step, at most this per completion... */
    HABIT_MAX: 20,
    /** ...and at most this much a day. */
    HABIT_XP_PER_DAY: 60,
    /** Focus sessions: allowed lengths, the XP and session caps per day, and when an unfinished one expires. */
    FOCUS_MIN_MINUTES: 10,
    FOCUS_MAX_MINUTES: 90,
    FOCUS_XP_PER_DAY: 100,
    FOCUS_SESSIONS_PER_DAY: 8,
    FOCUS_EXPIRE_MINUTES: 180,
    /** The weekly review needs this many tasks finished that week. */
    WEEKLY_REVIEW_MIN_COMPLETED: 1,
    /** Total XP that free games (RPS, Hangman, arcade) may award per day. */
    FREE_GAME_XP_PER_DAY: 500,
    /** Minimum time between two free-game rounds. */
    GAME_COOLDOWN_MS: 3000,
    /** Active game sessions expire (an unfinished blackjack hand is auto-stood and settled, never refunded) after this long. */
    GAME_SESSION_TTL_MINUTES: 30,
    /** Per-user storage quota enforced on import (lists/tasks already owned count). */
    MAX_LISTS_PER_USER: 200,
    MAX_ITEMS_PER_USER: 5000,
    /** Task templates: how many a user can keep, and how many tasks one template can hold. */
    MAX_TEMPLATES_PER_USER: 20,
    MAX_TEMPLATE_ITEMS: 30,
    /** Shared lists: people besides the owner (members plus pending invites), how long an invite lives, and how many a person may send a day. */
    MAX_LIST_MEMBERS: 10,
    INVITE_TTL_DAYS: 7,
    INVITES_PER_DAY: 30,
    /** After someone declines an invitation, the same inviter cannot invite the same person again for this many days. */
    INVITE_DECLINE_COOLDOWN_DAYS: 7,
    /** A changed due date or deadline clears everybody's reminder state for it; that can happen this many times a day per task or list. */
    REMINDER_REARMS_PER_DAY: 3,
    /** Parties: members including the owner. A user is in at most one party. */
    MAX_PARTY_MEMBERS: 6
};

/** Roles on a shared list, weakest first. The owner is an implicit manager. */
const LIST_ROLES = ['viewer', 'editor', 'manager'];

/**
 * The party weekly quest: one global ISO week (UTC) for everyone in the party; the target is PER_MEMBER_TARGET for each member who
 * personally finished at least one task this week (at least one member), only completions made since a member joined count, and every
 * member claims the reward once per week (quest_claims key PARTY_<partyId>) but only after finishing at least MIN_OWN_TO_CLAIM
 * tasks themselves (half of PER_MEMBER_TARGET), so a seat that did nothing, or a spare account, is never paid for others' work.
 */
const PARTY_QUEST = { PER_MEMBER_TARGET: 12, MIN_OWN_TO_CLAIM: 6, REWARD: 60, KEY_PREFIX: 'PARTY_' };

/**
 * The party focus quest: the second weekly party quest. Members' finished focus minutes this week (since they joined, at most
 * PER_MEMBER_MINUTES each counted) must reach PER_MEMBER_MINUTES for every member who focused at all; each member with at least
 * MIN_OWN_MINUTES of their own claims REWARD once a week (a quest_claims row with the key PARTYFOCUS_<partyId>).
 */
const PARTY_FOCUS_QUEST = { PER_MEMBER_MINUTES: 60, MIN_OWN_MINUTES: 20, REWARD: 40, KEY_PREFIX: 'PARTYFOCUS_' };

/** What every invite call answers when it did not (or did) send anything for a reason the inviter must not learn: nobody, someone who does not take invitations, a recent decline. */
const INVITE_NEUTRAL_MESSAGE = 'If that person can be invited, they have been sent an invitation.';

const DAILY = {
    COOLDOWN_MS: 24 * 60 * 60 * 1000,
    STREAK_WINDOW_MS: 48 * 60 * 60 * 1000,
    SHIELDED_STREAK_WINDOW_MS: 72 * 60 * 60 * 1000,
    /** Paladin with the Sanctuary skill. */
    SANCTUARY_STREAK_WINDOW_MS: 96 * 60 * 60 * 1000,
    /**
     * The streak continues while claims are at most this many of the user's calendar days apart: every day, one
     * missed day forgiven (Streak Shield, Paladin), two (Sanctuary). The *_MS windows above are the equivalent
     * rolling windows the streak leaderboard still uses (it may show a lapsed streak for up to a day).
     */
    STREAK_DAYS: 1,
    SHIELDED_STREAK_DAYS: 2,
    SANCTUARY_STREAK_DAYS: 3
};

/** Maximum lengths, matching the database column sizes. */
const TEXT_LIMITS = {
    LIST_NAME: 100,
    ITEM_NAME: 200,
    CATEGORY: 50,
    DESCRIPTION: 1000,
    PARTY_NAME: 40
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
    WEEKLY_REVIEW_KEY,
    STREAK_CHESTS,
    STREAK_FREEZE,
    STREAK_FREEZE_CACHE,
    STREAK_WARNING,
    CLASS_RULES,
    SMALL_ACTION_CAP,
    SKILL_RULES,
    SPEND_SOURCES,
    COSMETICS,
    COSMETIC_KINDS,
    COSMETIC_COLUMNS,
    QUESTS,
    ROTATING_QUESTS,
    PRESTIGE,
    PRESTIGE_TITLES,
    LEADERBOARDS,
    WEEKLY_XP_SOURCES,
    SEASONS,
    LIMITS,
    LIST_ROLES,
    PARTY_QUEST,
    PARTY_FOCUS_QUEST,
    INVITE_NEUTRAL_MESSAGE,
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
