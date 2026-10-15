'use strict';

// The classes added after the first twelve: Bard, Alchemist, Druid, Chronomancer and Warden.

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../src');

const user = (overrides = {}) => ({ player_class: 'DEFAULT', player_level: 1, ...overrides });
const sk = (id, level = 1) => ({ skill_id: id, skill_level: level });
const calc = (u, base, skills, context) => shared.calculateClassXP(u, base, { skills, context });

function checkTree(treeKey, ids, cost) {
    const tree = shared.SKILL_TREES[treeKey];
    assert.deepEqual(Object.keys(tree.skills), ids);
    assert.deepEqual(ids.map((id) => shared.findSkill(id).skill.requires), [null, ...ids.slice(0, -1)]);
    assert.equal(shared.CLASSES[treeKey].cost, cost);
    assert.ok(shared.PURCHASABLE_CLASS_KEYS.includes(treeKey));
    assert.equal(shared.classOwnershipColumn(treeKey), `owns_${treeKey.toLowerCase()}`);
}

// ─── Bard ────────────────────────────────────────────────────────────────────

test('Bard medley: every list beyond the first among the last 5 completions pays 4% + 3 XP', () => {
    const bard = (recent) => user({ player_class: 'BARD', bard_recent: recent });
    const done = (listId, extra = {}) => ({ action: 'item_complete', listId, ...extra });
    // [label, recent lists, list, skills, context extras, expected bonus, expected recent]
    const cases = [
        ['the first task ever pays the flat +2', '', 7, [], {}, 2, '7'],
        ['one list over and over pays the flat +2', '1,1,1,1', 1, [], {}, 2, '1,1,1,1,1'],
        ['five different lists is a medley of 4 steps', '1,2,3,4', 5, [], {}, 13, '1,2,3,4,5'],
        ['the window keeps the last 5', '1,2,3,4,5', 6, [], {}, 13, '2,3,4,5,6'],
        ['two lists: one step', '1,1,1,2', 1, [], {}, 3, '1,1,1,2,1'],
        ['Encore adds 1 per step per level', '1,2,3,4', 5, [sk('bard_encore', 2)], {}, 21, '1,2,3,4,5'],
        ['Harmony looks at 7 completions', '1,2,3,4,5,6', 7, [sk('bard_harmony')], {}, 20, '1,2,3,4,5,6,7'],
        ['Crescendo: +25% on a full medley', '1,2,3,4', 5, [sk('bard_crescendo')], {}, 16, '1,2,3,4,5'],
        ['Crescendo only on a full medley', '1,1,3,4', 5, [sk('bard_crescendo')], {}, 10, '1,1,3,4,5'],
        ['Ballad: the first task of the day is a full medley', '', 1, [sk('bard_ballad')], { firstOfDay: true }, 13, '1'],
        ['Ballad does nothing later in the day', '', 1, [sk('bard_ballad')], { firstOfDay: false }, 2, '1']
    ];
    for (const [label, recent, listId, skills, extra, bonus, expectedRecent] of cases) {
        const r = calc(bard(recent), 10, skills, done(listId, extra));
        assert.equal(r.bonusInfo.classBonus, bonus, `${label}: bonus`);
        assert.equal(r.finalXP, 10 + bonus, `${label}: final`);
        assert.equal(r.userUpdates.bard_recent, expectedRecent, `${label}: recent`);
    }
    const add = calc(bard('1,2,3,4'), 10, [], { action: 'item_add' });
    assert.equal(add.bonusInfo.classBonus, 2);
    assert.equal(add.userUpdates.bard_recent, undefined, 'only completions change the medley');
    assert.equal(calc(bard('1,2,3,4'), 10, [], { action: 'item_complete', listId: 5 }).bonusInfo.type, 'BARD_MEDLEY');
});

test('Bard tree: four chained skills', () => {
    checkTree('BARD', ['bard_encore', 'bard_harmony', 'bard_crescendo', 'bard_ballad'], 600);
});

// ─── Alchemist ───────────────────────────────────────────────────────────────

test('Alchemist brew: +2 per ingredient, and the third different priority finishes the brew', () => {
    const alch = (mix) => user({ player_class: 'ALCHEMIST', alchemist_mix: mix });
    const done = (priority) => ({ action: 'item_complete', priority });
    // [label, mix before, priority, skills, expected type, expected bonus, expected mix after]
    const cases = [
        ['the first ingredient', 0, 'MEDIUM', [], 'ALCHEMIST', 2, 2],
        ['a second ingredient', 2, 'LOW', [], 'ALCHEMIST', 4, 3],
        ['the same priority again adds nothing', 2, 'MEDIUM', [], 'ALCHEMIST', 2, 2],
        ['the third priority finishes the brew', 3, 'HIGH', [], 'ALCHEMIST_BREW', 30, 0],
        ['any order works', 5, 'MEDIUM', [], 'ALCHEMIST_BREW', 30, 0],
        ['no priority counts as MEDIUM', 5, undefined, [], 'ALCHEMIST_BREW', 30, 0],
        ['Catalyst adds 5 per level to a brew', 3, 'HIGH', [sk('alch_catalyst', 2)], 'ALCHEMIST_BREW', 40, 0],
        ['Elixir doubles the ingredient pay', 2, 'LOW', [sk('alch_elixir')], 'ALCHEMIST', 8, 3],
        ['Transmute: a brew pays 50% more', 3, 'HIGH', [sk('alch_transmute')], 'ALCHEMIST_BREW', 45, 0],
        ['Distill: the next brew starts with MEDIUM', 3, 'HIGH', [sk('alch_distill')], 'ALCHEMIST_BREW', 30, 2]
    ];
    for (const [label, mix, priority, skills, type, bonus, after] of cases) {
        const r = calc(alch(mix), 10, skills, done(priority));
        assert.equal(r.bonusInfo.type, type, `${label}: type`);
        assert.equal(r.bonusInfo.classBonus, bonus, `${label}: bonus`);
        assert.equal(r.userUpdates.alchemist_mix, after, `${label}: mix`);
        assert.equal(r.finalXP, 10 + bonus, `${label}: final`);
    }
    const add = calc(alch(3), 10, [], { action: 'item_add', priority: 'HIGH' });
    assert.equal(add.bonusInfo.classBonus, 2);
    assert.equal(add.userUpdates.alchemist_mix, undefined, 'only completions change the brew');
});

test('Alchemist tree: four chained skills', () => {
    checkTree('ALCHEMIST', ['alch_catalyst', 'alch_elixir', 'alch_transmute', 'alch_distill'], 650);
});

// ─── Druid ───────────────────────────────────────────────────────────────────

test('Druid habits: repeating tasks pay for their habit streak, everything else +3', () => {
    const druid = user({ player_class: 'DRUID' });
    const habit = (habitStreak, recurrence = 'daily') => ({ action: 'item_complete', recurring: true, habitStreak, recurrence });
    // [label, context, skills, expected type, expected bonus]
    const cases = [
        ['a plain completion', { action: 'item_complete', recurring: false, habitStreak: 9 }, [], 'DRUID', 3],
        ['other actions', { action: 'item_add' }, [], 'DRUID', 3],
        ['a repeating task with no streak', habit(0), [], 'DRUID_HABIT', 3],
        ['streak 5', habit(5), [], 'DRUID_HABIT', 3 + 10],
        ['the streak counts up to 10', habit(20), [], 'DRUID_HABIT', 6 + 20],
        ['Roots: +1 per step per level', habit(5), [sk('druid_roots', 2)], 'DRUID_HABIT', 3 + 5 * 4],
        ['Bloom: up to 15 steps', habit(20), [sk('druid_bloom')], 'DRUID_HABIT', 9 + 30],
        ['Seasons: a weekly habit counts twice', habit(4, 'weekly'), [sk('druid_seasons')], 'DRUID_HABIT', 4 + 16],
        ['Seasons: a daily habit does not', habit(4, 'daily'), [sk('druid_seasons')], 'DRUID_HABIT', 2 + 8],
        ['Grove: other actions +3 more', { action: 'item_add' }, [sk('druid_grove')], 'DRUID', 6],
        ['Grove is the floor for a habit with no streak', habit(0), [sk('druid_grove')], 'DRUID_HABIT', 6]
    ];
    for (const [label, context, skills, type, bonus] of cases) {
        const r = calc(druid, 10, skills, context);
        assert.equal(r.bonusInfo.type, type, `${label}: type`);
        assert.equal(r.bonusInfo.classBonus, bonus, `${label}: bonus`);
        assert.equal(r.finalXP, 10 + bonus, `${label}: final`);
    }
    assert.deepEqual(calc(druid, 10, [], habit(5)).userUpdates, {}, 'no counter column: the streak lives on the task');
});

test('Druid tree: four chained skills', () => {
    checkTree('DRUID', ['druid_roots', 'druid_bloom', 'druid_seasons', 'druid_grove'], 600);
});

// ─── Chronomancer ────────────────────────────────────────────────────────────

test('Chronomancer flow: the first 3 tasks within 30 minutes of a focus session pay +100% and 5', () => {
    const chrono = user({ player_class: 'CHRONOMANCER' });
    const done = (minutes, completions, extra = {}) => ({ action: 'item_complete', afterFocus: { minutes, completions }, ...extra });
    // [label, context, skills, expected type, expected bonus]
    const cases = [
        ['no focus session', { action: 'item_complete' }, [], 'CHRONOMANCER', 2],
        ['right after a session', done(0, 0), [], 'CHRONOMANCER_FLOW', 15],
        ['30 minutes is still in the flow', done(30, 2), [], 'CHRONOMANCER_FLOW', 15],
        ['31 minutes is too late', done(31, 0), [], 'CHRONOMANCER', 2],
        ['the 4th task is out of the flow', done(5, 3), [], 'CHRONOMANCER', 2],
        ['other actions', { action: 'item_add', afterFocus: { minutes: 1, completions: 0 } }, [], 'CHRONOMANCER', 2],
        ['Hourglass: +5 per level', done(5, 0), [sk('chrono_hourglass', 3)], 'CHRONOMANCER_FLOW', 30],
        ['Time Dilation: 45 minutes', done(45, 0), [sk('chrono_dilation')], 'CHRONOMANCER_FLOW', 15],
        ['Time Dilation: 46 is too late', done(46, 0), [sk('chrono_dilation')], 'CHRONOMANCER', 2],
        ['Echo: 5 tasks', done(5, 4), [sk('chrono_echo')], 'CHRONOMANCER_FLOW', 15],
        ['Echo: the 6th is out', done(5, 5), [sk('chrono_echo')], 'CHRONOMANCER', 2],
        ['Temporal Surge on the first task of the day', done(5, 0, { firstOfDay: true }), [sk('chrono_surge')], 'CHRONOMANCER_FLOW', 18],
        ['Temporal Surge later in the day', done(5, 0, { firstOfDay: false }), [sk('chrono_surge')], 'CHRONOMANCER_FLOW', 15]
    ];
    for (const [label, context, skills, type, bonus] of cases) {
        const r = calc(chrono, 10, skills, context);
        assert.equal(r.bonusInfo.type, type, `${label}: type`);
        assert.equal(r.bonusInfo.classBonus, bonus, `${label}: bonus`);
        assert.equal(r.finalXP, 10 + bonus, `${label}: final`);
    }
});

test('Chronomancer tree: four chained skills', () => {
    checkTree('CHRONOMANCER', ['chrono_hourglass', 'chrono_dilation', 'chrono_echo', 'chrono_surge'], 650);
});

// ─── Warden ──────────────────────────────────────────────────────────────────

test('Warden guard: tasks on a shared list pay for the people on it', () => {
    const warden = user({ player_class: 'WARDEN' });
    const done = (sharedMembers, extra = {}) => ({ action: 'item_complete', sharedMembers, ...extra });
    // [label, context, skills, expected type, expected bonus]
    const cases = [
        ['a list nobody else is on', done(0), [], 'WARDEN', 2],
        ['one other person', done(1), [], 'WARDEN_SHARED', 1 + 2],
        ['three other people', done(3), [], 'WARDEN_SHARED', 3 + 6],
        ['the count stops at 5', done(9), [], 'WARDEN_SHARED', 5 + 10],
        ['other actions', { action: 'item_add', sharedMembers: 4 }, [], 'WARDEN', 2],
        ['Beacon: +2 per person per level', done(3), [sk('warden_beacon', 2)], 'WARDEN_SHARED', 3 + 3 * 6],
        ['Shield Wall: up to 8 people', done(9), [sk('warden_wall')], 'WARDEN_SHARED', 8 + 16],
        ['Rally Cry: +25% with 3 or more people', done(3), [sk('warden_rally')], 'WARDEN_SHARED', Math.floor(9 * 1.25)],
        ['Rally Cry: nothing with 2 people', done(2), [sk('warden_rally')], 'WARDEN_SHARED', 2 + 4],
        ['Vigil: +15 when the list is cleared', done(2, { listCleared: true }), [sk('warden_vigil')], 'WARDEN_SHARED', 2 + 4 + 15],
        ['Vigil does nothing on a solo list', done(0, { listCleared: true }), [sk('warden_vigil')], 'WARDEN', 2]
    ];
    for (const [label, context, skills, type, bonus] of cases) {
        const r = calc(warden, 10, skills, context);
        assert.equal(r.bonusInfo.type, type, `${label}: type`);
        assert.equal(r.bonusInfo.classBonus, bonus, `${label}: bonus`);
        assert.equal(r.finalXP, 10 + bonus, `${label}: final`);
    }
});

test('Warden tree: four chained skills', () => {
    checkTree('WARDEN', ['warden_beacon', 'warden_wall', 'warden_rally', 'warden_vigil'], 600);
});

test('every class is wired end to end: ownership column, tree, rules and a colour', () => {
    const { CLASS_KEYS, SKILL_TREES, CLASSES } = shared;
    assert.equal(CLASS_KEYS.length, 17);
    for (const key of CLASS_KEYS) {
        assert.ok(CLASSES[key].emoji && CLASSES[key].description && CLASSES[key].playstyle, key);
        assert.ok(SKILL_TREES[key], `${key} has a skill tree`);
        if (key !== 'DEFAULT') {
            assert.ok(shared.CLASS_RULES[key], `${key} has rules`);
            assert.ok(shared.classOwnershipColumn(key), `${key} has an ownership column`);
        }
    }
});
