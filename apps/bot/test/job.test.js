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

test('stopJobs keeps new runs from starting and whenIdle waits for the one in flight', async () => {
    const { stopJobs, whenIdle, resetJobs } = require('../utils/job');
    let release;
    const gate = new Promise((r) => (release = r));
    let finished = false;
    const j = job('SLOW', async () => {
        await gate;
        finished = true;
    }, () => {});
    const run = j();
    assert.equal(await whenIdle(20), false, 'still running after the limit');
    stopJobs();
    let started = false;
    await job('LATE', async () => { started = true; }, () => {})();
    assert.equal(started, false, 'no run starts after stopJobs');
    release();
    assert.equal(await whenIdle(1000), true);
    assert.equal(finished, true);
    await run;
    resetJobs();
});
