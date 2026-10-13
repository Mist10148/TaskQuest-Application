'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { secureRandom, randomInt, shuffle } = require('../src/random');

test('secureRandom stays in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
        const n = secureRandom();
        assert.ok(n >= 0 && n < 1);
    }
});

test('randomInt maps an injected rng onto [0, max)', () => {
    assert.equal(randomInt(10, () => 0), 0);
    assert.equal(randomInt(10, () => 0.999999), 9);
    assert.equal(randomInt(6, () => 0.5), 3);
});

test('shuffle returns a new array with the same members and is deterministic for a fixed rng', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, () => 0);
    assert.deepEqual(input, [1, 2, 3, 4, 5], 'input untouched');
    assert.deepEqual([...out].sort(), input);
    assert.deepEqual(shuffle(input, () => 0), out);
    assert.deepEqual(shuffle([], () => 0), []);
});
