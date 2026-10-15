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
