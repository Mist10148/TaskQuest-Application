'use strict';

// The second wave of skills: one new skill at the end of every class tree and three in the Default tree.

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../src');

const seq = (...values) => {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
};
const user = (overrides = {}) => ({ player_class: 'DEFAULT', player_level: 1, ...overrides });
const sk = (id, level = 1) => ({ skill_id: id, skill_level: level });
const NOON = Date.parse('2030-01-10T12:00:00Z');
const hoursAgo = (h) => new Date(NOON - h * 3600e3);

test('every new skill sits at the end of its chain with a real cost', () => {
    const expected = {
        default_scholar: ['DEFAULT', 1, 90, 'default_xp_boost'],
        default_nightshift: ['DEFAULT', 2, 80, 'default_scholar'],
        default_tidymind: ['DEFAULT', 2, 90, 'default_momentum'],
        hero_laststand: ['HERO', 1, 260, 'hero_rally'],
        gambler_loaded: ['GAMBLER', 1, 260, 'gambler_hothand'],
        assassin_vanish: ['ASSASSIN', 1, 260, 'assassin_bleed'],
        wizard_cantrip: ['WIZARD', 1, 280, 'wizard_tome'],
        archer_ricochet: ['ARCHER', 1, 280, 'archer_eagle'],
        tank_taunt: ['TANK', 1, 280, 'tank_anchor'],
        monk_meditation: ['MONK', 1, 300, 'monk_serenity'],
        artisan_prototype: ['ARTISAN', 1, 320, 'artisan_masterwork'],
        ranger_tracker: ['RANGER', 1, 240, 'ranger_secondwind'],
        necro_souleater: ['NECROMANCER', 1, 320, 'necro_lich'],
        paladin_aegis: ['PALADIN', 1, 300, 'paladin_sanctuary']
    };
    for (const [id, [tree, max, cost, requires]] of Object.entries(expected)) {
        const found = shared.findSkill(id);
        assert.equal(found.treeKey, tree, id);
        assert.equal(found.skill.maxLevel, max, id);
        assert.equal(found.skill.cost, cost, id);
        assert.equal(found.skill.requires, requires, id);
    }
});

test('Scholar: +15% XP on the first task of the day only', () => {
    const xp = (firstOfDay, action = 'item_complete') => shared.calculateFinalXP(user(), [sk('default_scholar')], 100, { context: { action, firstOfDay }, rng: seq(0.99) }).finalXP;
    assert.equal(xp(true), 115);
    assert.equal(xp(false), 100);
    assert.equal(xp(true, 'item_add'), 100, 'only a completion');
});

test('Night Shift: +5% per level between 21:00 and 05:00 in the player\'s own time', () => {
    const at = (iso, zone, level = 2) => shared.calculateFinalXP(user({ timezone: zone }), [sk('default_nightshift', level)], 100, { context: { action: 'item_complete' }, rng: seq(0.99), now: Date.parse(iso) }).finalXP;
    assert.equal(at('2030-01-10T22:00:00Z', 'UTC'), 110);
    assert.equal(at('2030-01-10T22:00:00Z', 'UTC', 1), 105);
    assert.equal(at('2030-01-10T04:59:00Z', 'UTC'), 110);
    assert.equal(at('2030-01-10T05:00:00Z', 'UTC'), 100);
    assert.equal(at('2030-01-10T12:00:00Z', 'UTC'), 100);
    // 22:00 UTC is 07:00 the next morning in Tokyo: not night there; 12:00 UTC is 21:00 in Tokyo
    assert.equal(at('2030-01-10T22:00:00Z', 'Asia/Tokyo'), 100);
    assert.equal(at('2030-01-10T12:00:00Z', 'Asia/Tokyo'), 110);
});

test('Tidy Mind and Last Stand: flat XP when the completion clears a list', () => {
    const xp = (skills, listCleared, action = 'item_complete') => shared.calculateFinalXP(user(), skills, 10, { context: { action, listCleared }, rng: seq(0.99) }).finalXP;
    assert.equal(xp([sk('default_tidymind', 2)], true), 10 + 16);
    assert.equal(xp([sk('default_tidymind', 2)], false), 10);
    assert.equal(xp([sk('hero_laststand')], true), 10 + 20);
    assert.equal(xp([sk('hero_laststand'), sk('default_tidymind')], true), 10 + 28);
    assert.equal(xp([sk('hero_laststand')], true, 'item_add'), 10, 'only a completion can clear a list');
});

test('Loaded Dice: a lucky roll never lands in the bottom quarter of the range', () => {
    const gambler = user({ player_class: 'GAMBLER' });
    const roll = (skills) => shared.calculateClassXP(gambler, 10, { skills, rng: seq(0, 0.99) });
    assert.equal(roll([]).bonusInfo.classBonus, 0, 'the lowest roll is 0 without the skill');
    assert.equal(roll([sk('gambler_loaded')]).bonusInfo.classBonus, 15, 'range 60, a quarter is 15');
    const high = shared.calculateClassXP(gambler, 10, { skills: [sk('gambler_loaded')], rng: seq(0.9, 0.99) });
    assert.equal(high.bonusInfo.classBonus, 54, 'high rolls are untouched');
});

test('Vanish: a decayed Assassin streak halves instead of resetting', () => {
    const base = { player_class: 'ASSASSIN', assassin_streak: 8, assassin_stacks: 6, assassin_last_at: hoursAgo(60) };
    const without = shared.calculateClassXP(user(base), 100, { now: NOON });
    assert.equal(without.userUpdates.assassin_streak, 1);
    const kept = shared.calculateClassXP(user(base), 100, { now: NOON, skills: [sk('assassin_vanish')] });
    assert.equal(kept.userUpdates.assassin_streak, 5, '8 halves to 4, then this action');
    assert.equal(kept.userUpdates.assassin_stacks, 4, '6 halves to 3, then one more stack');
    const alive = shared.calculateClassXP(user({ ...base, assassin_last_at: hoursAgo(10) }), 100, { now: NOON, skills: [sk('assassin_vanish')] });
    assert.equal(alive.userUpdates.assassin_streak, 9, 'inside the window nothing changes');
});

test('Cantrip: the 2nd and 4th action of a cycle add a quarter of the Wisdom', () => {
    const wizard = (counter, skills = []) => shared.calculateClassXP(user({ player_class: 'WIZARD', player_level: 10, wizard_counter: counter }), 10, { skills });
    const second = wizard(1, [sk('wizard_cantrip')]);
    assert.equal(second.bonusInfo.type, 'WIZARD_CANTRIP');
    assert.equal(second.bonusInfo.classBonus, 5, 'Wisdom 20, a quarter');
    assert.equal(wizard(3, [sk('wizard_cantrip')]).bonusInfo.type, 'WIZARD_CANTRIP', 'the 4th action');
    assert.equal(wizard(1).bonusInfo.type, 'WIZARD_CHARGE', 'nothing without the skill');
    assert.equal(wizard(2, [sk('wizard_cantrip')]).bonusInfo.type, 'WIZARD_COMBO', 'the combo and the burst win');
    assert.equal(wizard(4, [sk('wizard_cantrip')]).bonusInfo.type, 'WIZARD_BURST');
});

test('Ricochet: every Archer hit adds 1 XP per streak step', () => {
    const archer = user({ player_class: 'ARCHER', archer_streak: 4 });
    const hit = (skills) => shared.calculateClassXP(archer, 10, { skills, rng: seq(0.5, 0.99) });
    assert.equal(hit([sk('archer_ricochet')]).bonusInfo.classBonus - hit([]).bonusInfo.classBonus, 5, 'the streak is 5 after this hit');
    const miss = shared.calculateClassXP(archer, 10, { skills: [sk('archer_ricochet')], rng: seq(0.99) });
    assert.equal(miss.bonusInfo.type, 'ARCHER_MISS');
});

test('Taunt: completing a HIGH priority task adds an extra shield stack', () => {
    const tank = user({ player_class: 'TANK', player_level: 30, tank_stacks: 2 });
    const stacks = (context, skills) => shared.calculateClassXP(tank, 100, { skills, context }).userUpdates.tank_stacks;
    assert.equal(stacks({ action: 'item_complete', priority: 'HIGH' }, [sk('tank_taunt')]), 4);
    assert.equal(stacks({ action: 'item_complete', priority: 'LOW' }, [sk('tank_taunt')]), 3);
    assert.equal(stacks({ action: 'item_add', priority: 'HIGH' }, [sk('tank_taunt')]), 3);
    assert.equal(stacks({ action: 'item_complete', priority: 'HIGH' }, []), 3);
});

test('Meditation: the first action of a new day pays double the Monk bonus', () => {
    const monk = (day) => user({ player_class: 'MONK', monk_rhythm: 5, monk_day: day });
    const bonus = (day, skills) => shared.calculateClassXP(monk(day), 100, { now: NOON, skills }).bonusInfo.classBonus;
    assert.equal(bonus('2030-01-09', []), 18);
    assert.equal(bonus('2030-01-09', [sk('monk_meditation')]), 36, 'a new day, Rhythm 6');
    assert.equal(bonus('2030-01-10', [sk('monk_meditation')]), 15, 'later the same day it is not doubled');
    assert.equal(shared.calculateClassXP(user({ player_class: 'MONK' }), 100, { now: NOON, skills: [sk('monk_meditation')] }).bonusInfo.classBonus, 6, 'the very first action counts as a new day: 3 doubled');
});

test('Prototype: a finished project keeps 75% of its progress', () => {
    const artisan = user({ player_class: 'ARTISAN', artisan_progress: 9 });
    const clear = (skills) => shared.calculateClassXP(artisan, 10, { skills, context: { action: 'item_complete', listCleared: true } }).userUpdates.artisan_progress;
    assert.equal(clear([]), 5, '10 progress halves');
    assert.equal(clear([sk('artisan_prototype')]), 7);
});

test('Tracker: Ranger actions that are not early, on time or late pay +4 more', () => {
    const ranger = user({ player_class: 'RANGER' });
    const r = (context, skills) => shared.calculateClassXP(ranger, 10, { context, skills });
    assert.equal(r({ action: 'item_complete', dueDate: null }, []).bonusInfo.classBonus, 5);
    assert.equal(r({ action: 'item_complete', dueDate: null }, [sk('ranger_tracker')]).bonusInfo.classBonus, 9);
    assert.equal(r({ action: 'item_add' }, [sk('ranger_tracker')]).bonusInfo.classBonus, 9);
    const early = { action: 'item_complete', today: '2030-01-10', dueDate: '2030-01-12' };
    assert.equal(r(early, [sk('ranger_tracker')]).bonusInfo.classBonus, r(early, []).bonusInfo.classBonus, 'dated tasks are untouched');
});

test('Soul Eater: a revive pays 25% more while 3 or more souls are held', () => {
    const necro = (souls) => user({ player_class: 'NECROMANCER', necro_souls: souls });
    const revive = { action: 'item_complete', overdueDays: 2 };
    const bonus = (souls, skills) => shared.calculateClassXP(necro(souls), 100, { context: revive, skills }).bonusInfo.classBonus;
    const plain = bonus(2, []); // 3 souls after this revive: 156 + 24
    assert.equal(plain, 156 + 24);
    assert.equal(bonus(2, [sk('necro_souleater')]), Math.floor(156 * 1.25) + 24, 'the third soul counts');
    assert.equal(bonus(1, [sk('necro_souleater')]), 156 + 16, 'only two souls after this revive: nothing');
});

test('Aegis: the +8 on non-HIGH Paladin actions is 50% larger', () => {
    const paladin = user({ player_class: 'PALADIN' });
    const other = (skills, context = { action: 'item_complete', priority: 'LOW' }) => shared.calculateClassXP(paladin, 10, { skills, context }).bonusInfo.classBonus;
    assert.equal(other([]), 8);
    assert.equal(other([sk('paladin_aegis')]), 12);
    assert.equal(other([sk('paladin_aegis')], { action: 'item_complete', priority: 'HIGH' }), 20, 'a Vow is untouched');
});
