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
    assert.equal(seen.size, 46);
    assert.equal(shared.findSkill('__proto__'), null);
});

test('class mechanics', () => {
    const base = 10;
    assert.equal(shared.calculateClassXP(user(), base).finalXP, 10);
    assert.equal(shared.calculateClassXP(user({ player_class: 'HERO' }), base).finalXP, 35);

    const assassin = shared.calculateClassXP(user({ player_class: 'ASSASSIN', assassin_streak: 2, assassin_stacks: 9 }), 100);
    assert.equal(assassin.userUpdates.assassin_stacks, 10);
    assert.equal(assassin.finalXP, 150);

    const wizard = shared.calculateClassXP(user({ player_class: 'WIZARD', player_level: 4, wizard_counter: 4 }), base);
    assert.equal(wizard.finalXP, 10 + 4 * 5 * 2, 'burst on 5th action');
    assert.equal(wizard.userUpdates.wizard_counter, 0);

    const tank = shared.calculateClassXP(user({ player_class: 'TANK', player_level: 30, tank_stacks: 99 }), 100);
    assert.equal(tank.userUpdates.tank_stacks, 13, 'stack cap is min(15, 3 + level / 3)');

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
    assert.equal(r.finalXP, 110 + 10);

    const champ = shared.calculateFinalXP(user({ player_level: 5 }), [{ skill_id: 'hero_champion', skill_level: 1 }], 10, { rng: seq(0.99) });
    assert.equal(champ.finalXP, 20);

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

test('Tank stack cap is min(15, 3 + floor(level / 3)) + 2 per Absorb', () => {
    // [level, absorb levels, expected cap]
    const cases = [[1, 0, 3], [3, 0, 4], [8, 0, 5], [30, 0, 13], [36, 0, 15], [90, 0, 15], [1, 1, 5], [1, 2, 7], [12, 2, 11], [90, 2, 19]];
    for (const [level, absorb, cap] of cases) {
        const skills = absorb ? [{ skill_id: 'tank_absorb', skill_level: absorb }] : [];
        // level 30 gives 3 + 10 = 13 (the 15 ceiling is only hit from level 36)
        assert.equal(shared.tankStackCap(level, skills), level === 30 ? 13 : cap, `level ${level} absorb ${absorb}`);
        const r = shared.calculateClassXP(user({ player_class: 'TANK', player_level: level, tank_stacks: 99 }), 100, { skills });
        assert.equal(r.userUpdates.tank_stacks, shared.tankStackCap(level, skills), 'stacks are clamped to the cap');
    }
});

test('Assassin streak and stacks decay after 36 hours idle and every action stamps assassin_last_at', () => {
    const base = { player_class: 'ASSASSIN', assassin_streak: 6, assassin_stacks: 7 };
    // [label, last action, expected streak, expected stacks, expected type]
    const cases = [
        ['inside the window', hoursAgo(35), 7, 8, 'ASSASSIN'],
        ['exactly 36h is still alive', hoursAgo(36), 7, 8, 'ASSASSIN'],
        ['past the window', hoursAgo(37), 1, 0, 'ASSASSIN_BUILDING'],
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
    const swift = shared.calculateClassXP(user({ ...base, assassin_last_at: hoursAgo(40) }), 100, {
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

test('Assassin Night Owl: decay window is 48h', () => {
    const base = { player_class: 'ASSASSIN', assassin_streak: 5, assassin_stacks: 5 };
    // [hours idle, skills, expected streak after the action]
    const cases = [[40, [], 1], [40, [sk('assassin_nightowl')], 6], [48, [sk('assassin_nightowl')], 6], [49, [sk('assassin_nightowl')], 1]];
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

    // Tome: wisdom = level * 5 + floor(tasks / 20); [tasks done, expected combo XP (= wisdom)]
    for (const [done, wisdom] of [[0, 20], [19, 20], [20, 21], [95, 24], [400, 40]]) {
        const combo = w({ wizard_counter: 2, total_items_completed: done }, [sk('wizard_tome')]);
        assert.equal(combo.bonusInfo.classBonus, wisdom, `${done} tasks`);
    }
    assert.equal(w({ wizard_counter: 2, total_items_completed: 400 }).bonusInfo.classBonus, 20, 'no Tome, no growth');
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
    assert.equal(tank(12, [sk('tank_bulwark')]).userUpdates.tank_stacks, 13, 'still clamped to the cap (13 at level 30)');

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

test('Monk Rhythm: consecutive UTC days build it, a missed day resets it, bonus = 3% x rhythm + rhythm', () => {
    const monk = (rhythm, day) => user({ player_class: 'MONK', monk_rhythm: rhythm, monk_day: day });
    // [label, rhythm, last day, skills, base, expected rhythm, expected bonus]
    const cases = [
        ['first action ever', 0, null, [], 100, 1, 4],
        ['same day keeps rhythm', 5, '2030-01-10', [], 100, 5, 20],
        ['yesterday adds one', 5, '2030-01-09', [], 100, 6, 24],
        ['two days ago resets', 5, '2030-01-08', [], 100, 1, 4],
        ['two days ago, Serenity forgives', 5, '2030-01-08', [sk('monk_serenity')], 100, 6, 24],
        ['three days ago, Serenity does not', 5, '2030-01-07', [sk('monk_serenity')], 100, 1, 4],
        ['rhythm is capped at 14', 14, '2030-01-09', [], 100, 14, 42 + 14],
        ['Discipline lifts the cap to 18', 14, '2030-01-09', [sk('monk_discipline')], 100, 15, 45 + 15],
        ['Discipline cap holds at 18', 18, '2030-01-09', [sk('monk_discipline')], 100, 18, 54 + 18],
        ['Steady Breath adds 1 XP per rhythm day per level', 5, '2030-01-10', [sk('monk_breath', 2)], 100, 5, 15 + 5 * 3],
        ['Inner Focus adds 25% per level', 5, '2030-01-10', [sk('monk_focus', 2)], 100, 5, 30],
        ['small actions still get the flat part', 3, '2030-01-10', [], 10, 3, 3],
        ['a DATE returned as a Date object works', 5, new Date('2030-01-09T00:00:00Z'), [], 100, 6, 24]
    ];
    for (const [label, rhythm, day, skills, base, expectedRhythm, expectedBonus] of cases) {
        const r = shared.calculateClassXP(monk(rhythm, day), base, { now: NOW, skills });
        assert.equal(r.userUpdates.monk_rhythm, expectedRhythm, `${label}: rhythm`);
        assert.equal(r.userUpdates.monk_day, '2030-01-10', `${label}: day stamp`);
        assert.equal(r.bonusInfo.classBonus, expectedBonus, `${label}: bonus`);
        assert.equal(r.finalXP, base + expectedBonus, `${label}: final`);
    }
});

test('Monk tree: four skills in a chain, each with an implemented effect', () => {
    const ids = Object.keys(shared.SKILL_TREES.MONK.skills);
    assert.deepEqual(ids, ['monk_breath', 'monk_focus', 'monk_discipline', 'monk_serenity']);
    assert.deepEqual(ids.map((id) => shared.findSkill(id).skill.requires), [null, 'monk_breath', 'monk_focus', 'monk_discipline']);
    assert.equal(shared.CLASSES.MONK.cost, 550);
});
