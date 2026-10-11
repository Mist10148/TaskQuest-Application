'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { job } = require('../utils/job');

test('a job never overlaps itself and recovers after a failure', async () => {
    const logs = [];
    let runs = 0;
    let release;
    const gate = new Promise((r) => (release = r));
    const j = job('X', async () => {
        runs++;
        if (runs === 1) await gate;
        if (runs === 2) throw new Error('boom');
    }, (...a) => logs.push(a.join(' ')));

    const first = j();
    await j(); // overlaps the first: skipped
    assert.equal(runs, 1);
    release();
    await first;
    await j(); // runs again, fails, is logged
    assert.equal(runs, 2);
    assert.ok(logs.some((l) => /boom/.test(l)));
    await j(); // the failure released the guard
    assert.equal(runs, 3);
});
