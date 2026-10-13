import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrustProxy } from '../lib/trustProxy.js';

test('TRUST_PROXY accepts booleans, hop counts and subnet lists', () => {
    assert.equal(parseTrustProxy('true', 0).value, true);
    assert.equal(parseTrustProxy('FALSE', 1).value, false);
    assert.equal(parseTrustProxy('2', 0).value, 2);
    assert.equal(parseTrustProxy('0', 1).value, 0);
    assert.equal(parseTrustProxy('loopback, 10.0.0.0/8', 0).value, 'loopback,10.0.0.0/8');
});

test('TRUST_PROXY unset or blank uses the fallback', () => {
    assert.deepEqual(parseTrustProxy(undefined, 1), { value: 1 });
    assert.deepEqual(parseTrustProxy('  ', false), { value: false });
});

test('TRUST_PROXY nonsense is reported, not silently treated as no proxy', () => {
    const r = parseTrustProxy('yes please', 1);
    assert.match(r.error, /TRUST_PROXY must be/);
    assert.equal(r.value, 1);
});
