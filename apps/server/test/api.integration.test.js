/**
 * End-to-end API tests against a real database. Skipped unless TEST_DB_NAME
 * is set (the database is wiped):
 *
 *   TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3307 TEST_DB_NAME=tq_test npm test -w @taskquest/server
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const enabled = Boolean(process.env.TEST_DB_NAME);
const SECRET = 'test-secret-'.padEnd(48, 'x');
const ORIGIN = 'http://localhost:8080';

if (enabled) {
    Object.assign(process.env, {
        NODE_ENV: 'test',
        DB_URL: '',
        DB_HOST: process.env.TEST_DB_HOST || '127.0.0.1',
        DB_PORT: process.env.TEST_DB_PORT || '3306',
        DB_USER: process.env.TEST_DB_USER || 'root',
        DB_PASSWORD: process.env.TEST_DB_PASSWORD || '',
        DB_NAME: process.env.TEST_DB_NAME,
        PUBLIC_URL: ORIGIN,
        SESSION_SECRET: SECRET,
        DISCORD_CLIENT_ID: 'test',
        DISCORD_CLIENT_SECRET: 'test',
        AI_ENABLED: 'false'
    });
}

/** Create a logged-in session row and return the signed cookie. */
async function login(db, discordId) {
    const sid = crypto.randomBytes(16).toString('hex');
    const data = JSON.stringify({ cookie: { path: '/', httpOnly: true, originalMaxAge: 3600000 }, user: { discordId, username: discordId } });
    await db.query('INSERT INTO web_sessions (session_id, expires, data) VALUES (?, ?, ?)', [sid, Math.floor(Date.now() / 1000) + 3600, data]);
    await db.users.ensureUser(discordId);
    const sig = crypto.createHmac('sha256', SECRET).update(sid).digest('base64').replace(/=+$/, '');
    return `tq.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

test('web API', { skip: !enabled && 'set TEST_DB_NAME to run' }, async (t) => {
    const { default: db } = await import('@taskquest/shared/db');
    const pool = db.getPool();
    const [tables] = await pool.query('SHOW TABLES');
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const row of tables) await pool.query(`DROP TABLE \`${Object.values(row)[0]}\``);
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    await db.runMigrations({ log: () => {} });

    const { validateConfig } = await import('../config.js');
    validateConfig();
    const { createApp } = await import('../app.js');
    const server = createApp().listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;

    const alice = await login(db, '200000000000000001');
    const mallory = await login(db, '200000000000000002');

    const call = (method, path, { cookie, body, origin = ORIGIN, headers = {} } = {}) =>
        fetch(base + path, {
            method,
            headers: {
                ...(cookie ? { cookie } : {}),
                ...(origin ? { origin } : {}),
                ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
                ...headers
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });

    await t.test('security headers and health', async () => {
        const res = await call('GET', '/api/health');
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
        assert.equal(res.headers.get('x-powered-by'), null);
    });

    await t.test('authentication required', async () => {
        assert.equal((await call('GET', '/api/user')).status, 401);
        assert.equal((await call('GET', '/api/user', { cookie: alice })).status, 200);
        assert.equal((await call('GET', '/api/does-not-exist')).status, 404);
    });

    await t.test('CSRF: cross-site and non-JSON writes are rejected', async () => {
        assert.equal((await call('POST', '/api/user/reset', { cookie: alice, body: { confirm: 'RESET' }, origin: 'https://evil.example' })).status, 403);
        assert.equal((await call('POST', '/api/user/daily', { cookie: alice, origin: null })).status, 403);
        const form = await fetch(`${base}/api/lists`, {
            method: 'POST',
            headers: { cookie: alice, origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
            body: 'name=evil'
        });
        assert.equal(form.status, 415);
        assert.equal((await call('POST', '/api/user/reset', { cookie: alice, body: {} })).status, 400, 'reset needs confirmation');
    });

    await t.test('lists/items: validation and ownership', async () => {
        assert.equal((await call('POST', '/api/lists', { cookie: alice, body: { name: '' } })).status, 400);
        assert.equal((await call('POST', '/api/lists', { cookie: alice, body: { name: 'x', priority: 'URGENT' } })).status, 400);
        assert.equal((await call('POST', '/api/lists', { cookie: alice, body: { name: 'x', extra: 1 } })).status, 400);

        const created = await call('POST', '/api/lists', { cookie: alice, body: { name: 'Chores', priority: 'HIGH', deadline: '2030-01-31' } });
        assert.equal(created.status, 201);
        const list = await created.json();
        assert.ok(list.xpResult.finalXP > 0);
        assert.equal((await call('POST', '/api/lists', { cookie: alice, body: { name: 'Chores' } })).status, 409);

        const item = await (await call('POST', `/api/lists/${list.id}/items`, { cookie: alice, body: { name: 'Dishes' } })).json();
        assert.equal((await call('PATCH', `/api/items/${item.id}/toggle`, { cookie: mallory })).status, 404);
        assert.equal((await call('PATCH', `/api/items/${item.id}`, { cookie: mallory, body: { name: 'pwned' } })).status, 404);
        assert.equal((await call('DELETE', `/api/items/${item.id}`, { cookie: mallory })).status, 404);
        assert.equal((await call('GET', `/api/lists/${list.id}`, { cookie: mallory })).status, 404);
        assert.equal((await call('PATCH', `/api/lists/${list.id}`, { cookie: alice, body: {} })).status, 400);

        const t1 = await (await call('PATCH', `/api/items/${item.id}/toggle`, { cookie: alice })).json();
        assert.equal(t1.completed, true);
        assert.ok(t1.xpResult);
        await call('PATCH', `/api/items/${item.id}/toggle`, { cookie: alice });
        const t3 = await (await call('PATCH', `/api/items/${item.id}/toggle`, { cookie: alice })).json();
        assert.equal(t3.xpResult, null, 'no XP for re-completing');
    });

    await t.test('games are server-authoritative', async () => {
        assert.equal((await call('POST', '/api/games/result', { cookie: alice, body: { gameType: 'snake', result: 'won', payout: 1e9 } })).status, 404);
        await db.query('UPDATE users SET player_xp = 1000 WHERE discord_id = ?', ['200000000000000001']);
        assert.equal((await call('POST', '/api/games/blackjack/start', { cookie: alice, body: { bet: -10 } })).status, 400);
        assert.equal((await call('POST', '/api/games/blackjack/start', { cookie: alice, body: { bet: '100' } })).status, 400);

        let hand = await (await call('POST', '/api/games/blackjack/start', { cookie: alice, body: { bet: 100 } })).json();
        while (hand.settlement) hand = await (await call('POST', '/api/games/blackjack/start', { cookie: alice, body: { bet: 100 } })).json();
        assert.equal(hand.view.dealerHand[1], null);
        assert.equal(hand.view.deck, undefined);
        const done = await (await call('POST', '/api/games/blackjack/action', { cookie: alice, body: { action: 'stand' } })).json();
        assert.ok(done.settlement);
        assert.equal((await call('POST', '/api/games/blackjack/action', { cookie: alice, body: { action: 'stand' } })).status, 404);

        const tooSoon = await call('POST', '/api/games/hangman/start', { cookie: alice });
        assert.equal(tooSoon.status, 429, 'free games have a cooldown');
        assert.ok(tooSoon.headers.get('retry-after'));
        await db.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', ['200000000000000001']);
        const h = await (await call('POST', '/api/games/hangman/start', { cookie: alice })).json();
        assert.equal(h.view.word, null);

        const run = await (await call('POST', '/api/games/arcade/snake/start', { cookie: alice })).json();
        assert.equal(
            (await call('POST', '/api/games/arcade/snake/finish', { cookie: mallory, body: { sessionId: run.sessionId, score: 0 } })).status,
            404
        );
        const history = await (await call('GET', '/api/games/history', { cookie: alice })).json();
        assert.ok(history.length >= 1);
    });

    await t.test('leaderboard hides Discord IDs', async () => {
        const board = await (await call('GET', '/api/leaderboard')).json();
        assert.ok(board.length >= 1);
        for (const row of board) assert.equal(row.discordId, undefined);
    });

    await t.test('AI endpoints: authenticated, feature-flagged, and the internal API is not public', async () => {
        // Not logged in
        assert.equal((await call('GET', '/api/ai/ping')).status, 401);
        assert.equal((await call('POST', '/api/ai/chat', { body: { message: 'hi' } })).status, 401);

        // AI is off by default in tests
        const off = await call('POST', '/api/ai/summary', { cookie: alice, body: { mode: 'digest' } });
        assert.equal(off.status, 503);
        assert.equal((await off.json()).code, 'AI_DISABLED');
        assert.equal((await call('GET', '/api/ai/threads', { cookie: alice })).status, 503);

        // Cross-site writes are still blocked by CSRF
        assert.equal((await call('POST', '/api/ai/chat', { cookie: alice, body: { message: 'hi' }, origin: 'https://evil.example' })).status, 403);

        // Browsers (even logged in) cannot reach the service-to-service API
        const internal = await call('POST', '/internal/lists', { cookie: alice, body: { discordId: '200000000000000001', name: 'x' } });
        assert.equal(internal.status, 404);
        const noToken = await call('PATCH', '/internal/items/1/toggle', { body: { discordId: '1' } });
        assert.equal(noToken.status, 404);

        // /api/auth/me reports the feature flag
        const me = await (await call('GET', '/api/auth/me', { cookie: alice })).json();
        assert.equal(me.features.ai, false);
    });

    await t.test('logout destroys the session', async () => {
        const res = await call('POST', '/api/auth/logout', { cookie: mallory });
        assert.equal(res.status, 200);
        assert.equal((await call('GET', '/api/user', { cookie: mallory })).status, 401);
    });

    server.close();
    await db.closePool();
});
