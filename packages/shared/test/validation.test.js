'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/validation');

test('id accepts positive ids up to the INTEGER column limit', () => {
    assert.equal(v.id('1').ok, true);
    assert.equal(v.id(v.MAX_ID).ok, true);
    assert.equal(v.id(String(v.MAX_ID)).value, v.MAX_ID);
});

test('bigId accepts the ids of BIGSERIAL rows past the INTEGER limit, and still rejects junk', () => {
    assert.equal(v.bigId(v.MAX_ID + 1).value, v.MAX_ID + 1);
    assert.equal(v.bigId('99999999999').ok, true);
    for (const bad of [0, -1, 1.5, 'abc', '', NaN, Number.MAX_SAFE_INTEGER + 2]) assert.equal(v.bigId(bad).ok, false, `${String(bad)} should be rejected`);
});

test('id rejects zero, negatives, fractions, junk and ids no row can have', () => {
    for (const bad of [0, -1, 1.5, 'abc', '', NaN, v.MAX_ID + 1, 99999999999, Number.MAX_SAFE_INTEGER]) {
        assert.equal(v.id(bad).ok, false, `${String(bad)} should be rejected`);
    }
});
