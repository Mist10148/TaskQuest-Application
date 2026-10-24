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

test('errorHandler: body-parser client errors are 4xx JSON, not 500', () => {
    for (const [status, type] of [[415, 'encoding.unsupported'], [415, 'charset.unsupported'], [400, 'request.aborted'], [400, 'request.size.invalid']]) {
        const res = fakeRes();
        errorHandler(Object.assign(new Error('x'), { status, type, expose: true }), { method: 'POST', originalUrl: '/api/x' }, res, () => {});
        assert.equal(res.statusCode, status, type);
        assert.equal(res.body.code, 'VALIDATION');
    }
    const res = fakeRes();
    const logged = [];
    const original = console.error;
    console.error = (...a) => logged.push(a);
    try {
        errorHandler(new Error('boom'), { method: 'GET', originalUrl: '/api/x' }, res, () => {});
    } finally {
        console.error = original;
    }
    assert.equal(res.statusCode, 500, 'a real server error is still a 500');
    assert.equal(logged.length, 1);
});

test('rate-limit keys: IPv6 clients share one key per /64, IPv4 and mapped addresses are unchanged', async () => {
    const { ipKey } = await import('../lib/security.js');
    assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
    assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), ipKey('2001:db8:1:2:1::9'), 'the same /64');
    assert.equal(ipKey('2001:db8:1:2::1'), '2001:0db8:0001:0002::/64');
    assert.notEqual(ipKey('2001:db8:1:3::1'), ipKey('2001:db8:1:2::1'), 'another /64');
    assert.equal(ipKey('::1'), '0000:0000:0000:0000::/64');
    assert.equal(ipKey(undefined), '');
});

test('production config: a non-https public address fails, a missing proxy warns, local http is allowed', async () => {
    const { productionProblems } = await import('../config.js');
    assert.deepEqual(productionProblems({ isProduction: false, publicUrl: 'http://x', trustProxy: false }), { problems: [], warnings: [] });
    assert.equal(productionProblems({ isProduction: true, publicUrl: 'http://app.example.com', trustProxy: 1 }).problems.length, 1);
    assert.equal(productionProblems({ isProduction: true, publicUrl: 'https://app.example.com', trustProxy: 1 }).problems.length, 0);
    assert.equal(productionProblems({ isProduction: true, publicUrl: 'http://localhost:3001', trustProxy: 1 }).problems.length, 0);
    assert.equal(productionProblems({ isProduction: true, publicUrl: 'https://app.example.com', trustProxy: 0 }).warnings.length, 1);
    assert.equal(productionProblems({ isProduction: true, publicUrl: 'https://app.example.com', trustProxy: '10.0.0.0/8' }).warnings.length, 0);
});

test('heavyLimiter: the 21st simulation or CSV request in a minute from one account is refused with 429', async () => {
    const { heavyLimiter } = await import('../lib/security.js');
    const call = (discordId) =>
        new Promise((resolve) => {
            const req = { ip: '203.0.113.9', method: 'GET', headers: {}, get: () => undefined, app: { get: () => false }, session: { user: { discordId } } };
            const res = fakeRes();
            res.setHeader = () => {};
            res.append = () => {};
            res.headersSent = false;
            res.status = (c) => ((res.statusCode = c), res);
            res.json = (b) => ((res.body = b), resolve({ passed: false, res }), res);
            heavyLimiter(req, res, () => resolve({ passed: true, res }));
        });
    for (let i = 0; i < 20; i++) assert.equal((await call('heavy-a')).passed, true, `request ${i + 1} passes`);
    const refused = await call('heavy-a');
    assert.equal(refused.passed, false);
    assert.equal(refused.res.statusCode, 429);
    assert.equal(refused.res.body.code, 'RATE_LIMITED');
    assert.equal((await call('heavy-b')).passed, true, 'another account has its own budget');
});

test('logPath drops the query string and hides a calendar feed token', async () => {
    const { logPath } = await import('../lib/http.js');
    const token = 'a'.repeat(32);
    assert.equal(logPath({ originalUrl: `/api/calendar/${token}.ics?x=1` }), '/api/calendar/<token>.ics');
    assert.equal(logPath({ originalUrl: '/api/lists/12?include=items' }), '/api/lists/12');
});

test('errorHandler hands the error on when the response has already started', async () => {
    let passed = null;
    const res = { headersSent: true, status() { throw new Error('must not respond twice'); } };
    errorHandler(new Error('late'), { method: 'GET', originalUrl: '/api/x' }, res, (err) => { passed = err; });
    assert.equal(passed.message, 'late');
});
