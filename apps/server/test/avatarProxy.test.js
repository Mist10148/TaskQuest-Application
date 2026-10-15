import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'x'.repeat(40);
const { sealId, openId } = await import('../lib/avatarProxy.js');

test('avatar tokens round-trip, are stable and do not contain the Discord ID', () => {
    const id = '123456789012345678';
    const token = sealId(id);
    assert.ok(!token.includes(id));
    assert.equal(openId(token), id);
    assert.equal(sealId(id), token, 'stable per ID, so the avatar URL can be cached');
    assert.notEqual(sealId('123456789012345679'), token, 'different IDs give different tokens');
});

test('forged, truncated and garbage tokens are rejected', () => {
    const token = sealId('123456789012345678');
    const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    assert.equal(openId(flipped), null);
    assert.equal(openId(token.slice(0, 10)), null);
    assert.equal(openId('not a token!'), null);
    assert.equal(openId(undefined), null);
});
