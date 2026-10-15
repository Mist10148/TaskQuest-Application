'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../src');

const { blackjack, rps, hangman, arcade } = shared.games;

/** Deterministic RNG returning the given values in order (then repeating the last). */
const seq = (...values) => {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
};

const user = (overrides = {}) => ({ player_class: 'DEFAULT', player_level: 1, ...overrides });

test('levels come from lifetime XP', () => {
    assert.equal(shared.levelFromXP(0), 1);
    assert.equal(shared.levelFromXP(99), 1);
    assert.equal(shared.levelFromXP(100), 2);
    assert.equal(shared.levelFromXP(-50), 1);
    assert.deepEqual(shared.levelProgress(250), { level: 3, current: 50, needed: 100, percent: 50 });
});

test('every skill exists in exactly one tree and prerequisites resolve', () => {
    const seen = new Set();
    for (const tree of Object.values(shared.SKILL_TREES)) {
        for (const [id, skill] of Object.entries(tree.skills)) {
            assert.ok(!seen.has(id), `duplicate skill ${id}`);
            seen.add(id);
            if (skill.requires) assert.ok(shared.findSkill(skill.requires), `${id} requires unknown ${skill.requires}`);
            assert.ok(skill.description.length > 0);
        }
    }
    assert.ok(seen.size >= 76, 'the skills of every tree are counted');
    assert.equal(shared.findSkill('__proto__'), null);
});

test('class mechanics', () => {
    const base = 10;
    assert.equal(shared.calculateClassXP(user(), base).finalXP, 10);
    assert.equal(shared.calculateClassXP(user({ player_class: 'HERO' }), base).finalXP, 35);

    const assassin = shared.calculateClassXP(user({ player_class: 'ASSASSIN', assassin_streak: 2, assassin_stacks: 9 }), 100);
    assert.equal(assassin.userUpdates.assassin_stacks, 10);
    assert.equal(assassin.finalXP, 180);

    const wizard = shared.calculateClassXP(user({ player_class: 'WIZARD', player_level: 4, wizard_counter: 4 }), base);
    assert.equal(wizard.finalXP, 10 + 4 * 2 * 2, 'burst on 5th action');
    assert.equal(wizard.userUpdates.wizard_counter, 0);

    const tank = shared.calculateClassXP(user({ player_class: 'TANK', player_level: 30, tank_stacks: 99 }), 100);
    assert.equal(tank.userUpdates.tank_stacks, 15, 'stack cap is min(15, 5 + level / 3)');

    const miss = shared.calculateClassXP(user({ player_class: 'ARCHER', archer_streak: 5 }), base, { rng: seq(0.99) });
    assert.equal(miss.userUpdates.archer_streak, 3);
    const pierced = shared.calculateClassXP(user({ player_class: 'ARCHER', archer_streak: 5 }), base, {
        rng: seq(0.99),
        skills: [{ skill_id: 'archer_piercing', skill_level: 1 }]
    });
    assert.equal(pierced.userUpdates.archer_streak, 5, 'Piercing Shot keeps the streak');

    const loss = shared.calculateClassXP(user({ player_class: 'GAMBLER' }), base, { rng: seq(0.5, 0.0) });
    assert.ok(loss.finalXP >= 1, 'gambler never drops below 1 XP');
});

test('skill bonuses are applied', () => {
    const skills = [
        { skill_id: 'default_xp_boost', skill_level: 2 },
        { skill_id: 'hero_valor', skill_level: 1 }
    ];
    const r = shared.calculateFinalXP(user(), skills, 100, { rng: seq(0.99) });
    assert.equal(r.finalXP, 110, 'Valor is a Hero skill: a Default player gets the percentage only');
    const hero = shared.calculateFinalXP(user({ player_class: 'HERO', player_level: 1 }), [{ skill_id: 'hero_valor', skill_level: 1 }], 100, { rng: seq(0.99) });
    assert.equal(hero.finalXP, 100 + 25 + 10, 'the Hero gets Valor');

    // Champion and Legendary only work while the Hero is equipped
    const champ = shared.calculateFinalXP(user({ player_class: 'HERO', player_level: 5 }), [{ skill_id: 'hero_champion', skill_level: 1 }], 10, { rng: seq(0.99) });
    assert.equal(champ.finalXP, Math.floor(35 * 1.35), 'Hero +25, then +35%');
    const borrowed = [{ skill_id: 'hero_champion', skill_level: 1 }, { skill_id: 'hero_legend', skill_level: 1 }];
    assert.equal(shared.calculateFinalXP(user({ player_level: 5 }), borrowed, 10, { rng: seq(0.99) }).finalXP, 10, 'a Default player does not get Champion or Legendary');
    assert.equal(shared.calculateFinalXP(user({ player_class: 'MONK', player_level: 5 }), borrowed, 10, { rng: seq(0.99), now: 0 }).finalXP, shared.calculateFinalXP(user({ player_class: 'MONK', player_level: 5 }), [], 10, { rng: seq(0.99), now: 0 }).finalXP);

    const crit = shared.calculateFinalXP(
        user(),
        [
            { skill_id: 'assassin_critical', skill_level: 2 },
            { skill_id: 'assassin_shadow', skill_level: 1 }
        ],
        100,
        { rng: seq(0.0, 0.99) }
    );
    assert.equal(crit.finalXP, 200, 'Shadow Step crits double the XP');
});

test('daily reward: cooldown, streaks and Streak Shield', () => {
    const now = Date.parse('2030-01-10T12:00:00Z');
    const hours = (h) => new Date(now - h * 3600e3);

    const tooSoon = shared.calculateDailyReward(user({ last_daily_claim: hours(5), streak_count: 2 }), [], now);
    assert.equal(tooSoon.eligible, false);
    assert.equal(tooSoon.remainingMs, 19 * 3600e3);

    const kept = shared.calculateDailyReward(user({ last_daily_claim: hours(30), streak_count: 2 }), [], now, { rng: seq(0.99) });
    assert.equal(kept.newStreak, 3);
    assert.equal(kept.totalXP, 100 + 10);

    const broken = shared.calculateDailyReward(user({ last_daily_claim: hours(60), streak_count: 9 }), [], now);
    assert.equal(broken.newStreak, 1);
    assert.equal(broken.streakBroken, true);

    const shielded = shared.calculateDailyReward(user({ last_daily_claim: hours(60), streak_count: 9 }), [{ skill_id: 'default_streak_shield', skill_level: 1 }], now);
    assert.equal(shielded.newStreak, 10);
});

test('achievements', () => {
    const got = shared.evaluateAchievements({ total_lists_created: 5, lifetime_xp: 600, player_level: 7, owns_hero: 1 }, ['FIRST_LIST']);
    const keys = got.map((a) => a.key);
    assert.ok(keys.includes('FIVE_LISTS'));
    assert.ok(!keys.includes('FIRST_LIST'), 'already unlocked');
    assert.ok(keys.includes('XP_500') && keys.includes('LEVEL_5') && keys.includes('FIRST_CLASS'));
    assert.ok(!keys.includes('ALL_CLASSES'));
    assert.ok(shared.evaluateAchievements({}, [], { blackjack: true, gameWinXP: 600 }).some((a) => a.key === 'HIGH_ROLLER'));
});

test('blackjack engine', () => {
    assert.equal(blackjack.handValue([{ rank: 'A' }, { rank: 'K' }]).value, 21);
    assert.deepEqual(blackjack.handValue([{ rank: 'A' }, { rank: 'A' }, { rank: '9' }]), { value: 21, soft: true, bust: false });
    assert.equal(blackjack.handValue([{ rank: 'K' }, { rank: 'Q' }, { rank: '5' }]).bust, true);

    assert.equal(blackjack.maxBet(1000), 250);
    assert.equal(blackjack.maxBet(100000), 1000);
    assert.ok(blackjack.validateBet(5, 1000));
    assert.ok(blackjack.validateBet(-10, 1000));
    assert.ok(blackjack.validateBet(10.5, 1000));
    assert.equal(blackjack.validateBet(50, 1000), null);

    const state = blackjack.deal(100);
    assert.equal(state.deck.length, 48);
    const view = blackjack.publicView(state);
    assert.equal(view.deck, undefined);
    if (!state.finished) assert.equal(view.dealerHand[1], null);

    const settled = blackjack.settle({ bet: 100, outcome: 'blackjack' });
    assert.deepEqual(settled, { winnings: 150, returned: 250 });
    assert.deepEqual(blackjack.settle({ bet: 100, outcome: 'push' }), { winnings: 0, returned: 100 });
    assert.deepEqual(blackjack.settle({ bet: 100, outcome: 'lost' }), { winnings: 0, returned: 0 });

    const fixed = {
        bet: 10, doubled: false, finished: false, outcome: null,
        playerHand: [{ rank: '10', suit: '♠' }, { rank: '9', suit: '♠' }],
        dealerHand: [{ rank: '10', suit: '♥' }, { rank: '7', suit: '♥' }],
        deck: [{ rank: '2', suit: '♣' }]
    };
    const stood = blackjack.act(fixed, 'stand');
    assert.equal(stood.outcome, 'won');
    assert.equal(fixed.finished, false, 'act does not mutate its input');
    assert.throws(() => blackjack.act(stood, 'hit'));
});

test('rps, hangman and arcade', () => {
    assert.equal(rps.play('rock', seq(0.9)).outcome, 'won');
    assert.equal(rps.play('rock', seq(0.0)).outcome, 'push');
    assert.throws(() => rps.play('lizard'));

    let g = { word: 'ZEBRA', guessed: [], lives: 6, finished: false, outcome: null };
    assert.equal(hangman.publicView(g).word, null);
    for (const l of 'ZEBRA') g = hangman.guess(g, l);
    assert.equal(g.outcome, 'won');
    assert.equal(hangman.reward(g.lives), 60);
    assert.throws(() => hangman.guess({ ...g, finished: false }, '1'));

    assert.equal(arcade.scoreRun('snake', 10, 30_000).baseXP, 20);
    assert.equal(arcade.scoreRun('snake', 1000, 1_000_000).baseXP, 100, 'capped');
    assert.equal(arcade.scoreRun('snake', 100, 1_000).ok, false, 'implausibly fast');
    assert.equal(arcade.scoreRun('pong', 1, 1000).ok, false);
});

test('validation', () => {
    const v = shared.validation;
    assert.equal(v.deadline('2024-02-29').ok, true);
    assert.equal(v.deadline('2023-02-29').ok, false);
    assert.equal(v.deadline('2024-13-45').ok, false);
    assert.equal(v.deadline('').value, null);
    assert.equal(v.listName('  ').ok, false);
    assert.equal(v.listName('x'.repeat(101)).ok, false);
    assert.equal(v.priority('high').value, 'HIGH');
    assert.equal(v.priority('urgent').ok, false);
    assert.equal(v.escapeLike('50%_off\\'), '50\\%\\_off\\\\');
    assert.equal(v.id('12').value, 12);
    assert.equal(v.id('1e3').ok, true);
    assert.equal(v.id('-1').ok, false);
    assert.equal(v.cleanText('a\u0000b '), 'ab');
});

test('task detail validation: tags, repeat and due date', () => {
    const v = shared.validation;
    assert.deepEqual(v.tags('#Work, home  Work'), { ok: true, value: 'work,home' });
    assert.deepEqual(v.tags(['Errands', '#errands', 'x_y']), { ok: true, value: 'errands,x_y' });
    assert.deepEqual(v.tags(''), { ok: true, value: null });
    assert.deepEqual(v.tags(null), { ok: true, value: null });
    assert.equal(v.tags('a b c d e f').ok, false, 'more than 5 tags');
    assert.equal(v.tags('x'.repeat(21)).ok, false, 'tag too long');
    assert.equal(v.tags('semi;colon').ok, false, 'unsafe characters');
    assert.equal(v.tags(42).ok, false);
    assert.equal(v.recurrence('Weekly').value, 'weekly');
    assert.equal(v.recurrence(null).value, null);
    assert.equal(v.recurrence('hourly').ok, false);
    assert.equal(v.dueDate('2030-02-30').ok, false);
    assert.match(v.dueDate('nope').error, /Due date/);
    assert.equal(v.dueDate('2030-02-28').value, '2030-02-28');
});

test('daily reward: one freeze covers one missed day, a longer gap needs one per day', () => {
    const now = Date.parse('2030-01-10T12:00:00Z');
    // The streak is counted in the user's calendar days: `days` is how many days ago the last claim was.
    const gap = (days, freezes) =>
        shared.calculateDailyReward(user({ last_daily_claim: new Date(now - days * 24 * 3600e3), streak_count: 9, streak_freezes: freezes }), [], now);

    const one = gap(2, 3); // yesterday was skipped: one missed day
    assert.deepEqual([one.freezeUsed, one.freezesUsed, one.newStreak], [true, 1, 10]);
    assert.equal(gap(1, 3).freezeUsed, false, 'claiming the next day needs no freeze');
    assert.equal(gap(3, 3).freezesUsed, 2);
    assert.equal(gap(4, 3).freezesUsed, 3);

    const months = gap(60, 3); // two months away: three freezes cannot bridge it
    assert.deepEqual([months.freezeUsed, months.streakBroken, months.newStreak], [false, true, 1]);
    assert.equal(gap(3, 1).freezeUsed, false, 'one freeze is not enough for two missed days');
});

test('liveStreak reads 0 once a streak has lapsed, and Momentum follows it', () => {
    const now = Date.parse('2030-01-10T12:00:00Z');
    const at = (hours, extra = {}) => user({ last_daily_claim: new Date(now - hours * 3600e3), streak_count: 9, ...extra });
    assert.equal(shared.liveStreak(at(30), [], now), 9);
    assert.equal(shared.liveStreak(at(49), [], now), 0);
    assert.equal(shared.liveStreak(at(49, { player_class: 'PALADIN' }), [], now), 9, 'Paladins have the 72 h window');
    assert.equal(shared.liveStreak(user({ streak_count: 0 }), [], now), 0);

    const momentum = [sk('default_momentum', 3)];
    const fresh = shared.calculateFinalXP(at(30), momentum, 100, { now, rng: () => 0.99 });
    const lapsed = shared.calculateFinalXP(at(200), momentum, 100, { now, rng: () => 0.99 });
    assert.ok(fresh.finalXP > lapsed.finalXP, 'a lapsed streak no longer boosts XP');
});

test('daily reward: a streak freeze saves a broken streak, after the free skill', () => {
    const now = Date.parse('2030-01-10T12:00:00Z');
    const old = new Date(now - 60 * 3600e3);

    const saved = shared.calculateDailyReward(user({ last_daily_claim: old, streak_count: 9, streak_freezes: 2 }), [], now);
    assert.equal(saved.newStreak, 10);
    assert.equal(saved.freezeUsed, true);
    assert.equal(saved.streakBroken, false);

    const none = shared.calculateDailyReward(user({ last_daily_claim: old, streak_count: 9, streak_freezes: 0 }), [], now);
    assert.equal(none.newStreak, 1);
    assert.equal(none.freezeUsed, false);

    const tiny = shared.calculateDailyReward(user({ last_daily_claim: old, streak_count: 1, streak_freezes: 3 }), [], now);
    assert.equal(tiny.freezeUsed, false, 'a 1-day streak is not worth a freeze');

    const unstoppable = shared.calculateDailyReward(
        user({ last_daily_claim: old, streak_count: 9, streak_freezes: 3 }),
        [{ skill_id: 'tank_unstoppable', skill_level: 1 }],
        now
    );
    assert.equal(unstoppable.newStreak, 10);
    assert.equal(unstoppable.freezeUsed, false, 'the skill is used before a bought freeze');

    const inWindow = shared.calculateDailyReward(user({ last_daily_claim: new Date(now - 30 * 3600e3), streak_count: 4, streak_freezes: 3 }), [], now);
    assert.equal(inWindow.freezeUsed, false, 'no freeze is spent while the streak is alive');
});

test('spending achievements unlock from xp_spent', () => {
    const keys = (xp_spent) => shared.evaluateAchievements({ xp_spent }, []).map((a) => a.key);
    assert.ok(!keys(999).includes('SPEND_1000'));
    assert.ok(keys(1000).includes('SPEND_1000'));
    assert.ok(keys(5000).includes('SPEND_5000') && !keys(5000).includes('SPEND_10000'));
    assert.ok(keys(10000).includes('SPEND_10000'));
});

test('quest periods: daily is the UTC day, weekly runs Monday to Monday', () => {
    const thursday = new Date('2030-01-10T23:59:59Z');
    const day = shared.questPeriod('daily', thursday);
    assert.equal(day.start, '2030-01-10');
    assert.equal(day.endsAt.toISOString(), '2030-01-11T00:00:00.000Z');
    const week = shared.questPeriod('weekly', thursday);
    assert.equal(week.start, '2030-01-07');
    assert.equal(week.endsAt.toISOString(), '2030-01-14T00:00:00.000Z');
    assert.equal(shared.questPeriod('weekly', new Date('2030-01-13T10:00:00Z')).start, '2030-01-07', 'Sunday belongs to the week that started Monday');
    assert.equal(shared.questPeriod('weekly', new Date('2030-01-14T00:00:00Z')).start, '2030-01-14');
});

// ─── Class rebalance ─────────────────────────────────────────────────────────

const NOW = Date.parse('2030-01-10T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3);

test('Hero flat bonus is min(25, base x 3)', () => {
    for (const [base, bonus] of [[5, 15], [8, 24], [9, 25], [10, 25], [100, 25]]) {
        const r = shared.calculateClassXP(user({ player_class: 'HERO' }), base);
        assert.equal(r.bonusInfo.classBonus, bonus, `base ${base}`);
        assert.equal(r.finalXP, base + bonus);
    }
});

test('Tank stack cap is min(15, 5 + floor(level / 3)) + 2 per Absorb', () => {
    // [level, absorb levels, expected cap]
    const cases = [[1, 0, 5], [3, 0, 6], [8, 0, 7], [18, 0, 11], [30, 0, 15], [90, 0, 15], [1, 1, 7], [1, 2, 9], [12, 2, 13], [90, 2, 19]];
    for (const [level, absorb, cap] of cases) {
        const skills = absorb ? [{ skill_id: 'tank_absorb', skill_level: absorb }] : [];
        assert.equal(shared.tankStackCap(level, skills), cap, `level ${level} absorb ${absorb}`);
        const r = shared.calculateClassXP(user({ player_class: 'TANK', player_level: level, tank_stacks: 99 }), 100, { skills });
        assert.equal(r.userUpdates.tank_stacks, shared.tankStackCap(level, skills), 'stacks are clamped to the cap');
    }
});

test('Assassin streak and stacks decay after 48 hours idle and every action stamps assassin_last_at', () => {
    const base = { player_class: 'ASSASSIN', assassin_streak: 6, assassin_stacks: 7 };
    // [label, last action, expected streak, expected stacks, expected type]
    const cases = [
        ['inside the window', hoursAgo(47), 7, 8, 'ASSASSIN'],
        ['exactly 48h is still alive', hoursAgo(48), 7, 8, 'ASSASSIN'],
        ['past the window', hoursAgo(49), 1, 0, 'ASSASSIN_BUILDING'],
        ['never acted before', null, 7, 8, 'ASSASSIN']
    ];
    for (const [label, last, streak, stacks, type] of cases) {
        const r = shared.calculateClassXP(user({ ...base, assassin_last_at: last }), 100, { now: NOW });
        assert.equal(r.userUpdates.assassin_streak, streak, label);
        assert.equal(r.userUpdates.assassin_stacks ?? 0, stacks, label);
        assert.equal(r.bonusInfo.type, type, label);
        assert.equal(r.userUpdates.assassin_last_at.getTime(), NOW, label);
    }
    // A decayed streak restarts at the Swift Strike boost, not at the old value.
    const swift = shared.calculateClassXP(user({ ...base, assassin_last_at: hoursAgo(50) }), 100, {
        now: NOW,
        skills: [{ skill_id: 'assassin_swift', skill_level: 2 }]
    });
    assert.equal(swift.userUpdates.assassin_streak, 3);
    assert.equal(swift.userUpdates.assassin_stacks, 1);
});

// ─── New skills on the existing classes ──────────────────────────────────────

const sk = (id, level = 1) => ({ skill_id: id, skill_level: level });

test('every new skill has a chain, a real cost and sits in the right tree', () => {
    const expected = {
        default_momentum: ['DEFAULT', 3, 70, 'default_xp_boost'],
        default_freeze_cache: ['DEFAULT', 1, 120, 'default_streak_shield'],
        default_daily_surprise: ['DEFAULT', 1, 140, 'default_freeze_cache'],
        hero_oath: ['HERO', 1, 250, 'hero_legend'],
        hero_rally: ['HERO', 1, 220, 'hero_oath'],
        gambler_insurance: ['GAMBLER', 1, 200, 'gambler_jackpot'],
        gambler_hothand: ['GAMBLER', 1, 230, 'gambler_insurance'],
        assassin_nightowl: ['ASSASSIN', 1, 200, 'assassin_execute'],
        assassin_bleed: ['ASSASSIN', 1, 240, 'assassin_nightowl'],
        wizard_overcharge: ['WIZARD', 1, 300, 'wizard_mastery'],
        wizard_tome: ['WIZARD', 1, 260, 'wizard_overcharge'],
        archer_quiver: ['ARCHER', 2, 150, 'archer_sniper'],
        archer_eagle: ['ARCHER', 1, 260, 'archer_quiver'],
        tank_bulwark: ['TANK', 1, 240, 'tank_unstoppable'],
        tank_anchor: ['TANK', 1, 260, 'tank_bulwark']
    };
    for (const [id, [tree, max, cost, requires]] of Object.entries(expected)) {
        const found = shared.findSkill(id);
        assert.equal(found.treeKey, tree, id);
        assert.equal(found.skill.maxLevel, max, id);
        assert.equal(found.skill.cost, cost, id);
        assert.equal(found.skill.requires, requires, id);
    }
});

test('Momentum: +0.5% XP per level per streak day, streak counted to 10', () => {
    // [skill level, streak days, base, expected final]
    const cases = [[1, 0, 100, 100], [1, 4, 100, 102], [2, 5, 100, 105], [3, 10, 100, 115], [3, 40, 100, 115], [3, 10, 200, 230]];
    for (const [level, streak, base, expected] of cases) {
        const r = shared.calculateFinalXP(user({ streak_count: streak }), [sk('default_momentum', level)], base, { rng: seq(0.99) });
        assert.equal(r.finalXP, expected, `lvl ${level} streak ${streak}`);
    }
});

test('Freeze Cache raises the freeze cap to 5 and lowers the price to 120', () => {
    assert.deepEqual(shared.getFreezeLimits([]), { COST: 150, MAX: 3 });
    assert.deepEqual(shared.getFreezeLimits([sk('default_freeze_cache')]), { COST: 120, MAX: 5 });
    assert.deepEqual(shared.getFreezeLimits(new Map([['default_freeze_cache', 0]])), { COST: 150, MAX: 3 });
});

test('Daily Surprise: 15% chance of +50 XP on the daily reward', () => {
    const now = Date.parse('2030-01-10T12:00:00Z');
    const u = user({ last_daily_claim: new Date(now - 30 * 3600e3), streak_count: 2 });
    // The default class draws no rng; the surprise draws exactly one value.
    const cases = [[0.0, 50], [0.149, 50], [0.15, 0], [0.99, 0]];
    for (const [roll, bonus] of cases) {
        const r = shared.calculateDailyReward(u, [sk('default_daily_surprise')], now, { rng: seq(roll) });
        assert.equal(r.surpriseBonus, bonus, `roll ${roll}`);
        assert.equal(r.totalXP, 100 + 10 + bonus);
    }
    const without = shared.calculateDailyReward(u, [], now, { rng: seq(0) });
    assert.equal(without.surpriseBonus, 0, 'no skill, no surprise');
});

test('Hero Oath: bonus min(25 + level, 50), still capped at 3x base', () => {
    // [level, base, with oath, without oath]
    const cases = [[1, 100, 26, 25], [10, 100, 35, 25], [25, 100, 50, 25], [60, 100, 50, 25], [30, 5, 15, 15]];
    for (const [level, base, oath, plain] of cases) {
        const hero = user({ player_class: 'HERO', player_level: level });
        assert.equal(shared.calculateClassXP(hero, base, { skills: [sk('hero_oath')] }).bonusInfo.classBonus, oath, `lvl ${level} base ${base}`);
        assert.equal(shared.calculateClassXP(hero, base).bonusInfo.classBonus, plain);
    }
    const notHero = shared.calculateClassXP(user({ player_level: 30 }), 100, { skills: [sk('hero_oath')] });
    assert.equal(notHero.finalXP, 100, 'Oath only matters while Hero is equipped');
});

test('Hero Rally: +15 XP when completing a HIGH priority task, any class', () => {
    const cases = [
        ['item_complete', 'HIGH', 25],
        ['item_complete', 'MEDIUM', 10],
        ['item_complete', undefined, 10],
        ['item_add', 'HIGH', 10]
    ];
    for (const [action, priority, expected] of cases) {
        const r = shared.calculateFinalXP(user(), [sk('hero_rally')], 10, { rng: seq(0.99), context: { action, priority } });
        assert.equal(r.finalXP, expected, `${action} ${priority}`);
    }
});

test('Gambler Insurance: bad luck never cuts below 60% of base', () => {
    // rng: bonus roll 0.99 (biggest possible loss), loss roll 0 (bad luck). [base, plain result, insured result]
    for (const [base, plain, insured] of [[100, 1, 60], [10, 1, 6], [1, 1, 1], [5, 1, 3]]) {
        const g = user({ player_class: 'GAMBLER' });
        assert.equal(shared.calculateClassXP(g, base, { rng: seq(0.99, 0.0) }).finalXP, plain, `base ${base} plain`);
        assert.equal(shared.calculateClassXP(g, base, { rng: seq(0.99, 0.0), skills: [sk('gambler_insurance')] }).finalXP, insured, `base ${base} insured`);
    }
});

test('Gambler Hot Hand: three lucky rolls in a row guard the next one', () => {
    // bonus roll 0.5, loss roll 0.0 (would be bad luck); only Hot Hand at a streak of 3+ stops it
    const roll = (streak, skills = []) =>
        shared.calculateClassXP(user({ player_class: 'GAMBLER', gambler_streak: streak }), 10, { rng: seq(0.5, 0.0), skills });
    assert.equal(roll(2, [sk('gambler_hothand')]).bonusInfo.type, 'GAMBLER_LOSS');
    assert.equal(roll(3).bonusInfo.type, 'GAMBLER_LOSS', 'no skill, no protection');
    const guarded = roll(3, [sk('gambler_hothand')]);
    assert.equal(guarded.bonusInfo.type, 'GAMBLER_WIN');
    assert.equal(guarded.userUpdates.gambler_streak, 0, 'the protection is spent');
    assert.equal(roll(5, [sk('gambler_hothand')]).bonusInfo.type, 'GAMBLER_WIN');
    // the streak counts lucky rolls and breaks on bad luck, with or without the skill
    const win = shared.calculateClassXP(user({ player_class: 'GAMBLER', gambler_streak: 1 }), 10, { rng: seq(0.5, 0.99) });
    assert.equal(win.userUpdates.gambler_streak, 2);
    assert.equal(roll(2).userUpdates.gambler_streak, 0);
});

test('Assassin Night Owl: decay window is 72h', () => {
    const base = { player_class: 'ASSASSIN', assassin_streak: 5, assassin_stacks: 5 };
    // [hours idle, skills, expected streak after the action]
    const cases = [[60, [], 1], [60, [sk('assassin_nightowl')], 6], [72, [sk('assassin_nightowl')], 6], [73, [sk('assassin_nightowl')], 1]];
    for (const [hours, skills, streak] of cases) {
        const r = shared.calculateClassXP(user({ ...base, assassin_last_at: hoursAgo(hours) }), 100, { now: NOW, skills });
        assert.equal(r.userUpdates.assassin_streak, streak, `${hours}h`);
    }
});

test('Assassin Bleed: a crit gives the next 3 actions +20% XP, whatever the class', () => {
    const skills = [sk('assassin_critical', 2), sk('assassin_bleed')];
    // a crit roll of 0 always crits (20% chance, +50%)
    const crit = shared.calculateFinalXP(user(), skills, 100, { rng: seq(0.0, 0.99) });
    assert.equal(crit.finalXP, 150);
    assert.equal(crit.userUpdates.assassin_bleed, 3);
    // while bleeding (and not critting) each action gets +20% and uses one charge: [charges, XP, charges after]
    for (const [left, expectedXP, after] of [[3, 120, 2], [1, 120, 0], [0, 100, 0]]) {
        const r = shared.calculateFinalXP(user({ assassin_bleed: left }), skills, 100, { rng: seq(0.99) });
        assert.equal(r.finalXP, expectedXP, `${left} charges`);
        assert.equal(r.userUpdates.assassin_bleed, after);
    }
    // a crit while bleeding refreshes to 3 and still pays the +20% for that action
    const refreshed = shared.calculateFinalXP(user({ assassin_bleed: 1 }), skills, 100, { rng: seq(0.0, 0.99) });
    assert.equal(refreshed.userUpdates.assassin_bleed, 3);
    assert.equal(refreshed.finalXP, 120 + Math.floor(120 * 0.5));
    // no skill, no counter
    assert.equal(shared.calculateFinalXP(user({ assassin_bleed: 2 }), [], 100, { rng: seq(0.99) }).userUpdates.assassin_bleed, undefined);
});

test('Wizard Overcharge restarts the cycle at 2 charges; Tome adds Wisdom per 20 tasks', () => {
    const w = (overrides = {}, skills = []) => shared.calculateClassXP(user({ player_class: 'WIZARD', player_level: 4, ...overrides }), 10, { skills });
    assert.equal(w({ wizard_counter: 4 }).userUpdates.wizard_counter, 0);
    assert.equal(w({ wizard_counter: 4 }, [sk('wizard_overcharge')]).userUpdates.wizard_counter, 2);
    assert.equal(w({ wizard_counter: 1 }, [sk('wizard_overcharge')]).userUpdates.wizard_counter, 2, 'a normal charge still counts up');
    // after an Overcharge burst the 3rd charge is a combo again
    assert.equal(w({ wizard_counter: 2 }, [sk('wizard_overcharge')]).bonusInfo.type, 'WIZARD_COMBO');

    // Tome: wisdom = level * 2 + floor(tasks / 20); [tasks done, expected combo XP (= wisdom)]
    for (const [done, wisdom] of [[0, 8], [19, 8], [20, 9], [95, 12], [400, 28]]) {
        const combo = w({ wizard_counter: 2, total_items_completed: done }, [sk('wizard_tome')]);
        assert.equal(combo.bonusInfo.classBonus, wisdom, `${done} tasks`);
    }
    assert.equal(w({ wizard_counter: 2, total_items_completed: 400 }).bonusInfo.classBonus, 8, 'no Tome, no growth');
});

test('Archer Quiver (+3% hit per level, cap 97) and Eagle Eye (headshots x1.5)', () => {
    // level 1: hit chance 80.5. A roll of 83 misses plainly and hits with Quiver 1 (83.5).
    const archer = user({ player_class: 'ARCHER', player_level: 1 });
    const type = (u, roll, skills = []) => shared.calculateClassXP(u, 10, { rng: seq(roll, 0.99), skills }).bonusInfo.type;
    assert.equal(type(archer, 0.83), 'ARCHER_MISS');
    assert.equal(type(archer, 0.83, [sk('archer_quiver')]), 'ARCHER_HIT');
    assert.equal(type(archer, 0.9, [sk('archer_quiver', 2)]), 'ARCHER_MISS', 'cap is 86.5% at level 2');
    assert.equal(type(archer, 0.86, [sk('archer_quiver', 2)]), 'ARCHER_HIT');
    // still capped at 97
    const high = user({ player_class: 'ARCHER', player_level: 80 });
    assert.equal(type(high, 0.971, [sk('archer_quiver', 2)]), 'ARCHER_MISS');
    assert.equal(type(high, 0.969, [sk('archer_quiver', 2)]), 'ARCHER_HIT');

    // Headshot threshold: min(30, hit * 0.2) = 16.1 at level 1; Eagle Eye makes it 24.15.
    const headshot = (roll, skills = []) => shared.calculateClassXP(archer, 10, { rng: seq(roll, 0.99), skills }).bonusInfo.details.includes('💥');
    assert.equal(headshot(0.2), false);
    assert.equal(headshot(0.2, [sk('archer_eagle')]), true);
    assert.equal(headshot(0.25, [sk('archer_eagle')]), false);
    assert.equal(headshot(0.15), true);
});

test('Tank Bulwark (+2 stacks per action) and Anchor (+8 XP on recurring tasks)', () => {
    const tank = (stacks, skills = []) => shared.calculateClassXP(user({ player_class: 'TANK', player_level: 30, tank_stacks: stacks }), 100, { skills });
    assert.equal(tank(0).userUpdates.tank_stacks, 1);
    assert.equal(tank(0, [sk('tank_bulwark')]).userUpdates.tank_stacks, 2);
    assert.equal(tank(14, [sk('tank_bulwark')]).userUpdates.tank_stacks, 15, 'still clamped to the cap (15 at level 30)');

    const cases = [
        [{ action: 'item_complete', recurring: true }, 18],
        [{ action: 'item_complete', recurring: false }, 10],
        [{ action: 'item_add', recurring: true }, 10]
    ];
    for (const [context, expected] of cases) {
        const r = shared.calculateFinalXP(user(), [sk('tank_anchor')], 10, { rng: seq(0.99), context });
        assert.equal(r.finalXP, expected, JSON.stringify(context));
    }
});

// ─── Monk ────────────────────────────────────────────────────────────────────

test('Monk Rhythm: consecutive UTC days build it, a missed day resets it, bonus = 2% x rhythm + rhythm', () => {
    const monk = (rhythm, day) => user({ player_class: 'MONK', monk_rhythm: rhythm, monk_day: day });
    // [label, rhythm, last day, skills, base, expected rhythm, expected bonus]
    const cases = [
        ['first action ever', 0, null, [], 100, 1, 3],
        ['same day keeps rhythm', 5, '2030-01-10', [], 100, 5, 15],
        ['yesterday adds one', 5, '2030-01-09', [], 100, 6, 18],
        ['two days ago resets', 5, '2030-01-08', [], 100, 1, 3],
        ['two days ago, Serenity forgives', 5, '2030-01-08', [sk('monk_serenity')], 100, 6, 18],
        ['three days ago, Serenity does not', 5, '2030-01-07', [sk('monk_serenity')], 100, 1, 3],
        ['rhythm is capped at 14', 14, '2030-01-09', [], 100, 14, 28 + 14],
        ['Discipline lifts the cap to 16', 14, '2030-01-09', [sk('monk_discipline')], 100, 15, 30 + 15],
        ['Discipline cap holds at 16', 16, '2030-01-09', [sk('monk_discipline')], 100, 16, 32 + 16],
        ['Steady Breath adds 0.4 XP per rhythm day per level', 5, '2030-01-10', [sk('monk_breath', 2)], 100, 5, 10 + 9],
        ['Inner Focus adds 15% per level', 5, '2030-01-10', [sk('monk_focus', 2)], 100, 5, 19],
        ['small actions still get the flat part', 3, '2030-01-10', [], 10, 3, 3],
        ['a DATE returned as a Date object works', 5, new Date('2030-01-09T00:00:00Z'), [], 100, 6, 18]
    ];
    for (const [label, rhythm, day, skills, base, expectedRhythm, expectedBonus] of cases) {
        const r = shared.calculateClassXP(monk(rhythm, day), base, { now: NOW, skills });
        assert.equal(r.userUpdates.monk_rhythm, expectedRhythm, `${label}: rhythm`);
        assert.equal(r.userUpdates.monk_day, '2030-01-10', `${label}: day stamp`);
        assert.equal(r.bonusInfo.classBonus, expectedBonus, `${label}: bonus`);
        assert.equal(r.finalXP, base + expectedBonus, `${label}: final`);
    }
});

test('Monk tree: five skills in a chain, each with an implemented effect', () => {
    const ids = Object.keys(shared.SKILL_TREES.MONK.skills);
    assert.deepEqual(ids, ['monk_breath', 'monk_focus', 'monk_discipline', 'monk_serenity', 'monk_meditation']);
    assert.deepEqual(ids.map((id) => shared.findSkill(id).skill.requires), [null, 'monk_breath', 'monk_focus', 'monk_discipline', 'monk_serenity']);
    assert.equal(shared.CLASSES.MONK.cost, 550);
});

// ─── Artisan ─────────────────────────────────────────────────────────────────

test('Artisan Project: +1 progress and +2 XP per progress per action; a cleared list pays +6 per progress and keeps half', () => {
    const artisan = (progress) => user({ player_class: 'ARTISAN', artisan_progress: progress });
    const done = { action: 'item_complete', listCleared: true };
    const plain = { action: 'item_complete', listCleared: false };
    // [label, progress, context, skills, base, expected progress, expected bonus]
    const cases = [
        ['first action', 0, plain, [], 10, 1, 2],
        ['mid project', 4, plain, [], 10, 5, 10],
        ['capped at 10', 10, plain, [], 10, 10, 20],
        ['list cleared pays 6 per progress and keeps half', 4, done, [], 10, 2, 10 + 30],
        ['the flag only counts on a completion', 4, { action: 'item_add', listCleared: true }, [], 10, 5, 10],
        ['Toolkit adds 0.5 per progress per level', 4, plain, [sk('artisan_toolkit', 2)], 10, 5, 5 * 3],
        ['Blueprint raises the cap by 3 per level', 10, plain, [sk('artisan_blueprint', 2)], 10, 11, 22],
        ['Blueprint cap at 16', 16, plain, [sk('artisan_blueprint', 2)], 10, 16, 32],
        ['Assembly Line adds 2 progress per action', 4, plain, [sk('artisan_assembly')], 10, 6, 12],
        ['Assembly Line stops at the cap', 9, plain, [sk('artisan_assembly')], 10, 10, 20],
        ['Masterwork pays 50% more on a clear', 4, done, [sk('artisan_masterwork')], 10, 2, 10 + 45],
        ['clear after Assembly + Masterwork', 5, done, [sk('artisan_assembly'), sk('artisan_masterwork')], 10, 3, 14 + 63]
    ];
    for (const [label, progress, context, skills, base, expectedProgress, expectedBonus] of cases) {
        const r = shared.calculateClassXP(artisan(progress), base, { skills, context });
        assert.equal(r.userUpdates.artisan_progress, expectedProgress, `${label}: progress`);
        assert.equal(r.bonusInfo.classBonus, expectedBonus, `${label}: bonus`);
        assert.equal(r.finalXP, base + expectedBonus, `${label}: final`);
    }
    assert.equal(shared.calculateClassXP(artisan(4), 10, { context: done }).bonusInfo.type, 'ARTISAN_CLEAR');
});

test('Artisan tree: five chained skills', () => {
    const ids = Object.keys(shared.SKILL_TREES.ARTISAN.skills);
    assert.deepEqual(ids, ['artisan_toolkit', 'artisan_blueprint', 'artisan_assembly', 'artisan_masterwork', 'artisan_prototype']);
    assert.deepEqual(ids.map((id) => shared.findSkill(id).skill.requires), [null, 'artisan_toolkit', 'artisan_blueprint', 'artisan_assembly', 'artisan_masterwork']);
    assert.equal(shared.CLASSES.ARTISAN.cost, 650);
});

// ─── Ranger ──────────────────────────────────────────────────────────────────

test('Ranger Deadline Hunter: early, on the day, overdue and non-deadline actions', () => {
    const ranger = user({ player_class: 'RANGER' });
    const complete = (dueDate) => ({ action: 'item_complete', today: '2030-01-10', dueDate });
    // [label, context, skills, base, expected type, expected bonus]
    const cases = [
        ['1 day early', complete('2030-01-11'), [], 10, 'RANGER_EARLY', 1 + 3],
        ['3 days early', complete('2030-01-13'), [], 10, 'RANGER_EARLY', 3 + 9],
        ['7 days early', complete('2030-01-17'), [], 10, 'RANGER_EARLY', 7 + 21],
        ['capped at 7 days early', complete('2030-03-01'), [], 10, 'RANGER_EARLY', 7 + 21],
        ['percentage scales with base', complete('2030-01-12'), [], 100, 'RANGER_EARLY', 20 + 6],
        ['due today pays 25% of base', complete('2030-01-10'), [], 100, 'RANGER_DUE', 25],
        ['due today rounds down', complete('2030-01-10'), [], 10, 'RANGER_DUE', 2],
        ['overdue pays nothing', complete('2030-01-09'), [], 100, 'RANGER_LATE', 0],
        ['no due date is a flat +5', { action: 'item_complete', today: '2030-01-10', dueDate: null }, [], 10, 'RANGER', 5],
        ['other actions are a flat +5', { action: 'item_add', dueDate: '2030-01-13' }, [], 10, 'RANGER', 5],
        ['Scout: +2 per early day per level', complete('2030-01-13'), [sk('ranger_scout', 2)], 10, 'RANGER_EARLY', 3 + 9 + 12],
        ['Long Sight: cap 10 days', complete('2030-03-01'), [sk('ranger_longsight')], 10, 'RANGER_EARLY', 10 + 30],
        ['Bullseye: +10 on the day', complete('2030-01-10'), [sk('ranger_bullseye')], 100, 'RANGER_DUE', 35],
        ['Bullseye does not touch early completions', complete('2030-01-11'), [sk('ranger_bullseye')], 10, 'RANGER_EARLY', 4],
        ['Second Wind: overdue pays half of due-today', complete('2030-01-09'), [sk('ranger_secondwind')], 100, 'RANGER_LATE', 12],
        ['Second Wind includes Bullseye in the half', complete('2030-01-09'), [sk('ranger_secondwind'), sk('ranger_bullseye')], 100, 'RANGER_LATE', 17],
        ['Second Wind does nothing early', complete('2030-01-11'), [sk('ranger_secondwind')], 10, 'RANGER_EARLY', 4]
    ];
    for (const [label, context, skills, base, type, bonus] of cases) {
        const r = shared.calculateClassXP(ranger, base, { context, skills });
        assert.equal(r.bonusInfo.type, type, `${label}: type`);
        assert.equal(r.bonusInfo.classBonus, bonus, `${label}: bonus`);
        assert.equal(r.finalXP, base + bonus, `${label}: final`);
    }
    // with no context.today the clock decides
    const viaNow = shared.calculateClassXP(ranger, 10, { now: NOW, context: { action: 'item_complete', dueDate: '2030-01-12' } });
    assert.equal(viaNow.bonusInfo.type, 'RANGER_EARLY');
    assert.equal(viaNow.bonusInfo.classBonus, 2 + 6);
});

test('Ranger tree: five chained skills and no counter column needed', () => {
    const ids = Object.keys(shared.SKILL_TREES.RANGER.skills);
    assert.deepEqual(ids, ['ranger_scout', 'ranger_longsight', 'ranger_bullseye', 'ranger_secondwind', 'ranger_tracker']);
    assert.deepEqual(ids.map((id) => shared.findSkill(id).skill.requires), [null, 'ranger_scout', 'ranger_longsight', 'ranger_bullseye', 'ranger_secondwind']);
    assert.equal(shared.CLASSES.RANGER.cost, 600);
    assert.deepEqual(shared.calculateClassXP(user({ player_class: 'RANGER' }), 10).userUpdates, {});
});

// ─── Necromancer ─────────────────────────────────────────────────────────────

test('Necromancer Revive: overdue completions pay and bind souls; souls boost every action', () => {
    const necro = (souls) => user({ player_class: 'NECROMANCER', necro_souls: souls });
    const revive = (days) => ({ action: 'item_complete', overdueDays: days });
    const plain = { action: 'item_complete', overdueDays: 0 };
    // [label, souls held, context, skills, base, expected souls, expected bonus]
    const cases = [
        ['not overdue, no souls', 0, plain, [], 10, 0, 0],
        ['revive 1 day overdue', 0, revive(1), [], 10, 1, 15 + 3],
        ['revive 3 days overdue, 2nd soul adds 8% of base', 1, revive(3), [], 100, 2, 150 + 9 + 16],
        ['overdue days are capped at 30 XP', 0, revive(40), [], 10, 1, 15 + 30],
        ['souls are capped at 5', 5, revive(2), [], 100, 5, 150 + 6 + 40],
        ['souls boost a normal action too', 3, plain, [], 100, 3, 24],
        ['souls boost non-completions', 4, { action: 'item_add' }, [], 100, 4, 32],
        ['small base rounds the soul bonus down', 2, plain, [], 10, 2, 1],
        ['Siphon: +2% per soul per level', 3, plain, [sk('necro_siphon', 2)], 100, 3, 36],
        ['Soul Jar: cap 8', 5, revive(2), [sk('necro_jar')], 100, 6, 150 + 6 + 48],
        ['Soul Jar: still capped at 8', 8, revive(2), [sk('necro_jar')], 100, 8, 150 + 6 + 64],
        ['Dark Ritual: revive +50%', 0, revive(2), [sk('necro_ritual')], 100, 1, Math.floor(156 * 1.5) + 8],
        ['Lichdom: +3 per soul on a revive', 2, revive(2), [sk('necro_lich')], 100, 3, 156 + 24 + 9],
        ['Lichdom does nothing without a revive', 2, plain, [sk('necro_lich')], 100, 2, 16]
    ];
    for (const [label, souls, context, skills, base, expectedSouls, expectedBonus] of cases) {
        const r = shared.calculateClassXP(necro(souls), base, { context, skills });
        assert.equal(r.userUpdates.necro_souls, expectedSouls, `${label}: souls`);
        assert.equal(r.bonusInfo.classBonus, expectedBonus, `${label}: bonus`);
        assert.equal(r.finalXP, base + expectedBonus, `${label}: final`);
    }
    // every 10th completed task binds a soul without a backlog
    const harvest = (done) => shared.calculateClassXP(user({ player_class: 'NECROMANCER', necro_souls: 0, total_items_completed: done }), 100, { context: plain });
    assert.equal(harvest(10).userUpdates.necro_souls, 1);
    assert.equal(harvest(9).userUpdates.necro_souls, 0);
    assert.equal(harvest(20).userUpdates.necro_souls, 1);
    const added = shared.calculateClassXP(user({ player_class: 'NECROMANCER', necro_souls: 0, total_items_completed: 10 }), 100, { context: { action: 'item_add' } });
    assert.equal(added.userUpdates.necro_souls, 0, 'only completions harvest');
    assert.equal(shared.calculateClassXP(necro(0), 10, { context: revive(1) }).bonusInfo.type, 'NECROMANCER_REVIVE');
    assert.equal(shared.calculateClassXP(necro(0), 10, { context: plain }).bonusInfo.type, 'NECROMANCER');
});

test('Necromancer tree: five chained skills', () => {
    const ids = Object.keys(shared.SKILL_TREES.NECROMANCER.skills);
    assert.deepEqual(ids, ['necro_siphon', 'necro_jar', 'necro_ritual', 'necro_lich', 'necro_souleater']);
    assert.deepEqual(ids.map((id) => shared.findSkill(id).skill.requires), [null, 'necro_siphon', 'necro_jar', 'necro_ritual', 'necro_lich']);
    assert.equal(shared.CLASSES.NECROMANCER.cost, 600);
});

// ─── Paladin ─────────────────────────────────────────────────────────────────

test('Paladin Vow: HIGH priority completions pay base + 10, everything else +8', () => {
    const paladin = user({ player_class: 'PALADIN' });
    const high = { action: 'item_complete', priority: 'HIGH' };
    // [label, context, skills, base, expected type, expected bonus]
    const cases = [
        ['HIGH completion', high, [], 10, 'PALADIN_VOW', 10 + 10],
        ['HIGH completion scales with base', high, [], 50, 'PALADIN_VOW', 60],
        ['MEDIUM completion', { action: 'item_complete', priority: 'MEDIUM' }, [], 10, 'PALADIN', 8],
        ['HIGH but not a completion', { action: 'item_add', priority: 'HIGH' }, [], 10, 'PALADIN', 8],
        ['no context', undefined, [], 10, 'PALADIN', 8],
        ['Holy Aura: +3 per level on everything', { action: 'item_add' }, [sk('paladin_aura', 3)], 10, 'PALADIN', 8 + 9],
        ['Holy Aura on a Vow', high, [sk('paladin_aura', 2)], 10, 'PALADIN_VOW', 20 + 6],
        ['Smite 1: Vow +25%', high, [sk('paladin_smite', 1)], 10, 'PALADIN_VOW', 25],
        ['Smite 2: Vow +50%', high, [sk('paladin_smite', 2)], 10, 'PALADIN_VOW', 30],
        ['Smite does not touch the +8', { action: 'item_add' }, [sk('paladin_smite', 2)], 10, 'PALADIN', 8],
        ['Smite then Aura (aura is flat)', high, [sk('paladin_smite', 2), sk('paladin_aura', 1)], 10, 'PALADIN_VOW', 33]
    ];
    for (const [label, context, skills, base, type, bonus] of cases) {
        const r = shared.calculateClassXP(paladin, base, { context, skills });
        assert.equal(r.bonusInfo.type, type, `${label}: type`);
        assert.equal(r.bonusInfo.classBonus, bonus, `${label}: bonus`);
        assert.equal(r.finalXP, base + bonus, `${label}: final`);
    }
});

test('Paladin Crusade: +20% XP on HIGH completions (Paladin only)', () => {
    const high = { action: 'item_complete', priority: 'HIGH' };
    const crusade = [sk('paladin_crusade')];
    const run = (player_class, context) => shared.calculateFinalXP(user({ player_class }), crusade, 100, { rng: seq(0.99), context }).finalXP;
    assert.equal(run('PALADIN', high), Math.floor(210 * 1.2), 'base 100 + Vow 110, x1.2');
    assert.equal(run('PALADIN', { action: 'item_complete', priority: 'LOW' }), 108, 'not HIGH: no Crusade');
    assert.equal(run('DEFAULT', high), 100, 'Crusade needs the Paladin equipped');
});

test('Paladin passive and Sanctuary: one missed day is forgiven for free, two with Sanctuary', () => {
    const now = Date.parse('2030-01-10T12:00:00Z');
    const claim = (days, player_class, skills = [], extra = {}) =>
        shared.calculateDailyReward(user({ player_class, last_daily_claim: new Date(now - days * 24 * 3600e3), streak_count: 9, ...extra }), skills, now, { rng: seq(0.99) });
    // [label, calendar days since the last claim, class, skills, streak survives]
    const cases = [
        ['paladin the next day', 1, 'PALADIN', [], true],
        ['paladin after one missed day', 2, 'PALADIN', [], true],
        ['paladin after two missed days', 3, 'PALADIN', [], false],
        ['default after one missed day', 2, 'DEFAULT', [], false],
        ['default with the shield skill after one missed day', 2, 'DEFAULT', [sk('default_streak_shield')], true],
        ['sanctuary after two missed days', 3, 'PALADIN', [sk('paladin_sanctuary')], true],
        ['sanctuary after three missed days', 4, 'PALADIN', [sk('paladin_sanctuary')], false],
        ['sanctuary is a Paladin effect only', 3, 'DEFAULT', [sk('paladin_sanctuary')], false]
    ];
    for (const [label, days, cls, skills, survives] of cases) {
        const r = claim(days, cls, skills);
        assert.equal(r.newStreak, survives ? 10 : 1, label);
    }
    // a bought freeze still rescues a streak beyond the Paladin window
    assert.equal(claim(4, 'PALADIN', [], { streak_freezes: 1 }).freezeUsed, false, 'two days past the window: one freeze is not enough');
    assert.equal(claim(4, 'PALADIN', [], { streak_freezes: 2 }).freezeUsed, true);
    assert.equal(claim(3, 'PALADIN', [], { streak_freezes: 1 }).freezeUsed, true);
    assert.equal(claim(2, 'PALADIN', [], { streak_freezes: 1 }).freezeUsed, false, 'no freeze is spent while the window holds');
});

test('Paladin tree: five chained skills', () => {
    const ids = Object.keys(shared.SKILL_TREES.PALADIN.skills);
    assert.deepEqual(ids, ['paladin_aura', 'paladin_smite', 'paladin_crusade', 'paladin_sanctuary', 'paladin_aegis']);
    assert.deepEqual(ids.map((id) => shared.findSkill(id).skill.requires), [null, 'paladin_aura', 'paladin_smite', 'paladin_crusade', 'paladin_sanctuary']);
    assert.equal(shared.CLASSES.PALADIN.cost, 600);
});

test('bonus XP sources: every task bonus is labelled, counted on the weekly board and capped', () => {
    const { BONUS_LABELS, WEEKLY_XP_SOURCES, REWARDS, LIMITS } = require('../src/constants');
    for (const key of Object.keys(BONUS_LABELS)) assert.ok(WEEKLY_XP_SOURCES.includes(key), `${key} counts for the weekly board`);
    assert.equal(REWARDS.FIRST_OF_DAY, 10);
    assert.equal(REWARDS.LIST_CLEARED, 25);
    assert.equal(LIMITS.LIST_CLEARED_PER_DAY, 5);
    assert.equal(LIMITS.EARLY_FINISH_MAX, 20);
    assert.equal(LIMITS.DEADLINE_BONUS_XP_PER_DAY, 100);
    assert.equal(LIMITS.SUBTASKS_DONE_XP_PER_DAY, 10);
});

test('streak chests: 7, 14 and 30 days pay 100, 250 and 600 XP and count for the weekly board', () => {
    const { STREAK_CHESTS, WEEKLY_XP_SOURCES } = require('../src/constants');
    assert.deepEqual(STREAK_CHESTS, { 7: 100, 14: 250, 30: 600 });
    assert.ok(WEEKLY_XP_SOURCES.includes('streak_chest'));
});

test('achievement rewards: a flat 25 XP, counted on the weekly board', () => {
    const { REWARDS, WEEKLY_XP_SOURCES, BONUS_LABELS } = require('../src/constants');
    assert.equal(REWARDS.ACHIEVEMENT, 25);
    assert.ok(WEEKLY_XP_SOURCES.includes('achievement_reward'));
    assert.ok(BONUS_LABELS.achievement_reward);
});

test('habit streaks: constants', () => {
    const { REWARDS, LIMITS, HABIT_PERIOD_DAYS, WEEKLY_XP_SOURCES } = require('../src/constants');
    assert.equal(REWARDS.HABIT_PER_STREAK, 2);
    assert.equal(LIMITS.HABIT_MAX, 20);
    assert.equal(LIMITS.HABIT_XP_PER_DAY, 60);
    assert.deepEqual(HABIT_PERIOD_DAYS, { daily: 1, weekly: 7, monthly: 28 });
    assert.ok(WEEKLY_XP_SOURCES.includes('habit_bonus'));
});

test('focus sessions: constants', () => {
    const { REWARDS, LIMITS, WEEKLY_XP_SOURCES } = require('../src/constants');
    assert.equal(REWARDS.FOCUS_XP_PER_MINUTE, 0.6);
    assert.deepEqual([LIMITS.FOCUS_MIN_MINUTES, LIMITS.FOCUS_MAX_MINUTES], [10, 90]);
    assert.equal(LIMITS.FOCUS_XP_PER_DAY, 100);
    assert.equal(LIMITS.FOCUS_SESSIONS_PER_DAY, 8);
    assert.equal(LIMITS.FOCUS_EXPIRE_MINUTES, 180);
    assert.ok(WEEKLY_XP_SOURCES.includes('focus_session'));
    assert.equal(Math.floor(90 * REWARDS.FOCUS_XP_PER_MINUTE), 54);
});

test('weekly review: constants', () => {
    const { REWARDS, LIMITS, WEEKLY_REVIEW_KEY, WEEKLY_XP_SOURCES } = require('../src/constants');
    assert.equal(REWARDS.WEEKLY_REVIEW, 40);
    assert.equal(LIMITS.WEEKLY_REVIEW_MIN_COMPLETED, 1);
    assert.equal(WEEKLY_REVIEW_KEY, 'WEEKLY_REVIEW');
    assert.ok(WEEKLY_XP_SOURCES.includes('weekly_review'));
});

test('quest periods: monthly runs from the first of the UTC month to the next first', () => {
    const jan = shared.questPeriod('monthly', new Date('2030-01-31T23:59:59Z'));
    assert.equal(jan.start, '2030-01-01');
    assert.equal(jan.endsAt.toISOString(), '2030-02-01T00:00:00.000Z');
    const dec = shared.questPeriod('monthly', new Date('2030-12-15T12:00:00Z'));
    assert.equal(dec.endsAt.toISOString(), '2031-01-01T00:00:00.000Z', 'rolls over the year');
    assert.equal(shared.questPeriod('monthly', new Date('2030-03-01T00:00:00Z')).start, '2030-03-01');
});

test('quest rotation: ISO week numbers pick one of four weekly quests', () => {
    assert.equal(shared.isoWeek(new Date('2030-01-07T10:00:00Z')), 2);
    assert.equal(shared.isoWeek(new Date('2030-01-01T10:00:00Z')), 1, 'Dec 31 to Jan 6 is week 1');
    assert.equal(shared.isoWeek(new Date('2021-01-03T10:00:00Z')), 53, 'a Sunday in early January can still be week 53');
    assert.equal(shared.isoWeek(new Date('2026-12-28T00:00:00Z')), 53);
    const week = (day) => shared.activeRotatingQuest(shared.ROTATING_QUESTS, new Date(`${day}T12:00:00Z`));
    assert.equal(week('2030-01-07'), shared.ROTATING_QUESTS[2], 'week 2 -> index 2');
    assert.equal(week('2030-01-10'), week('2030-01-07'), 'the whole week shares one quest');
    assert.equal(new Set([week('2030-01-07'), week('2030-01-14'), week('2030-01-21'), week('2030-01-28')]).size, 4);
    assert.equal(week('2030-02-04'), week('2030-01-07'), 'it repeats every four weeks');
    for (const key of shared.ROTATING_QUESTS) assert.ok(shared.QUESTS[key].rotating && shared.QUESTS[key].period === 'weekly');
    assert.deepEqual(shared.QUESTS.BOSS_COMPLETE_50, { name: 'Monthly Boss', emoji: '🐉', description: 'Complete 50 tasks this month', period: 'monthly', metric: 'completions', target: 50, reward: 400 });
});

test('prestige: +2% XP per prestige (max 10) in the final multiplier, and a title per step', () => {
    const base = (prestige) => shared.calculateFinalXP(user({ prestige }), [], 100, { context: { action: 'item_complete' }, rng: () => 0.99 }).finalXP;
    assert.equal(base(0), 100);
    assert.equal(base(1), 103, '+2% and +1 flat');
    assert.equal(base(5), 115);
    assert.equal(base(10), 130);
    assert.equal(base(25), 130, 'capped at 10 prestiges');
    // The percentage alone rounds away on a small reward; the flat part does not.
    const small = (prestige, action) => shared.calculateFinalXP(user({ prestige }), [], 10, { context: { action }, rng: () => 0.99 }).finalXP;
    assert.equal(small(1, 'item_complete'), 11);
    assert.equal(small(10, 'item_complete'), 22);
    assert.equal(small(10, 'item_add'), 12, 'only task completions get the flat part: this is just the 20%');
    assert.equal(shared.prestigeMultiplier({ prestige: 3 }), 0.06);
    assert.equal(shared.prestigeTitle(0), '');
    assert.equal(shared.prestigeTitle(1), 'Veteran');
    assert.equal(shared.prestigeTitle(99), shared.PRESTIGE_TITLES[10]);
    assert.equal(shared.PRESTIGE_TITLES.length, shared.PRESTIGE.MAX + 1);
    assert.equal(shared.PRESTIGE.MIN_LEVEL, 30);
    // XP achievements count the never-reset total, not the level-driving lifetime_xp.
    const keys = shared.evaluateAchievements({ lifetime_xp: 20, lifetime_xp_total: 5200 }, []).map((a) => a.key);
    assert.ok(keys.includes('XP_5000') && !keys.includes('XP_10000'));
});

test('cosmetics: a well-formed catalogue, requirement text and what an equipped row draws', () => {
    const { COSMETICS, COSMETIC_KINDS } = shared;
    for (const [id, c] of Object.entries(COSMETICS)) {
        assert.ok(id.startsWith(`${c.kind}_`), `${id} is named after its kind`);
        assert.ok(COSMETIC_KINDS.includes(c.kind));
        assert.ok(Number.isInteger(c.cost) && c.cost > 0 && c.name);
        if (c.kind !== 'title') assert.ok(c.color, `${id} has a colour`);
        if (c.kind === 'accent') assert.match(c.colorDark, /^#[0-9a-f]{6}$/, `${id} has a dark-theme colour`);
        for (const key of Object.keys(c.requires || {})) assert.ok(['level', 'prestige', 'achievement'].includes(key));
        if (c.requires?.achievement) assert.ok(shared.ACHIEVEMENTS[c.requires.achievement], `${id} names a real achievement`);
    }
    assert.ok(shared.SPEND_SOURCES.includes('cosmetic_purchase'));
    assert.equal(shared.requirementText({ level: 20 }), 'Reach level 20');
    assert.equal(shared.meetsRequirement({ level: 20 }, { player_level: 19 }, new Set()), false);
    assert.equal(shared.meetsRequirement({ achievement: 'FIRST_COMPLETE' }, {}, new Set(['FIRST_COMPLETE'])), true);
    const drawn = shared.describeEquipped({ equipped_title: 'title_diligent', equipped_frame: 'title_diligent', equipped_accent: 'accent_ocean', discord_id: '1' });
    assert.equal(drawn.title, 'the Diligent');
    assert.equal(drawn.frame, null, 'an id of the wrong kind is ignored');
    assert.equal(drawn.accent.id, 'accent_ocean');
    assert.ok(!JSON.stringify(drawn).includes('discord_id'));
    assert.deepEqual(shared.describeEquipped({ equipped_title: 'gone' }), { title: null, frame: null, accent: null });
});

test('the weekly modifier: one flat source is doubled each UTC ISO week, four in rotation', () => {
    const { SEASONS, currentSeason, isoWeek } = shared;
    assert.equal(SEASONS.length, 4);
    assert.deepEqual(SEASONS.map((s) => s.doubles), ['early_finish', 'overdue_clear', 'habit_bonus', 'list_cleared']);
    for (const s of SEASONS) {
        assert.ok(shared.WEEKLY_XP_SOURCES.includes(s.doubles), `${s.doubles} counts for the weekly board`);
        assert.ok(s.name && s.blurb);
    }
    const seen = new Set();
    for (let week = 0; week < 8; week++) {
        const at = new Date(Date.UTC(2030, 0, 7 + week * 7, 12)); // Mondays
        seen.add(currentSeason(SEASONS, at).key);
        assert.equal(currentSeason(SEASONS, at), SEASONS[isoWeek(at, null) % 4]);
    }
    assert.equal(seen.size, 4, 'all four come up');
});

test('the flat per-action skills (Valor, Fortify, Arcane Study, Multishot) only work with their own class', () => {
    const flat = ['hero_valor', 'tank_fortify', 'wizard_study', 'archer_multishot'].map((id) => sk(id, 2));
    for (const cls of ['DEFAULT', 'MONK', 'GAMBLER', 'PALADIN']) {
        const withSkills = shared.calculateFinalXP(user({ player_class: cls }), flat, 10, { rng: seq(0.99), now: 0, context: { action: 'item_complete' } }).finalXP;
        const without = shared.calculateFinalXP(user({ player_class: cls }), [], 10, { rng: seq(0.99), now: 0, context: { action: 'item_complete' } }).finalXP;
        assert.equal(withSkills, without, `${cls} cannot borrow flat skills from other trees`);
    }
    const tank = (skills) => shared.calculateFinalXP(user({ player_class: 'TANK', player_level: 6 }), skills, 10, { rng: seq(0.99) }).finalXP;
    assert.equal(tank([sk('tank_fortify', 2)]) - tank([]), 10, 'the Tank keeps Fortify');
});

test('Wizard Wisdom stops at WISDOM_MAX however high the level or the Tome goes', () => {
    const { CLASS_RULES } = shared;
    const burst = (level, completed) => shared.calculateClassXP(user({ player_class: 'WIZARD', player_level: level, wizard_counter: 4, total_items_completed: completed }), 10, { skills: [sk('wizard_tome')] }).bonusInfo.classBonus;
    assert.equal(burst(100, 0), CLASS_RULES.WIZARD.WISDOM_MAX * 2, 'level 100 pays the same Burst as the cap');
    assert.equal(burst(5000, 100000), burst(100, 0), 'a huge level and Tome change nothing');
    assert.equal(burst(10, 0), 20 * 2, 'below the cap Wisdom is still level x 2');
});

test('Tank Revenge pays REVENGE_PERCENT per level at the stack cap', () => {
    const { CLASS_RULES } = shared;
    const atCap = (skills) => shared.calculateFinalXP(user({ player_class: 'TANK', player_level: 30, tank_stacks: 99 }), skills, 100, { rng: seq(0.99) }).finalXP;
    const base = atCap([]);
    const withRevenge = atCap([sk('tank_revenge', 2)]);
    assert.equal(withRevenge, Math.floor(shared.calculateClassXP(user({ player_class: 'TANK', player_level: 30, tank_stacks: 99 }), 100, { skills: [sk('tank_revenge', 2)] }).finalXP * (1 + (2 * CLASS_RULES.TANK.REVENGE_PERCENT) / 100) + 1e-9));
    assert.ok(withRevenge > base);
});
