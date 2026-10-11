/** Web push sending and settings, with the web-push sender and the store mocked: no network, no database. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushService } from '../lib/push.js';
import { pushConfigProblems } from '../lib/pushConfig.js';

const sub = (id) => ({ id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'p', auth: 'a' });

function setup({ subs = [sub(1), sub(2), sub(3)], fail = {}, wantsPush } = {}) {
    const calls = [];
    const removed = [];
    const touched = [];
    const service = createPushService({
        sender: async (subscription, payload, options) => {
            calls.push({ subscription, payload: JSON.parse(payload), options });
            const err = fail[subscription.endpoint.split('/').pop()];
            if (err) throw Object.assign(new Error('push failed'), err);
        },
        store: { list: async () => subs, remove: async (id) => removed.push(id), touch: async (id) => touched.push(id) },
        wantsPush
    });
    return { service, calls, removed, touched };
}

test('sends one payload to every subscribed browser and marks them used', async () => {
    const { service, calls, touched } = setup();
    const r = await service.send('42', { title: 'Deadline today', body: 'Taxes is due', url: '/tasks' });
    assert.deepEqual(r, { sent: 3, pruned: 0, failed: 0 });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].payload, { title: 'Deadline today', body: 'Taxes is due', url: '/tasks' });
    assert.deepEqual(calls[0].subscription, { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: 'p', auth: 'a' } });
    assert.ok(calls[0].options.TTL > 0);
    assert.deepEqual(touched.sort(), [1, 2, 3]);
});

test('the payload is clipped and an off-site url is replaced', async () => {
    const { service, calls } = setup({ subs: [sub(1)] });
    await service.send('42', { title: 'T'.repeat(500), body: 'b'.repeat(900), url: 'https://evil.example/phish' });
    const p = calls[0].payload;
    assert.equal(p.title.length, 100);
    assert.equal(p.body.length, 300);
    assert.equal(p.url, '/');
    await service.send('42', { title: '', url: '//evil.example' });
    assert.equal(calls[1].payload.title, 'TaskQuest');
    assert.equal(calls[1].payload.url, '/');
});

test('404 and 410 prune the subscription; other errors keep it', async () => {
    const { service, removed, touched } = setup({ fail: { 1: { statusCode: 410 }, 2: { statusCode: 404 }, 3: { statusCode: 503 } } });
    const r = await service.send('42', { title: 'x' });
    assert.deepEqual(r, { sent: 0, pruned: 2, failed: 1 });
    assert.deepEqual(removed.sort(), [1, 2], 'only the gone ones are removed');
    assert.deepEqual(touched, []);
    const network = setup({ subs: [sub(9)], fail: { 9: { code: 'ECONNRESET' } } });
    assert.deepEqual(await network.service.send('42', { title: 'x' }), { sent: 0, pruned: 0, failed: 1 });
    assert.deepEqual(network.removed, []);
});

test('users who opted out or have no browsers get nothing', async () => {
    const off = setup({ wantsPush: async () => false });
    assert.deepEqual(await off.service.send('42', { title: 'x' }), { sent: 0, pruned: 0, failed: 0, skipped: 'opted-out' });
    assert.equal(off.calls.length, 0);
    const none = setup({ subs: [] });
    assert.equal((await none.service.send('42', { title: 'x' })).skipped, 'no-subscriptions');
});

const KEYS = { publicKey: 'B'.repeat(87), privateKey: 'k'.repeat(43), subject: 'mailto:ops@example.com' };

test('push settings: all three VAPID values or none', () => {
    assert.deepEqual(pushConfigProblems({ publicKey: '', privateKey: '', subject: '', internalToken: '' }), []);
    assert.deepEqual(pushConfigProblems({ ...KEYS, internalToken: '' }), []);
    assert.deepEqual(pushConfigProblems({ ...KEYS, subject: 'https://taskquest.example.com', internalToken: 'x'.repeat(32) }), []);
    assert.match(pushConfigProblems({ ...KEYS, privateKey: '', internalToken: '' })[0], /all be set, or none/);
    assert.match(pushConfigProblems({ publicKey: KEYS.publicKey, privateKey: '', subject: '', internalToken: '' })[0], /all be set, or none/);
    assert.match(pushConfigProblems({ ...KEYS, publicKey: 'short', internalToken: '' }).join(' '), /public key/);
    assert.match(pushConfigProblems({ ...KEYS, subject: 'ops@example.com', internalToken: '' }).join(' '), /mailto:/);
    assert.match(pushConfigProblems({ ...KEYS, internalToken: 'tooshort' }).join(' '), /at least 32/);
});

test('a stored endpoint outside the push-service allow-list is never sent to', async () => {
    const { service, calls } = setup({ subs: [sub(1), { ...sub(2), endpoint: 'https://internal.example.com/x' }] });
    assert.deepEqual(await service.send('42', { title: 'T' }), { sent: 1, pruned: 0, failed: 1 });
    assert.deepEqual(calls.map((c) => c.subscription.endpoint), ['https://fcm.googleapis.com/fcm/send/1']);
});
