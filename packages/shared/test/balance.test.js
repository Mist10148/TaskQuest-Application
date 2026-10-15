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
