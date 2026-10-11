/** Web push validation, payloads and the bot's best-effort client (fetch mocked). */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSubscription, buildPayload, endpointHash, PUSH } = require('../src/push');
const { createPushClient, configFromEnv } = require('../src/push/client');

const keys = { p256dh: Buffer.alloc(65, 7).toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') };
const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', expirationTime: null, keys };

test('a normal browser subscription validates and only stored fields come back', () => {
    assert.deepEqual(validateSubscription({ ...good, extra: 'ignored' }), { endpoint: good.endpoint, p256dh: keys.p256dh, auth: keys.auth });
});

test('endpoints must be https, public, bounded and credential-free', () => {
    const bad = (endpoint) => assert.throws(() => validateSubscription({ ...good, endpoint }), { code: 'VALIDATION' }, String(endpoint).slice(0, 40));
    for (const e of ['http://push.example.com/x', 'ftp://push.example.com/x', 'javascript:alert(1)', 'not a url', '', 'https://', 'https://user:pw@push.example.com/x',
        'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://[::1]/x', 'https://localhost/x', 'https://intranet/x', 'https://svc.internal/x', 'https://printer.local/x']) bad(e);
    bad(`https://push.example.com/${'a'.repeat(PUSH.MAX_ENDPOINT_LENGTH)}`);
    bad(undefined);
    bad(42);
    assert.doesNotThrow(() => validateSubscription({ ...good, endpoint: `https://push.example.com/${'a'.repeat(PUSH.MAX_ENDPOINT_LENGTH - 25)}` }), 'right at the limit is fine');
    assert.throws(() => validateSubscription(null), { code: 'VALIDATION' });
});

test('keys must be base64url of the right size', () => {
    const withKeys = (k) => () => validateSubscription({ ...good, keys: k });
    assert.throws(withKeys({ p256dh: keys.p256dh }), { code: 'VALIDATION' });
    assert.throws(withKeys({ ...keys, auth: 'short' }), { code: 'VALIDATION' });
    assert.throws(withKeys({ ...keys, p256dh: Buffer.alloc(64).toString('base64url') }), { code: 'VALIDATION' });
    assert.throws(withKeys({ ...keys, auth: 'not base64url!!!!!!!!!!!!!' }), { code: 'VALIDATION' });
    assert.throws(() => validateSubscription({ endpoint: good.endpoint }), { code: 'VALIDATION' });
});

test('the endpoint hash is stable SHA-256 hex', () => {
    assert.match(endpointHash(good.endpoint), /^[0-9a-f]{64}$/);
    assert.equal(endpointHash(good.endpoint), endpointHash(good.endpoint));
    assert.notEqual(endpointHash(good.endpoint), endpointHash(`${good.endpoint}2`));
});

test('payloads are clipped, normalised and only point at our own pages', () => {
    assert.deepEqual(buildPayload({ title: 'Due\ntoday', body: '  a   b ', url: '/tasks' }), { title: 'Due today', body: 'a b', url: '/tasks' });
    assert.equal(buildPayload({ title: 'x', url: 'https://evil.example' }).url, '/');
    assert.equal(buildPayload({ title: 'x', url: '//evil.example' }).url, '/');
    assert.equal(buildPayload({ title: 'x', url: '/a b' }).url, '/');
    assert.equal(buildPayload({}).title, 'TaskQuest');
    assert.equal(buildPayload({ title: 'x'.repeat(300) }).title.length, PUSH.MAX_TITLE);
});

test('the bot client is off without settings and never throws', async () => {
    assert.equal(configFromEnv({}).enabled, false);
    assert.equal(configFromEnv({ WEB_PUSH_INTERNAL_URL: 'http://web:3001/' }).enabled, false, 'a URL alone is not enough');
    assert.deepEqual(configFromEnv({ WEB_PUSH_INTERNAL_URL: 'http://web:3001//', AI_INTERNAL_TOKEN: 't'.repeat(32) }), { enabled: true, url: 'http://web:3001', token: 't'.repeat(32), timeoutMs: 5000 });
    assert.equal(configFromEnv({ WEB_PUSH_INTERNAL_URL: 'http://w', WEB_PUSH_INTERNAL_TOKEN: 'own', AI_INTERNAL_TOKEN: 'ai' }).token, 'own');

    const off = createPushClient({ config: configFromEnv({}), fetch: async () => assert.fail('must not call out') });
    assert.equal(off.enabled, false);
    assert.equal(await off.notify('42', { title: 'x' }), false);

    const seen = [];
    const on = createPushClient({
        config: { enabled: true, url: 'http://web:3001', token: 'secret', timeoutMs: 1000 },
        fetch: async (url, init) => (seen.push({ url, init }), { ok: true })
    });
    assert.equal(await on.notify(42, { title: 'Due', body: 'b', url: '/tasks' }), true);
    assert.equal(seen[0].url, 'http://web:3001/internal/push');
    assert.equal(seen[0].init.headers['x-ai-token'], 'secret');
    assert.deepEqual(JSON.parse(seen[0].init.body), { discordId: '42', title: 'Due', body: 'b', url: '/tasks' });

    const down = createPushClient({ config: { enabled: true, url: 'http://web', token: 't', timeoutMs: 1000 }, fetch: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal(await down.notify('42', { title: 'x' }), false);
    const refused = createPushClient({ config: { enabled: true, url: 'http://web', token: 't', timeoutMs: 1000 }, fetch: async () => ({ ok: false, status: 401 }) });
    assert.equal(await refused.notify('42', { title: 'x' }), false);
});
