import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PUBLIC_URL = 'https://app.example.com';
process.env.ALLOWED_ORIGINS = 'https://alt.example.com/';
const { csrfProtection } = await import('../lib/security.js');
const { errorHandler, requireAuth, asyncRoute, uid } = await import('../lib/http.js');
const { default: shared } = await import('@taskquest/shared');
const { ZodError } = await import('zod');

/** A minimal Express-like response that records what was sent. */
function fakeRes() {
    const res = { headers: {}, statusCode: 200, body: undefined };
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (b) => ((res.body = b), res);
    res.set = (k, v) => ((res.headers[k] = v), res);
    return res;
}
const fakeReq = ({ method = 'POST', origin, referer, length = 0, json = true } = {}) => ({
    method,
    get: (h) => ({ origin, referer, 'content-length': String(length) })[h.toLowerCase()],
    is: () => json
});
const run = (req) => {
    const res = fakeRes();
    let passed = false;
    csrfProtection(req, res, () => (passed = true));
    return { res, passed };
};

test('csrf: safe methods always pass', () => {
    assert.equal(run(fakeReq({ method: 'GET' })).passed, true);
    assert.equal(run(fakeReq({ method: 'HEAD' })).passed, true);
});

test('csrf: an allowed Origin passes, including one from ALLOWED_ORIGINS with a trailing slash', () => {
    assert.equal(run(fakeReq({ origin: 'https://app.example.com' })).passed, true);
    assert.equal(run(fakeReq({ origin: 'https://alt.example.com' })).passed, true);
});

test('csrf: a foreign, missing or malformed Origin is blocked with 403', () => {
    for (const req of [fakeReq({ origin: 'https://evil.example.net' }), fakeReq({}), fakeReq({ origin: 'not a url' })]) {
        const { res, passed } = run(req);
        assert.equal(passed, false);
        assert.deepEqual([res.statusCode, res.body.code], [403, 'CSRF']);
    }
});

test('csrf: Referer is used only when there is no Origin', () => {
    assert.equal(run(fakeReq({ referer: 'https://app.example.com/dashboard' })).passed, true);
    assert.equal(run(fakeReq({ origin: 'https://evil.example.net', referer: 'https://app.example.com/' })).passed, false);
});

test('csrf: a non-JSON body from an allowed origin gets 415', () => {
    const { res, passed } = run(fakeReq({ origin: 'https://app.example.com', length: 12, json: false }));
    assert.equal(passed, false);
    assert.equal(res.statusCode, 415);
    assert.equal(run(fakeReq({ origin: 'https://app.example.com', length: 0, json: false })).passed, true, 'no body, nothing to check');
});

test('errorHandler maps known errors and never leaks unknown ones', () => {
    const call = (err) => {
        const res = fakeRes();
        const quiet = console.error;
        console.error = () => {};
        try {
            errorHandler(err, { method: 'GET', originalUrl: '/x' }, res, () => {});
        } finally {
            console.error = quiet;
        }
        return res;
    };
    const cooldown = call(shared.errors.cooldown(1500));
    assert.deepEqual([cooldown.statusCode, cooldown.headers['Retry-After']], [429, '2']);
    assert.equal(call(shared.errors.notFound()).statusCode, 404);

    const zod = new ZodError([{ code: 'custom', path: ['name'], message: 'Too long' }]);
    assert.deepEqual([call(zod).statusCode, call(zod).body.error], [400, 'name: Too long']);
    assert.equal(call({ type: 'entity.parse.failed' }).body.error, 'Malformed JSON body');
    assert.equal(call({ type: 'entity.too.large' }).statusCode, 413);

    const boom = call(new Error('SELECT secret FROM users failed'));
    assert.deepEqual([boom.statusCode, boom.body], [500, { error: 'Internal server error', code: 'INTERNAL' }]);
});

test('requireAuth, uid and asyncRoute', async () => {
    const res = fakeRes();
    let next = false;
    requireAuth({ session: {} }, res, () => (next = true));
    assert.deepEqual([next, res.statusCode, res.body.code], [false, 401, 'UNAUTHENTICATED']);
    requireAuth({ session: { user: { discordId: '1' } } }, fakeRes(), () => (next = true));
    assert.equal(next, true);
    assert.equal(uid({ session: { user: { discordId: '42' } } }), '42');

    let received;
    await asyncRoute(async () => {
        throw new Error('async failure');
    })({}, {}, (e) => (received = e));
    assert.equal(received.message, 'async failure');
});
