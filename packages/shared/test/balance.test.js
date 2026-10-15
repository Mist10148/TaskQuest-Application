'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../../../scripts/balance-sim');

test('the balance sim is deterministic', () => {
    assert.equal(sim.perAction('GAMBLER', { level: 6 }), sim.perAction('GAMBLER', { level: 6 }));
});

test('a Default player earns exactly the base', () => {
    assert.equal(sim.perAction('DEFAULT', { level: 6 }), 10);
});

test('every class is simulated with a full tree', () => {
    for (const cls of sim.PURCHASABLE) {
        const { rows, cost } = sim.fullTree(cls);
        assert.ok(rows.length >= 4 && cost > 0, cls);
        assert.ok(Number.isFinite(sim.paybackTasks(cls)), `${cls} never pays back`);
    }
});

test('adding a task and creating a list are capped at 4x the base for every class and tree', () => {
    const { SMALL_ACTION_CAP } = require('../src');
    for (const cls of ['DEFAULT', ...sim.PURCHASABLE]) {
        for (const level of [6, 29]) {
            for (const [action, base] of [['item_add', 5], ['list_create', 10]]) {
                const avg = sim.perAction(cls, { level, tree: 'full', action, base, perDay: 20 });
                assert.ok(avg <= base * SMALL_ACTION_CAP.MAX_MULTIPLE, `${cls} L${level} ${action}: ${avg}`);
            }
        }
    }
});

test('class power stays inside the balance bands (per task, base 10, levels 6 / 16 / 29)', () => {
    for (const cls of sim.PURCHASABLE) {
        const mix = sim.FAVOURABLE[cls] || 'plain';
        for (const level of [6, 16, 29]) {
            const none = sim.perAction(cls, { level });
            const plain = sim.perAction(cls, { level, tree: 'full' });
            const favourable = sim.perAction(cls, { level, tree: 'full', mix });
            assert.ok(none <= 50, `${cls} L${level}: no skills pays ${none.toFixed(1)}, over 5x the base`);
            assert.ok(plain <= 160, `${cls} L${level}: the full tree pays ${plain.toFixed(1)}, over 16x the base`);
            assert.ok(favourable >= 25, `${cls} L${level}: the full tree on its favourable mix pays only ${favourable.toFixed(1)}`);
        }
        const payback = sim.paybackTasks(cls);
        assert.ok(payback >= 15 && payback <= 70, `${cls}: class and tree repay in ${payback} tasks`);
    }
});

test('borrowing skills from other trees stays modest: a Default player with every skill of every tree earns under 3x the base', () => {
    const { SKILL_TREES } = require('../src');
    const rows = [];
    for (const tree of Object.values(SKILL_TREES)) {
        for (const [id, s] of Object.entries(tree.skills)) rows.push({ skill_id: id, skill_level: s.maxLevel });
    }
    const { simulateAverage } = require('../src');
    for (const level of [6, 29, 100]) {
        const avg = simulateAverage('DEFAULT', rows, { level });
        assert.ok(avg <= 30, `L${level}: Default with every skill of every tree pays ${avg.toFixed(1)} on a 10 XP task`);
    }
});

test('level-scaled classes stop growing: the Wizard at level 100 pays what it does at the Wisdom cap', () => {
    const cap = sim.perAction('WIZARD', { level: 30, tree: 'full' });
    assert.equal(sim.perAction('WIZARD', { level: 100, tree: 'full' }), cap);
    assert.equal(sim.perAction('WIZARD', { level: 500 }), sim.perAction('WIZARD', { level: 30 }));
    for (const cls of ['HERO', 'TANK', 'ARCHER']) {
        assert.ok(sim.perAction(cls, { level: 500, tree: 'full' }) <= sim.perAction(cls, { level: 30, tree: 'full' }) * 1.1, `${cls} keeps growing with level`);
    }
});

test('no class tops 13x the base on a plain task with its full tree, or 10x with no skills at its cap level', () => {
    for (const cls of sim.PURCHASABLE) {
        assert.ok(sim.perAction(cls, { level: 30, tree: 'full' }) <= 130, `${cls} full tree`);
        assert.ok(sim.perAction(cls, { level: 30 }) <= 50, `${cls} no skills`);
    }
});
