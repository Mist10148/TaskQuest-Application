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
    assert.equal(seen.size, 27);
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

    const tank = shared.calculateClassXP(user({ player_class: 'TANK', player_level: 30, tank_stacks: 3 }), 100);
    assert.equal(tank.userUpdates.tank_stacks, 3, 'stack cap is max(3, 20 - level)');

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
