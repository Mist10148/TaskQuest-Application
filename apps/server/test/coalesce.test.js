import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesce } from '../lib/coalesce.js';

test('concurrent callers with the same key share one run', async () => {
    const inflight = new Map();
    let runs = 0;
    const slow = async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 20));
        return runs;
    };
    const results = await Promise.all([coalesce(inflight, 'a', slow), coalesce(inflight, 'a', slow), coalesce(inflight, 'a', slow)]);
    assert.deepEqual(results, [1, 1, 1]);
    assert.equal(runs, 1);
    assert.equal(inflight.size, 0);
});

test('different keys run separately, and a later call runs again', async () => {
    const inflight = new Map();
    let runs = 0;
    const fn = async () => ++runs;
    await Promise.all([coalesce(inflight, 'a', fn), coalesce(inflight, 'b', fn)]);
    assert.equal(runs, 2);
    await coalesce(inflight, 'a', fn);
    assert.equal(runs, 3);
});

test('a failure is shared by the waiting callers and not remembered', async () => {
    const inflight = new Map();
    let runs = 0;
    const boom = async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 10));
        throw new Error('db down');
    };
    const settled = await Promise.allSettled([coalesce(inflight, 'k', boom), coalesce(inflight, 'k', boom)]);
    assert.deepEqual(settled.map((s) => s.status), ['rejected', 'rejected']);
    assert.equal(runs, 1);
    assert.equal(inflight.size, 0);
    assert.equal(await coalesce(inflight, 'k', async () => 'ok'), 'ok');
});
