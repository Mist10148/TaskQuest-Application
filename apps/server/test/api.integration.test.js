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
        XP_WEEKLY_MODIFIER: 'off',
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

        await db.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', ['200000000000000001']);
        const run = await (await call('POST', '/api/games/arcade/snake/start', { cookie: alice })).json();
        assert.equal(
            (await call('POST', '/api/games/arcade/snake/finish', { cookie: mallory, body: { sessionId: run.sessionId, score: 0 } })).status,
            404
        );
        const history = await (await call('GET', '/api/games/history', { cookie: alice })).json();
        assert.ok(history.length >= 1);
    });

    await t.test('arcade: the server issues a seed and pays only for a replayable run', async () => {
        const { playBot } = await import('../../../packages/shared/test/helpers/arcadeBots.js');
        const aliceId = '200000000000000001';
        const finish = (body, cookie = alice, type = 'dino') => call('POST', `/api/games/arcade/${type}/finish`, { cookie, body });
        const begin = async (type, target) => {
            await db.query('UPDATE users SET last_game_at = NULL WHERE discord_id = ?', [aliceId]);
            const run = await (await call('POST', `/api/games/arcade/${type}/start`, { cookie: alice })).json();
            return { ...run, play: playBot(type, run.seed, target) };
        };
        const age = (run, ms) => db.query('UPDATE game_sessions SET created_at = created_at - INTERVAL ? SECOND WHERE id = ?', [Math.ceil(ms / 1000) + 1, run.sessionId]);

        // An old client (score only) is told to refresh.
        const old = await begin('dino', 3);
        assert.ok(Number.isInteger(old.seed) && old.seed > 0);
        const refused = await finish({ sessionId: old.sessionId, score: 3 });
        assert.equal(refused.status, 400);
        assert.match((await refused.json()).error, /refresh the page/);

        // A tampered score is rejected; so is a claim that does not fit the schema.
        const bad = await begin('dino', 3);
        await age(bad, (bad.play.ticks * 1000) / 60);
        const tampered = await finish({ sessionId: bad.sessionId, score: bad.play.score + 2, ticks: bad.play.ticks, inputs: bad.play.inputs });
        assert.equal(tampered.status, 400);
        assert.match((await tampered.json()).error, /does not match/);
        assert.equal((await finish({ sessionId: bad.sessionId, score: 1, ticks: 'x', inputs: [] })).status, 400);

        // A legitimate recorded run is paid once, with the replayed score.
        const good = await begin('dino', 3);
        await age(good, (good.play.ticks * 1000) / 60);
        const body = { sessionId: good.sessionId, score: good.play.score, ticks: good.play.ticks, inputs: good.play.inputs };
        const ok = await finish(body);
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).score, 3);
        assert.equal((await finish(body)).status, 404, 'double submit');

        // The timeline gets a bigger body limit than other routes, but not an unlimited one.
        const fat = await finish({ sessionId: good.sessionId, score: 0, ticks: 100, inputs: new Array(30_000).fill(1_000_000) });
        assert.equal(fat.status, 413);
    });

    await t.test('free-game allowance', async () => {
        const res = await call('GET', '/api/games/allowance', { cookie: alice });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.cap, 500);
        assert.equal(body.remainingXP + body.usedXP, 500);
        assert.equal((await call('GET', '/api/games/allowance')).status, 401);
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

    await t.test('new endpoints: details, reorder, quests, leaderboard tabs, freeze', async () => {
        const list = await (await call('POST', '/api/lists', { cookie: alice, body: { name: 'Details' } })).json();
        const mk = async (body) => (await call('POST', `/api/lists/${list.id}/items`, { cookie: alice, body })).json();
        const a = await mk({ name: 'a', due_date: '2030-05-05', priority: 'HIGH', tags: ['x', 'y'] });
        const b = await mk({ name: 'b', parent_id: a.id });
        const c = await mk({ name: 'c', recurrence: 'weekly', due_date: '2099-01-01' });
        assert.equal(a.tags, 'x,y');
        assert.equal(b.parent_id, a.id);
        assert.equal((await call('POST', `/api/lists/${list.id}/items`, { cookie: alice, body: { name: 'bad', due_date: '5 May' } })).status, 400);
        assert.equal((await call('POST', `/api/lists/${list.id}/items`, { cookie: alice, body: { name: 'deep', parent_id: b.id } })).status, 400);

        const reordered = await call('PATCH', `/api/lists/${list.id}/reorder`, { cookie: alice, body: { itemIds: [c.id, a.id, b.id] } });
        assert.equal(reordered.status, 200);
        assert.deepEqual((await reordered.json()).map((i) => i.name), ['c', 'a', 'b']);
        assert.equal((await call('PATCH', `/api/lists/${list.id}/reorder`, { cookie: alice, body: { itemIds: [c.id] } })).status, 400);
        assert.equal((await call('PATCH', `/api/lists/${list.id}/reorder`, { cookie: mallory, body: { itemIds: [c.id, a.id, b.id] } })).status, 404);

        const done = await (await call('PATCH', `/api/items/${c.id}/toggle`, { cookie: alice })).json();
        assert.ok(done.nextItem && done.nextItem.name === 'c', 'repeating task spawns its next copy');

        const quests = await (await call('GET', '/api/quests', { cookie: alice })).json();
        assert.equal(quests.quests.length, 7, '5 fixed (incl. the monthly boss) + 1 live rotating quest');
        assert.equal(quests.quests.filter((q) => q.rotating).length, 1);
        assert.ok(quests.quests.some((q) => q.period === 'monthly'));
        assert.equal((await call('POST', '/api/quests/NOPE/claim', { cookie: alice })).status, 404);
        assert.equal((await call('POST', '/api/quests/WEEKLY_COMPLETE_15/claim', { cookie: alice })).status, 400, 'not finished');

        for (const by of ['lifetime', 'weekly', 'streak', 'xp']) assert.equal((await call('GET', `/api/leaderboard?by=${by}`)).status, 200, by);
        assert.equal((await call('GET', '/api/leaderboard?by=bogus')).status, 400);
        assert.equal((await call('GET', '/api/leaderboard?class=hero')).status, 200);
        assert.equal((await call('GET', '/api/leaderboard?class=wizzard')).status, 400);
        assert.equal((await call('GET', '/api/leaderboard/me?by=weekly', { cookie: alice })).status, 200);
        // /me takes the class filter too, and a player outside that class has no rank on it
        const myClass = (await (await call('GET', '/api/user', { cookie: alice })).json()).user.player_class;
        const other = myClass === 'HERO' ? 'wizard' : 'hero';
        assert.equal((await (await call('GET', `/api/leaderboard/me?class=${myClass}`, { cookie: alice })).json()).rank, 1);
        assert.equal((await (await call('GET', `/api/leaderboard/me?class=${other}`, { cookie: alice })).json()).rank, null);
        assert.equal((await call('GET', '/api/leaderboard/me?class=wizzard', { cookie: alice })).status, 400);

        // the profile never carries the calendar token; it has its own owner-only endpoint
        const feed = await (await call('POST', '/api/user/calendar-token', { cookie: alice })).json();
        const profile = await (await call('GET', '/api/user', { cookie: alice })).json();
        const me = await (await call('GET', '/api/auth/me', { cookie: alice })).json();
        for (const body of [profile, me]) {
            assert.equal(body.user.calendar_token, undefined);
            assert.equal(body.user.has_calendar_token, true);
            assert.ok(!JSON.stringify(body).includes(feed.token));
        }
        assert.equal((await (await call('GET', '/api/user/calendar-token', { cookie: alice })).json()).token, feed.token);
        assert.equal((await call('GET', '/api/user/calendar-token')).status, 401);
        await call('DELETE', '/api/user/calendar-token', { cookie: alice });

        await db.query('UPDATE users SET player_xp = 1000 WHERE discord_id = ?', ['200000000000000001']);
        const frozen = await (await call('POST', '/api/user/streak-freeze', { cookie: alice })).json();
        assert.equal(frozen.freezes, 1);
        assert.equal(frozen.newBalance, 850);
        assert.equal(frozen.max, 3);
        const limits = (await (await call('GET', '/api/user', { cookie: alice })).json()).freezeLimits;
        assert.deepEqual(limits, { COST: 150, MAX: 3 });

        const settings = await call('PATCH', '/api/user', { cookie: alice, body: { timezone: 'Asia/Manila', reminder_hour: 7, weekly_digest: true } });
        assert.equal(settings.status, 200);
        assert.equal((await settings.json()).timezone, 'Asia/Manila');
        assert.equal((await call('PATCH', '/api/user', { cookie: alice, body: { timezone: 'Nowhere/Land' } })).status, 400);
        assert.equal((await call('PATCH', '/api/user', { cookie: alice, body: { reminder_hour: 30 } })).status, 400);
    });

    await t.test('export, import and calendar feed', async () => {
        const exp = await call('GET', '/api/user/export', { cookie: alice });
        assert.equal(exp.status, 200);
        assert.match(exp.headers.get('content-disposition'), /attachment/);
        const data = await exp.json();
        assert.ok(data.lists.length >= 1);
        assert.equal((await call('GET', '/api/user/export')).status, 401);
        const csv = await call('GET', '/api/user/export.csv', { cookie: alice });
        assert.match(csv.headers.get('content-type'), /text\/csv/);

        const imp = await call('POST', '/api/user/import', { cookie: alice, body: data });
        assert.equal(imp.status, 201);
        assert.ok((await imp.json()).lists >= 1);
        assert.equal((await call('POST', '/api/user/import', { cookie: alice, body: { lists: [{ name: 'x', deadline: 'soon' }] } })).status, 400);
        assert.equal((await call('POST', '/api/user/import', { cookie: alice, body: data, origin: 'https://evil.example' })).status, 403);

        assert.equal((await call('GET', `/api/calendar/${'a'.repeat(32)}.ics`)).status, 404);
        assert.equal((await call('GET', '/api/calendar/whatever.ics')).status, 404);
        const { token } = await (await call('POST', '/api/user/calendar-token', { cookie: alice })).json();
        const feed = await call('GET', `/api/calendar/${token}.ics`);
        assert.equal(feed.status, 200);
        assert.match(feed.headers.get('content-type'), /text\/calendar/);
        const text = await feed.text();
        assert.ok(text.startsWith('BEGIN:VCALENDAR'));
        assert.match(text, /SUMMARY:(✓ )?Due: Chores/);
        await call('DELETE', '/api/user/calendar-token', { cookie: alice });
        assert.equal((await call('GET', `/api/calendar/${token}.ics`)).status, 404, 'revoked feeds stop working');
    });

    await t.test('task bonuses are returned by the toggle route', async () => {
        const list = await (await call('POST', '/api/lists', { cookie: alice, body: { name: 'Bonus API' } })).json();
        const item = await (await call('POST', `/api/lists/${list.id}/items`, { cookie: alice, body: { name: 'early', due_date: '2099-01-01' } })).json();
        // A due date typed in just now earns no early bonus; one that is a day old does.
        const justNow = await (await call('POST', `/api/lists/${list.id}/items`, { cookie: alice, body: { name: 'backdated', due_date: '2099-01-01' } })).json();
        const plain = await (await call('PATCH', `/api/items/${justNow.id}/toggle`, { cookie: alice })).json();
        assert.equal(plain.bonuses.find((b) => b.key === 'early_finish'), undefined);
        await db.query('UPDATE items SET due_date_set_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY) WHERE id = ?', [item.id]);
        const done = await (await call('PATCH', `/api/items/${item.id}/toggle`, { cookie: alice })).json();
        assert.ok(Array.isArray(done.bonuses));
        assert.deepEqual(done.bonuses.find((b) => b.key === 'early_finish'), { key: 'early_finish', label: 'Finished early', xp: 20 });
        const again = await (await call('PATCH', `/api/items/${item.id}/toggle`, { cookie: alice, body: { completed: false } })).json();
        assert.deepEqual(again.bonuses, []);
    });

    await t.test('focus sessions: validation, one finish per session, no pay for a quick finish', async () => {
        assert.equal((await call('POST', '/api/focus/start', { body: { minutes: 25 } })).status, 401);
        for (const minutes of [9, 91, 25.5, '25']) {
            assert.equal((await call('POST', '/api/focus/start', { cookie: alice, body: { minutes } })).status, 400, String(minutes));
        }
        assert.equal((await call('POST', '/api/focus/start', { cookie: alice, body: { minutes: 25, extra: 1 } })).status, 400);
        const start = await call('POST', '/api/focus/start', { cookie: alice, body: { minutes: 25 } });
        assert.equal(start.status, 200);
        const { sessionId, endsAt } = await start.json();
        assert.ok(sessionId > 0 && endsAt);
        const status = await (await call('GET', '/api/focus', { cookie: alice })).json();
        assert.equal(status.active.sessionId, sessionId);
        assert.equal(status.config.maxMinutes, 90);

        assert.equal((await call('POST', '/api/focus/finish', { cookie: mallory, body: { sessionId } })).status, 404);
        assert.equal((await call('POST', '/api/focus/finish', { cookie: alice, body: { sessionId: 'x' } })).status, 400);
        const quick = await (await call('POST', '/api/focus/finish', { cookie: alice, body: { sessionId } })).json();
        assert.deepEqual([quick.state, quick.xp, quick.minutesCredited], ['cancelled', 0, 0]);
        assert.equal((await call('POST', '/api/focus/finish', { cookie: alice, body: { sessionId } })).status, 409);

        // A real 25 minutes pays 15 XP, exactly once.
        const real = await (await call('POST', '/api/focus/start', { cookie: alice, body: { minutes: 25 } })).json();
        await db.query('UPDATE focus_sessions SET started_at = started_at - INTERVAL 26 MINUTE WHERE id = ?', [real.sessionId]);
        const paid = await (await call('POST', '/api/focus/finish', { cookie: alice, body: { sessionId: real.sessionId } })).json();
        assert.deepEqual([paid.state, paid.minutesCredited, paid.xp], ['finished', 25, 15]);
        assert.equal((await call('POST', '/api/focus/finish', { cookie: alice, body: { sessionId: real.sessionId } })).status, 409);
    });

    await t.test('reflection and weekly goal endpoints', async () => {
        assert.equal((await call('GET', '/api/reflection')).status, 401);
        assert.equal((await call('POST', '/api/reflection', { body: { note: 'hi' } })).status, 401);
        assert.equal((await call('GET', '/api/goal')).status, 401);
        // reflection: validated, paid once
        assert.equal((await call('POST', '/api/reflection', { cookie: mallory, body: {} })).status, 400);
        assert.equal((await call('POST', '/api/reflection', { cookie: mallory, body: { note: '' } })).status, 400);
        assert.equal((await call('POST', '/api/reflection', { cookie: mallory, body: { note: 'x'.repeat(201) } })).status, 400);
        assert.equal((await call('POST', '/api/reflection', { cookie: mallory, body: { note: 'ok', extra: 1 } })).status, 400, 'strict body');
        const wrote = await call('POST', '/api/reflection', { cookie: mallory, body: { note: 'A calm, focused day.' } });
        assert.equal(wrote.status, 200);
        assert.equal((await wrote.json()).xp, 10);
        assert.equal((await call('POST', '/api/reflection', { cookie: mallory, body: { note: 'again' } })).status, 409);
        assert.equal((await (await call('GET', '/api/reflection', { cookie: mallory })).json()).reflection.note, 'A calm, focused day.');
        assert.equal((await call('POST', '/api/reflection', { cookie: mallory, body: { note: 'x' }, origin: 'https://evil.example' })).status, 403);
        // goal: range, set, claim before the goal is reached
        assert.equal((await call('PUT', '/api/goal', { cookie: mallory, body: { target: 2 } })).status, 400);
        assert.equal((await call('PUT', '/api/goal', { cookie: mallory, body: { target: 'five' } })).status, 400);
        const set = await call('PUT', '/api/goal', { cookie: mallory, body: { target: 5 } });
        assert.equal(set.status, 200);
        const goal = await set.json();
        assert.deepEqual([goal.target, goal.reward, goal.claimable, goal.claimed], [5, 20, false, false]);
        assert.equal((await (await call('GET', '/api/goal', { cookie: mallory })).json()).target, 5);
        assert.equal((await call('POST', '/api/goal/claim', { cookie: mallory })).status, 400, 'not reached');
    });

    await t.test('weekly review endpoints', async () => {
        assert.equal((await call('GET', '/api/review')).status, 401);
        assert.equal((await call('POST', '/api/review/claim')).status, 401);
        const state = await (await call('GET', '/api/review', { cookie: alice })).json();
        assert.deepEqual(Object.keys(state).sort(), ['claimable', 'claimed', 'completed', 'resetsAt', 'reward', 'streak', 'weekStart', 'xpEarned']);
        assert.ok(state.completed >= 1, 'alice finished tasks earlier in this run');
        const claimed = await call('POST', '/api/review/claim', { cookie: alice });
        assert.equal(claimed.status, 200);
        assert.equal((await claimed.json()).xp, 40);
        assert.equal((await call('POST', '/api/review/claim', { cookie: alice })).status, 409);
        assert.equal((await (await call('GET', '/api/review', { cookie: alice })).json()).claimed, true);
        assert.equal((await call('POST', '/api/review/claim', { cookie: mallory })).status, 400, 'mallory has finished nothing');
        assert.equal((await call('POST', '/api/review/claim', { cookie: alice, origin: 'https://evil.example' })).status, 403);
    });

    await t.test('prestige endpoints: confirmation, level gate, then the title shows on profile and board', async () => {
        const P = await login(db, '200000000000000009');
        assert.equal((await call('POST', '/api/user/prestige', { body: { confirm: 'PRESTIGE' } })).status, 401);
        const info = await (await call('GET', '/api/user/prestige', { cookie: P })).json();
        assert.deepEqual([info.prestige, info.eligible, info.minLevel, info.max], [0, false, 30, 10]);
        assert.equal((await call('POST', '/api/user/prestige', { cookie: P, body: {} })).status, 400, 'no confirmation');
        assert.equal((await call('POST', '/api/user/prestige', { cookie: P, body: { confirm: 'yes' } })).status, 400);
        assert.equal((await call('POST', '/api/user/prestige', { cookie: P, body: { confirm: 'PRESTIGE' } })).status, 400, 'level 1');

        await db.query("UPDATE users SET player_xp = 50, lifetime_xp = 3000, lifetime_xp_total = 3000, player_level = 31, discord_username = 'pres' WHERE discord_id = '200000000000000009'");
        const done = await call('POST', '/api/user/prestige', { cookie: P, body: { confirm: 'PRESTIGE' } });
        assert.equal(done.status, 200);
        const body = await done.json();
        assert.deepEqual([body.prestige, body.title, body.bonusPercent, body.level], [1, 'Veteran', 2, 1]);
        assert.equal(body.balance, body.achievements.length * 25, 'only achievement rewards earned right after the reset remain');
        const profile = await (await call('GET', '/api/user', { cookie: P })).json();
        assert.equal(profile.user.prestige, 1);
        assert.equal(profile.user.prestige_title, 'Veteran');
        const board = await (await call('GET', '/api/leaderboard?by=lifetime')).json();
        const me = board.find((r) => r.username === 'pres');
        assert.deepEqual([me.prestige, me.prestigeTitle, me.level], [1, 'Veteran', 1]);
        assert.ok(me.lifetimeXp >= 3000, 'the board shows the never-reset total');
    });

    await t.test('stats endpoints: auth, range validation and shapes', async () => {
        assert.equal((await call('GET', '/api/stats/xp-history')).status, 401);
        assert.equal((await call('GET', '/api/stats/summary')).status, 401);
        for (const days of ['0', '8', '365', 'abc', '30.5']) {
            assert.equal((await call('GET', `/api/stats/xp-history?days=${days}`, { cookie: alice })).status, 400, days);
        }
        const dflt = await (await call('GET', '/api/stats/xp-history', { cookie: alice })).json();
        assert.equal(dflt.length, 30);
        const week = await (await call('GET', '/api/stats/xp-history?days=7', { cookie: alice })).json();
        assert.equal(week.length, 7);
        assert.deepEqual(Object.keys(week[0]), ['date', 'xp', 'tasksCompleted']);
        assert.ok(week.reduce((n, d) => n + d.xp, 0) > 0, 'alice earned XP earlier in this run');
        const summary = await (await call('GET', '/api/stats/summary', { cookie: alice })).json();
        assert.deepEqual(Object.keys(summary).sort(), ['busiestWeekday', 'streak', 'tasksCompleted7d', 'xpBySource30d']);
        assert.ok(summary.tasksCompleted7d >= 1);
    });

    await t.test('CSV import: auth, dry run, row errors, no rewards, quota and size', async () => {
        const csv = 'list,task,due,priority,done\nGroceries,Milk,2030-01-05,high,no\nGroceries,Bread,,,yes\nOther,"Line one\r\nstill one",,,\n';
        assert.equal((await call('POST', '/api/import/csv', { body: { csv } })).status, 401);
        assert.equal((await call('POST', '/api/import/csv', { cookie: alice, body: { csv }, origin: 'https://evil.example' })).status, 403);
        assert.equal((await call('POST', '/api/import/csv', { cookie: alice, body: {} })).status, 400);
        assert.equal((await call('POST', '/api/import/csv', { cookie: alice, body: { csv, extra: 1 } })).status, 400);

        const C = await login(db, '200000000000000020');
        const before = await (await call('GET', '/api/user', { cookie: C })).json();
        const dry = await (await call('POST', '/api/import/csv', { cookie: C, body: { csv, dryRun: true } })).json();
        assert.deepEqual([dry.ok, dry.rows, dry.lists, dry.items], [true, 3, 2, 3]);
        assert.equal(dry.preview.length, 3);
        assert.equal((await (await call('GET', '/api/lists', { cookie: C })).json()).length, 0, 'a dry run writes nothing');

        const bad = await call('POST', '/api/import/csv', { cookie: C, body: { csv: 'list,task,due\nA,ok,\nA,bad,2030-02-30\n,,x\n' } });
        assert.equal(bad.status, 400);
        const badBody = await bad.json();
        assert.equal(badBody.details.errorCount, 2);
        assert.deepEqual(badBody.details.errors.map((e) => e.row), [3, 4]);
        assert.equal((await (await call('GET', '/api/lists', { cookie: C })).json()).length, 0, 'any bad row imports nothing');

        const done = await call('POST', '/api/import/csv', { cookie: C, body: { csv } });
        assert.equal(done.status, 201);
        assert.deepEqual(await done.json(), { success: true, rows: 3, lists: 2, items: 3 });
        const lists = await (await call('GET', '/api/lists', { cookie: C })).json();
        assert.deepEqual(lists.map((l) => l.name).sort(), ['Groceries', 'Other']);
        const groceries = await (await call('GET', `/api/lists/${lists.find((l) => l.name === 'Groceries').id}`, { cookie: C })).json();
        assert.deepEqual(groceries.items.map((i) => [i.name, i.priority, Boolean(i.completed), Boolean(i.xp_awarded)]), [['Milk', 'HIGH', false, false], ['Bread', null, true, true]]);
        const after = await (await call('GET', '/api/user', { cookie: C })).json();
        assert.equal(after.user.player_xp, before.user.player_xp, 'imports never pay XP');
        assert.equal(after.user.total_items_added, before.user.total_items_added);
        const again = await (await call('POST', '/api/import/csv', { cookie: C, body: { csv: 'task\nx\n' } })).json();
        assert.equal(again.lists, 1, 'rows without a list go to "Imported"');

        // The per-user quota applies to CSV too, and oversized text is refused.
        await db.query("INSERT INTO lists (discord_id, name) SELECT '200000000000000020', CONCAT('filler', seq) FROM (SELECT @r := @r + 1 AS seq FROM information_schema.columns, (SELECT @r := 0) z LIMIT 200) n");
        assert.equal((await call('POST', '/api/import/csv', { cookie: C, body: { csv: 'list,task\nOne more,x\n' } })).status, 400);
        assert.equal((await call('POST', '/api/import/csv', { cookie: C, body: { csv: 'a'.repeat(1_000_001) } })).status, 400);
    });


    await t.test('GET /api/lists/search: scopes, validation and ownership', async () => {
        const S = await login(db, '200000000000000030');
        const M = await login(db, '200000000000000031');
        const list = await (await call('POST', '/api/lists', { cookie: S, body: { name: 'Kitchen' } })).json();
        await call('POST', `/api/lists/${list.id}/items`, { cookie: S, body: { name: 'Descale kettle', description: 'use vinegar' } });
        await call('POST', '/api/lists', { cookie: M, body: { name: 'Vinegar club' } });

        assert.equal((await call('GET', '/api/lists/search?q=vinegar')).status, 401);
        assert.equal((await call('GET', '/api/lists/search', { cookie: S })).status, 400, 'q is required');
        assert.equal((await call('GET', '/api/lists/search?q=%20%20', { cookie: S })).status, 400);
        assert.equal((await call('GET', '/api/lists/search?q=x&scope=nope', { cookie: S })).status, 400);
        assert.equal((await call('GET', `/api/lists/search?q=${'a'.repeat(101)}`, { cookie: S })).status, 400);

        const quests = await (await call('GET', '/api/lists/search?q=vinegar', { cookie: S })).json();
        assert.deepEqual(quests, { lists: [], tasks: [] }, 'default scope only looks at quests, and never at other people\'s');
        const found = await (await call('GET', '/api/lists/search?q=vinegar&scope=tasks', { cookie: S })).json();
        assert.deepEqual(found.tasks.map((r) => [r.name, r.list_id, r.list_name]), [['Descale kettle', list.id, 'Kitchen']]);
        const all = await (await call('GET', '/api/lists/search?q=kitchen&scope=all', { cookie: S })).json();
        assert.deepEqual([all.lists.length, all.tasks.length], [1, 0]);
        assert.equal((await (await call('GET', '/api/lists/search?q=descale&scope=tasks', { cookie: M })).json()).tasks.length, 0);
        assert.equal((await call('GET', `/api/lists/${list.id}`, { cookie: S })).status, 200, '/search does not shadow /:id');
    });

    await t.test('templates endpoints: auth, validation, ownership, apply and save-as-template', async () => {
        const A = await login(db, '200000000000000040');
        const B = await login(db, '200000000000000041');
        const body = { name: 'Morning', description: 'start the day', items: [{ name: 'Stretch', priority: 'LOW' }, { name: 'Read', tags: ['learn'] }] };

        assert.equal((await call('GET', '/api/templates')).status, 401);
        assert.equal((await call('POST', '/api/templates', { body })).status, 401);
        assert.equal((await call('POST', '/api/templates', { cookie: A, body, origin: 'https://evil.example' })).status, 403);
        assert.equal((await call('POST', '/api/templates', { cookie: A, body: { name: 'x', items: [] } })).status, 400);
        assert.equal((await call('POST', '/api/templates', { cookie: A, body: { name: 'x', items: [{ name: 'a', bogus: 1 }] } })).status, 400);
        assert.equal((await call('POST', '/api/templates', { cookie: A, body: { name: 'x', items: Array.from({ length: 31 }, (_, i) => ({ name: `t${i}` })) } })).status, 400);
        assert.equal((await call('POST', '/api/templates', { cookie: A, body: { name: 'x', items: [{ name: 'a', priority: 'URGENT' }] } })).status, 400);

        const created = await call('POST', '/api/templates', { cookie: A, body });
        assert.equal(created.status, 201);
        const tpl = await created.json();
        assert.deepEqual([tpl.name, tpl.itemCount, tpl.items[0].priority, tpl.items[1].tags], ['Morning', 2, 'LOW', 'learn']);
        assert.equal((await call('POST', '/api/templates', { cookie: A, body })).status, 409);
        assert.deepEqual((await (await call('GET', '/api/templates', { cookie: A })).json()).map((x) => x.name), ['Morning']);
        assert.deepEqual(await (await call('GET', '/api/templates', { cookie: B })).json(), []);

        // Someone else's template is invisible to apply and delete.
        assert.equal((await call('POST', `/api/templates/${tpl.id}/apply`, { cookie: B, body: {} })).status, 404);
        assert.equal((await call('DELETE', `/api/templates/${tpl.id}`, { cookie: B })).status, 404);

        const applied = await call('POST', `/api/templates/${tpl.id}/apply`, { cookie: A, body: {} });
        assert.equal(applied.status, 201);
        const a = await applied.json();
        assert.deepEqual([a.created, a.list.name, a.items.length], [true, 'Morning', 2]);
        assert.ok(a.xpResult.finalXP > 0);
        const second = await (await call('POST', `/api/templates/${tpl.id}/apply`, { cookie: A })).json();
        assert.match(second.list.name, /^Morning \(\d{4}-\d{2}-\d{2}\)$/, 'a taken name gets the date');
        assert.equal((await call('POST', `/api/templates/${tpl.id}/apply`, { cookie: A, body: { listName: 'Morning' } })).status, 409);
        assert.equal((await call('POST', `/api/templates/${tpl.id}/apply`, { cookie: A, body: { listName: '' } })).status, 400);
        assert.equal((await call('POST', `/api/templates/${tpl.id}/apply`, { cookie: A, body: { listId: a.list.id } })).status, 201);
        assert.equal((await (await call('GET', `/api/lists/${a.list.id}`, { cookie: A })).json()).items.length, 4);
        assert.equal((await call('POST', `/api/templates/${tpl.id}/apply`, { cookie: A, body: { listId: 999999 } })).status, 404);

        // Save a quest as a template (own quests only).
        const saved = await call('POST', `/api/lists/${a.list.id}/save-as-template`, { cookie: A, body: { name: 'Copy of morning' } });
        assert.equal(saved.status, 201);
        assert.equal((await saved.json()).itemCount, 4);
        assert.equal((await call('POST', `/api/lists/${a.list.id}/save-as-template`, { cookie: A, body: { name: 'Copy of morning' } })).status, 409);
        assert.equal((await call('POST', `/api/lists/${a.list.id}/save-as-template`, { cookie: B, body: {} })).status, 404);
        assert.equal((await call('POST', `/api/lists/${a.list.id}/save-as-template`, { cookie: A, body: { nope: 1 } })).status, 400);

        assert.equal((await call('DELETE', `/api/templates/${tpl.id}`, { cookie: A })).status, 200);
        assert.equal((await call('DELETE', `/api/templates/${tpl.id}`, { cookie: A })).status, 404);
    });

    await t.test('logout destroys the session', async () => {
        const res = await call('POST', '/api/auth/logout', { cookie: mallory });
        assert.equal(res.status, 200);
        assert.equal((await call('GET', '/api/user', { cookie: mallory })).status, 401);
    });

    await t.test('internal API: AI tools set per-task fields and break a task down, owner-scoped', async () => {
        const { default: config } = await import('../config.js');
        const saved = { ...config.ai };
        const TOKEN = 'internal-token-'.padEnd(40, 'x');
        Object.assign(config.ai, { enabled: true, internalToken: TOKEN, serviceUrl: 'http://127.0.0.1:9', timeoutMs: 200 });
        try {
            const aliceId = '200000000000000001';
            const malloryId = '200000000000000002';
            const internal = (method, path, body, token = TOKEN) => call(method, `/internal${path}`, { body, origin: null, headers: { 'x-ai-token': token } });
            const list = await (await call('POST', '/api/lists', { cookie: alice, body: { name: 'AI tools' } })).json();

            // Create with every per-task field, update some, clear nothing it was not asked to.
            const made = await internal('POST', `/lists/${list.id}/items`, { discordId: aliceId, name: 'Write essay', due_date: '2031-06-01', priority: 'HIGH', tags: ['school', 'essay'], recurrence: 'weekly' });
            assert.equal(made.status, 201);
            const item = await made.json();
            assert.deepEqual([item.priority, item.tags, item.recurrence], ['HIGH', 'school,essay', 'weekly']);
            assert.equal(String(item.due_date).slice(0, 10), '2031-06-01');
            assert.equal((await internal('POST', `/lists/${list.id}/items`, { discordId: aliceId, name: 'bad', tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).status, 400, 'at most 5 tags');
            assert.equal((await internal('POST', `/lists/${list.id}/items`, { discordId: aliceId, name: 'bad', due_date: '2031-02-30' })).status, 400);
            assert.equal((await internal('POST', `/lists/${list.id}/items`, { discordId: aliceId, name: 'bad', xp: 5000 })).status, 400, 'unknown fields are rejected');

            const patched = await internal('PATCH', `/items/${item.id}`, { discordId: aliceId, priority: 'LOW', due_date: '2031-07-01' });
            assert.equal(patched.status, 200);
            const after = await patched.json();
            assert.equal(after.priority, 'LOW');
            assert.equal(after.tags, 'school,essay', 'untouched fields stay');
            assert.equal((await internal('PATCH', `/items/${item.id}`, { discordId: aliceId })).status, 400, 'nothing to update');
            assert.equal((await internal('PATCH', `/items/${item.id}`, { discordId: malloryId, priority: 'HIGH' })).status, 404, 'another user cannot change it');
            assert.equal((await internal('PATCH', `/items/${item.id}`, { discordId: aliceId, priority: 'HIGH' }, 'wrong-token')).status, 401);

            // Break down: all or none, one level, owner-scoped, 2-8 names.
            const names = ['Outline', 'Draft', 'Edit'];
            const split = await internal('POST', `/items/${item.id}/subtasks`, { discordId: aliceId, names });
            assert.equal(split.status, 201);
            const body = await split.json();
            assert.deepEqual(body.items.map((i) => i.name), names);
            assert.ok(body.items.every((i) => i.parent_id === item.id && i.list_id === list.id));
            assert.equal((await internal('POST', `/items/${item.id}/subtasks`, { discordId: malloryId, names })).status, 404);
            assert.equal((await internal('POST', `/items/${body.items[0].id}/subtasks`, { discordId: aliceId, names })).status, 400, 'a subtask cannot be broken down again');
            assert.equal((await internal('POST', `/items/${item.id}/subtasks`, { discordId: aliceId, names: ['only one'] })).status, 400);
            assert.equal((await internal('POST', `/items/${item.id}/subtasks`, { discordId: aliceId, names: Array(9).fill('x') })).status, 400);
            assert.equal((await internal('POST', `/items/${item.id}/subtasks`, { discordId: aliceId, names, extra: 1 })).status, 400);
            const items = await (await call('GET', `/api/lists/${list.id}`, { cookie: alice })).json();
            assert.equal(items.items.filter((i) => i.parent_id === item.id).length, 3, 'rejected requests created nothing');
        } finally {
            Object.assign(config.ai, saved);
        }
    });

    await t.test('cosmetics shop: list, buy, equip, leaderboard and profile show them', async () => {
        const carolId = '200000000000000021';
        const carol = await login(db, carolId);
        await db.query("UPDATE users SET player_xp = 700, discord_username = 'carol' WHERE discord_id = ?", [carolId]);
        assert.equal((await call('GET', '/api/cosmetics')).status, 401);
        const shop = await (await call('GET', '/api/cosmetics', { cookie: carol })).json();
        assert.equal(shop.balance, 700);
        assert.ok(shop.items.length >= 20 && shop.items.every((i) => ['title', 'frame', 'accent'].includes(i.kind)));
        assert.equal(shop.items.find((i) => i.id === 'title_reborn').locked, true);

        assert.equal((await call('POST', '/api/cosmetics/title_diligent/buy', { cookie: carol, origin: 'http://evil.example' })).status, 403, 'CSRF');
        assert.equal((await call('POST', '/api/cosmetics/nope/buy', { cookie: carol })).status, 404);
        assert.equal((await call('POST', '/api/cosmetics/TITLE-1/buy', { cookie: carol })).status, 400);
        assert.equal((await call('POST', '/api/cosmetics/title_reborn/buy', { cookie: carol })).status, 403);
        const bought = await call('POST', '/api/cosmetics/title_diligent/buy', { cookie: carol });
        assert.equal(bought.status, 200);
        const paid = await bought.json();
        assert.ok(paid.balance >= 400 && paid.balance <= 450, 'charged 300 (plus an achievement reward at most)');
        assert.equal((await call('POST', '/api/cosmetics/title_diligent/buy', { cookie: carol })).status, 409, 'a second click is a conflict, not a second charge');
        await db.query('UPDATE users SET player_xp = 10 WHERE discord_id = ?', [carolId]);
        assert.equal((await call('POST', '/api/cosmetics/frame_bronze/buy', { cookie: carol })).status, 400, 'too poor');

        const equip = (body, cookie = carol) => call('POST', '/api/cosmetics/equip', { cookie, body });
        assert.equal((await equip({ kind: 'title', id: 'title_night_owl' })).status, 403, 'not owned');
        assert.equal((await equip({ kind: 'frame', id: 'title_diligent' })).status, 404, 'wrong kind');
        assert.equal((await equip({ kind: 'hat', id: null })).status, 400);
        assert.equal((await equip({ kind: 'title', id: 'x', extra: 1 })).status, 400);
        assert.equal((await equip({ kind: 'title', id: 'title_diligent' })).status, 200);
        assert.equal((await equip({ kind: 'title', id: 'title_diligent' }, await login(db, '200000000000000022'))).status, 403, 'ownership is per user');

        const board = await (await call('GET', '/api/leaderboard')).json();
        const row = board.find((r) => r.username === 'carol');
        assert.equal(row.cosmetics.title, 'the Diligent');
        assert.ok(!JSON.stringify(board).includes(carolId), 'no Discord ID in the leaderboard');
        const me = await (await call('GET', '/api/user', { cookie: carol })).json();
        assert.equal(me.user.cosmetics.title, 'the Diligent');
        assert.equal((await equip({ kind: 'title', id: null })).status, 200);
        assert.equal((await (await call('GET', '/api/user', { cookie: carol })).json()).user.cosmetics.title, null);
    });

    await t.test('time zone: PATCH /api/user throttles a second change within 24 hours', async () => {
        const id = '200000000000000031';
        const cookie = await login(db, id);
        const set = (body) => call('PATCH', '/api/user', { cookie, body });
        assert.equal((await set({ timezone: 'Mars/Base' })).status, 400);
        const first = await set({ timezone: 'Pacific/Kiritimati' });
        assert.equal(first.status, 200);
        assert.equal((await first.json()).timezone, 'Pacific/Kiritimati');
        const second = await set({ timezone: 'Pacific/Pago_Pago' });
        assert.equal(second.status, 400);
        assert.match((await second.json()).error, /once every 24 hours/);
        assert.equal((await set({ timezone: 'Pacific/Kiritimati', reminder_hour: 8 })).status, 200, 'the same zone is not a change');
        await db.query('UPDATE users SET timezone_changed_at = NOW() - INTERVAL 25 HOUR WHERE discord_id = ?', [id]);
        assert.equal((await set({ timezone: 'Pacific/Pago_Pago' })).status, 200);
    });

    await t.test('web push: off by default, subscribe rules, internal send with pruning', async () => {
        const { default: config } = await import('../config.js');
        const { createPushService, setPushService } = await import('../lib/push.js');
        const pushId = '200000000000000031';
        const pat = await login(db, pushId);
        const keys = { p256dh: Buffer.alloc(65, 3).toString('base64url'), auth: Buffer.alloc(16, 4).toString('base64url') };
        const subscription = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, expirationTime: null, keys });
        const TOKEN = 'p'.repeat(40);
        const saved = { ...config.push };
        try {
            // Off: no VAPID keys.
            assert.deepEqual(await (await call('GET', '/api/push/config')).json(), { enabled: false });
            assert.equal((await call('POST', '/api/push/subscribe', { cookie: pat, body: { subscription: subscription(1) } })).status, 404);
            assert.equal((await call('POST', '/internal/push', { body: { discordId: pushId, title: 'x' }, origin: null, headers: { 'x-ai-token': TOKEN } })).status, 404);

            Object.assign(config.push, { enabled: true, publicKey: 'B'.repeat(87), privateKey: 'k'.repeat(43), subject: 'mailto:ops@example.com', internalToken: TOKEN });
            assert.deepEqual(await (await call('GET', '/api/push/config')).json(), { enabled: true, publicKey: 'B'.repeat(87) });
            assert.equal((await call('POST', '/api/push/subscribe', { body: { subscription: subscription(1) } })).status, 401);
            assert.equal((await call('POST', '/api/push/subscribe', { cookie: pat, origin: 'http://evil.example', body: { subscription: subscription(1) } })).status, 403, 'CSRF');

            const ok = await call('POST', '/api/push/subscribe', { cookie: pat, body: { subscription: subscription(1) } });
            assert.equal(ok.status, 201);
            assert.equal((await ok.json()).subscriptions, 1);
            assert.equal((await (await call('POST', '/api/push/subscribe', { cookie: pat, body: { subscription: subscription(1) } })).json()).subscriptions, 1, 'the same browser twice is one row');
            for (const bad of [{ ...subscription(2), endpoint: 'http://push.example.com/x' }, { ...subscription(2), endpoint: 'https://127.0.0.1/x' }, { ...subscription(2), keys: { p256dh: 'x', auth: 'y' } }, { ...subscription(2), endpoint: `https://fcm.googleapis.com/${'a'.repeat(2100)}` }, { ...subscription(2), endpoint: 'https://push.example.com/x' }, { ...subscription(2), endpoint: 'https://fcm.googleapis.com:8443/x' }]) {
                assert.equal((await call('POST', '/api/push/subscribe', { cookie: pat, body: { subscription: bad } })).status, 400);
            }
            assert.equal((await call('POST', '/api/push/subscribe', { cookie: pat, body: { subscription: { ...subscription(2), extra: 1 } } })).status, 400);
            for (let n = 2; n <= 10; n++) assert.equal((await call('POST', '/api/push/subscribe', { cookie: pat, body: { subscription: subscription(n) } })).status, 201);
            assert.equal((await call('POST', '/api/push/subscribe', { cookie: pat, body: { subscription: subscription(11) } })).status, 400, 'at most 10 browsers');

            // Internal send: token required; a mocked sender reports one dead browser.
            const sent = [];
            setPushService(
                createPushService({
                    sender: async (s, payload) => {
                        sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
                        if (s.endpoint.endsWith('/3')) throw Object.assign(new Error('gone'), { statusCode: 410 });
                    },
                    store: { list: (id) => db.push.listSubscriptions(id), remove: (id) => db.push.deleteSubscriptionById(id), touch: (id) => db.push.touchSubscription(id) },
                    wantsPush: async (id) => Boolean((await db.users.getUser(id)).web_push)
                })
            );
            const internal = (body, token = TOKEN) => call('POST', '/internal/push', { body, origin: null, headers: { 'x-ai-token': token } });
            assert.equal((await internal({ discordId: pushId, title: 'Due' }, 'wrong'.padEnd(40, 'x'))).status, 401);
            assert.equal((await internal({ discordId: pushId, title: 'Due' }, '')).status, 401);
            assert.equal((await internal({ discordId: pushId })).status, 400, 'a title is required');
            assert.equal((await internal({ discordId: pushId, title: 'Due', extra: 1 })).status, 400);
            const r = await (await internal({ discordId: pushId, title: 'Due today', body: 'Taxes', url: '/tasks' })).json();
            assert.deepEqual([r.sent, r.pruned, r.failed], [9, 1, 0]);
            assert.equal(sent.length, 10);
            assert.deepEqual(sent[0].payload, { title: 'Due today', body: 'Taxes', url: '/tasks' });
            assert.equal(await db.push.countSubscriptions(pushId), 9, 'the 410 subscription was pruned');

            // Opting out stops sends; unsubscribing removes only the caller's own browser.
            await db.query('UPDATE users SET web_push = 0 WHERE discord_id = ?', [pushId]);
            assert.equal((await (await internal({ discordId: pushId, title: 'Due' })).json()).skipped, 'opted-out');
            await db.query('UPDATE users SET web_push = 1 WHERE discord_id = ?', [pushId]);
            const other = await login(db, '200000000000000032');
            assert.equal((await (await call('DELETE', '/api/push/subscribe', { cookie: other, body: { endpoint: subscription(1).endpoint } })).json()).removed, false, 'cannot remove someone else browser');
            assert.equal((await (await call('DELETE', '/api/push/subscribe', { cookie: pat, body: { endpoint: subscription(1).endpoint } })).json()).removed, true);
            assert.equal(await db.push.countSubscriptions(pushId), 8);
            assert.equal((await call('DELETE', '/api/push/subscribe', { cookie: pat, body: { endpoint: 'x'.repeat(2049) } })).status, 400);
            assert.equal((await call('PATCH', '/api/user', { cookie: pat, body: { web_push: false } })).status, 200);
        } finally {
            setPushService(null);
            Object.assign(config.push, saved);
        }
    });


    await t.test('shared lists: invite, accept, roles, members, leave and removal over the API', async () => {
        const ids = { own: '200000000000000601', ed: '200000000000000602', vw: '200000000000000603', st: '200000000000000604', mg: '200000000000000605' };
        const cookies = {};
        for (const [k, id] of Object.entries(ids)) {
            cookies[k] = await login(db, id);
            await db.users.ensureUser(id, { username: `share_${k}`, handle: `share_${k}`, avatar: null });
        }
        const J = async (method, path, who, body) => {
            const res = await call(method, path, { cookie: cookies[who], body });
            const text = await res.text();
            return { status: res.status, text, body: text ? JSON.parse(text) : null };
        };
        const noIds = (r, what) => {
            for (const id of Object.values(ids)) assert.equal(r.text.includes(id), false, `${what}: a Discord ID leaked`);
        };

        const created = await J('POST', '/api/lists', 'own', { name: 'Flat share' });
        assert.equal(created.status, 201);
        const listId = created.body.id;
        const item = (await J('POST', `/api/lists/${listId}/items`, 'own', { name: 'Buy milk' })).body;

        // Inviting: by name only, strict body, real users only, no self, no duplicates.
        assert.equal((await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_ed', discordId: ids.ed })).status, 400, 'a Discord ID is not accepted from the client');
        // Every answer about the other person is the same neutral one: an unknown name looks exactly like a real invitation.
        const NEUTRAL = { message: 'If that person can be invited, they have been sent an invitation.' };
        const unknownName = await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'nobody_here', role: 'editor' });
        assert.deepEqual([unknownName.status, unknownName.body], [200, NEUTRAL]);
        assert.deepEqual((await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'nobody_here', dryRun: true })).body, { name: null, avatarUrl: null });
        const pendingId = async (who) => (await J('GET', '/api/invites', who)).body[0]?.id;
        assert.equal((await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_own', role: 'editor' })).status, 400, 'not yourself');
        assert.equal((await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_ed', role: 'boss' })).status, 400);
        // A dry run says who the username is (display name and avatar, no ids) and invites nobody.
        const dry = await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_ed', role: 'editor', dryRun: true });
        assert.equal(dry.status, 200, dry.text);
        assert.deepEqual(Object.keys(dry.body).sort(), ['avatarUrl', 'name']);
        assert.equal(dry.body.name, 'share_ed');
        noIds(dry, 'invite dry run');
        assert.equal((await J('GET', '/api/invites', 'ed')).body.length, 0, 'a dry run sends nothing');
        assert.equal((await J('POST', `/api/lists/${listId}/invites`, 'st', { username: 'share_ed', dryRun: true })).status, 404, 'a stranger cannot preview');
        assert.equal((await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_ed', dryRun: 'yes' })).status, 400);
        // A person can turn invitations off (PATCH /api/user): nothing is sent and the answer is the neutral message.
        assert.equal((await J('PATCH', '/api/user', 'vw', { accept_invites: false })).status, 200);
        const refused = await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_vw', role: 'viewer' });
        assert.deepEqual([refused.status, refused.body], [200, { message: 'If that person can be invited, they have been sent an invitation.' }]);
        assert.equal((await J('GET', '/api/invites', 'vw')).body.length, 0);
        assert.equal((await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_vw', dryRun: true })).body.name, null);
        assert.equal((await J('PATCH', '/api/user', 'vw', { accept_invites: true })).status, 200);
        assert.equal((await J('PATCH', '/api/user', 'vw', { accept_invites: 'no' })).status, 400);
        const inv = await J('POST', `/api/lists/${listId}/invites`, 'own', { username: '@share_ed', role: 'editor' });
        assert.deepEqual([inv.status, inv.body], [200, NEUTRAL], 'a real invitation answers exactly like an unknown name');
        noIds(inv, 'invite');
        const edInviteId = await pendingId('ed');
        assert.ok(edInviteId);
        assert.equal((await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_ed' })).status, 409, 'one pending invitation per person');
        assert.equal((await J('POST', `/api/lists/${listId}/invites`, 'st', { username: 'share_vw' })).status, 404, 'a stranger cannot invite, and learns nothing');
        await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_vw', role: 'viewer' });
        await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_mg', role: 'manager' });
        const viewerInv = { body: { id: await pendingId('vw') } };
        const mgrInv = { body: { id: await pendingId('mg') } };

        // Until accepted, the list is invisible to the invitee.
        assert.equal((await J('GET', `/api/lists/${listId}`, 'ed')).status, 404);
        const mine = await J('GET', '/api/invites', 'ed');
        assert.equal(mine.body.length, 1);
        assert.equal(mine.body[0].listName, 'Flat share');
        assert.equal(mine.body[0].ownerName, 'share_own');
        noIds(mine, 'my invites');
        assert.equal((await J('POST', `/api/invites/${edInviteId}/accept`, 'vw')).status, 404, 'only the invitee may answer');
        assert.equal((await J('DELETE', `/api/invites/${edInviteId}`, 'st')).status, 404, 'a stranger cannot revoke');
        assert.equal((await J('POST', `/api/invites/${edInviteId}/accept`, 'ed')).status, 200);
        assert.equal((await J('POST', `/api/invites/${edInviteId}/accept`, 'ed')).status, 409, 'already answered');
        assert.equal((await J('POST', `/api/invites/${viewerInv.body.id}/accept`, 'vw')).status, 200);
        assert.equal((await J('POST', `/api/invites/${mgrInv.body.id}/decline`, 'mg')).status, 200);
        assert.equal((await J('GET', '/api/invites', 'mg')).body.length, 0);

        // What a member sees: the list with sharing fields, no owner ID, no actor IDs on tasks.
        const open = await J('GET', `/api/lists/${listId}`, 'ed');
        assert.equal(open.status, 200);
        assert.deepEqual([open.body.shared, open.body.role, open.body.isOwner, open.body.ownerName, open.body.memberCount], [true, 'editor', false, 'share_own', 3]);
        assert.equal(open.body.discord_id, undefined);
        noIds(open, 'list detail');
        const overview = await J('GET', '/api/lists', 'vw');
        assert.equal(overview.body.length, 1);
        assert.equal(overview.body[0].role, 'viewer');
        noIds(overview, 'overview');
        assert.equal((await J('GET', '/api/lists', 'st')).body.length, 0);
        assert.equal((await J('GET', `/api/lists/${listId}`, 'st')).status, 404);

        // Members panel data.
        const members = await J('GET', `/api/lists/${listId}/members`, 'vw');
        assert.equal(members.status, 200);
        assert.deepEqual(members.body.members.map((m) => [m.name, m.role]), [['share_own', 'manager'], ['share_ed', 'editor'], ['share_vw', 'viewer']]);
        assert.deepEqual(members.body.invites, [], 'a viewer does not see pending invitations');
        noIds(members, 'members');
        assert.equal((await J('GET', `/api/lists/${listId}/members`, 'st')).status, 404);
        const ownerView = await J('GET', `/api/lists/${listId}/members`, 'own');
        assert.equal(ownerView.body.members.find((m) => m.isYou).name, 'share_own');
        const edKey = ownerView.body.members.find((m) => m.name === 'share_ed').memberKey;
        const vwKey = ownerView.body.members.find((m) => m.name === 'share_vw').memberKey;
        assert.match(edKey, /^[a-f0-9]{12}$/);

        // Roles at work.
        assert.equal((await J('PATCH', `/api/items/${item.id}/toggle`, 'vw')).status, 403, 'a viewer cannot complete tasks');
        assert.equal((await J('POST', `/api/lists/${listId}/items`, 'vw', { name: 'x' })).status, 403);
        assert.equal((await J('DELETE', `/api/items/${item.id}`, 'vw')).status, 403);
        assert.equal((await J('PATCH', `/api/lists/${listId}`, 'ed', { description: 'x' })).status, 403, 'an editor cannot change the list');
        assert.equal((await J('DELETE', `/api/lists/${listId}`, 'ed')).status, 403);
        const done = await J('PATCH', `/api/items/${item.id}/toggle`, 'ed');
        assert.equal(done.status, 200);
        assert.equal(done.body.completed, true);
        assert.ok(done.body.xpResult, 'the editor earned the XP');
        noIds(done, 'toggle');
        assert.equal((await J('PATCH', `/api/items/${item.id}/toggle`, 'st')).status, 404);
        assert.equal((await J('PATCH', `/api/items/${item.id}`, 'st', { name: 'pwn' })).status, 404);
        // An editor cannot delete a task somebody else added (and finished): that would erase their progress. The owner can.
        assert.equal((await J('DELETE', `/api/items/${item.id}`, 'ed')).status, 403, 'an editor cannot delete the owner task');
        assert.equal((await J('GET', `/api/lists/${listId}`, 'ed')).body.items.find((i) => i.id === item.id).can_delete, false);
        assert.equal((await J('GET', `/api/lists/${listId}`, 'own')).body.items.find((i) => i.id === item.id).can_delete, true);
        const edTask = await J('POST', `/api/lists/${listId}/items`, 'ed', { name: 'editor own task' });
        assert.equal((await J('DELETE', `/api/items/${edTask.body.item ? edTask.body.item.id : edTask.body.id}`, 'ed')).status, 200, 'an editor deletes what they added');
        const again = (await J('GET', `/api/lists/${listId}`, 'own')).body;
        assert.equal(again.items[0].completed_by_name, 'share_ed');
        assert.equal(JSON.stringify(again).includes(ids.ed), false, 'the completer ID is not in the owner view');

        // Changing roles: only managers; the owner alone makes managers.
        assert.equal((await J('PATCH', `/api/lists/${listId}/members/${vwKey}`, 'ed', { role: 'editor' })).status, 403);
        assert.equal((await J('PATCH', `/api/lists/${listId}/members/${vwKey}`, 'st', { role: 'editor' })).status, 404);
        assert.equal((await J('PATCH', `/api/lists/${listId}/members/${vwKey}`, 'own', { role: 'nope' })).status, 400);
        assert.equal((await J('PATCH', `/api/lists/${listId}/members/${vwKey}`, 'own', { role: 'manager' })).status, 200);
        assert.equal((await J('PATCH', `/api/lists/${listId}`, 'vw', { description: 'Rules of the flat' })).status, 200, 'the new manager can edit the list');
        assert.equal((await J('PATCH', `/api/lists/${listId}/members/${edKey}`, 'vw', { role: 'manager' })).status, 403, 'a manager cannot make managers');
        assert.equal((await J('DELETE', `/api/lists/${listId}`, 'vw')).status, 403, 'nor delete the list');
        assert.equal((await J('POST', `/api/lists/${listId}/invites`, 'vw', { username: 'share_mg', role: 'manager' })).status, 403, 'nor invite managers');
        assert.equal((await J('PATCH', `/api/lists/${listId}/members/${'0'.repeat(12)}`, 'own', { role: 'editor' })).status, 404);
        assert.equal((await J('PATCH', `/api/lists/${listId}/members/not-a-key`, 'own', { role: 'editor' })).status, 400);

        // Removal while the list is open in the member's browser: the next request is a 404.
        assert.equal((await J('DELETE', `/api/lists/${listId}/members/${edKey}`, 'ed')).status, 403, 'an editor cannot remove people');
        assert.equal((await J('DELETE', `/api/lists/${listId}/members/${edKey}`, 'own')).status, 200);
        assert.equal((await J('GET', `/api/lists/${listId}`, 'ed')).status, 404);
        assert.equal((await J('PATCH', `/api/items/${item.id}/toggle`, 'ed')).status, 404);
        assert.equal((await J('GET', `/api/lists/${listId}/members`, 'ed')).status, 404);

        // Leaving: the owner cannot, a member can.
        assert.equal((await J('POST', `/api/lists/${listId}/leave`, 'own')).status, 403);
        assert.equal((await J('POST', `/api/lists/${listId}/leave`, 'st')).status, 404);
        assert.equal((await J('POST', `/api/lists/${listId}/leave`, 'vw')).status, 200);
        assert.equal((await J('GET', `/api/lists/${listId}`, 'vw')).status, 404);

        // Revoking a pending invitation.
        await J('POST', `/api/lists/${listId}/invites`, 'own', { username: 'share_ed', role: 'viewer' });
        const again2 = { body: { id: await pendingId('ed') } };
        assert.equal((await J('GET', `/api/lists/${listId}/members`, 'own')).body.invites.length, 1);
        assert.equal((await J('DELETE', `/api/invites/${again2.body.id}`, 'own')).status, 200);
        assert.equal((await J('POST', `/api/invites/${again2.body.id}/accept`, 'ed')).status, 409, 'a revoked invitation cannot be accepted');
        assert.equal((await J('DELETE', `/api/invites/${again2.body.id}`, 'own')).status, 409);

        // The owner can still delete the list.
        assert.equal((await J('DELETE', `/api/lists/${listId}`, 'own')).status, 200);
    });

    await t.test('shared lists: the AI service endpoints stay owner-only', async () => {
        const { default: config } = await import('../config.js');
        const saved = { ...config.ai };
        const TOKEN = 'internal-token-'.padEnd(40, 'y');
        Object.assign(config.ai, { enabled: true, internalToken: TOKEN, serviceUrl: 'http://127.0.0.1:9', timeoutMs: 200 });
        try {
            const O = '200000000000000611';
            const E = '200000000000000612';
            const ownerCookie = await login(db, O);
            await db.users.ensureUser(O, { username: 'ai_owner', handle: 'ai_owner', avatar: null });
            await db.users.ensureUser(E, { username: 'ai_editor', handle: 'ai_editor', avatar: null });
            const { list } = await db.tasks.createList(O, { name: 'Private to the AI owner' });
            const { item } = await db.tasks.addItem(O, list.id, { name: 'Task' });
            await db.query('INSERT INTO list_members (list_id, discord_id, role, public_id) VALUES (?, ?, ?, ?)', [list.id, E, 'manager', 'a1b2c3d4e5f6']);
            const internal = (method, path, body) => call(method, `/internal${path}`, { body, origin: null, headers: { 'x-ai-token': TOKEN } });
            // A manager of the list, speaking through the AI service, reaches nothing.
            assert.equal((await internal('POST', `/lists/${list.id}/items`, { discordId: E, name: 'via ai' })).status, 404);
            assert.equal((await internal('PATCH', `/items/${item.id}/toggle`, { discordId: E })).status, 404);
            assert.equal((await internal('PATCH', `/items/${item.id}`, { discordId: E, priority: 'HIGH' })).status, 404);
            assert.equal((await internal('POST', `/items/${item.id}/subtasks`, { discordId: E, names: ['a', 'b'] })).status, 404);
            assert.equal((await internal('PATCH', `/lists/${list.id}`, { discordId: E, priority: 'HIGH' })).status, 404);
            assert.equal((await db.tasks.getItems(O, list.id)).length, 1, 'nothing was written');
            // The owner still works through it.
            assert.equal((await internal('POST', `/lists/${list.id}/items`, { discordId: O, name: 'via ai' })).status, 201);
            assert.ok(ownerCookie);
        } finally {
            Object.assign(config.ai, saved);
        }
    });


    await t.test('parties over the API: create, invite by name, accept, status, claim, leave and disband', async () => {
        const ids = { own: '200000000000000801', mem: '200000000000000802', out: '200000000000000803' };
        const cookies = {};
        for (const [k, id] of Object.entries(ids)) {
            cookies[k] = await login(db, id);
            await db.users.ensureUser(id, { username: `api_party_${k}`, handle: `api_party_${k}`, avatar: null });
        }
        const J = async (method, path, who, body) => {
            const res = await call(method, path, { cookie: cookies[who], body });
            const text = await res.text();
            return { status: res.status, text, body: text ? JSON.parse(text) : null };
        };
        const NEUTRAL = { message: 'If that person can be invited, they have been sent an invitation.' };
        assert.equal((await call('GET', '/api/parties')).status, 401);
        assert.deepEqual((await J('GET', '/api/parties', 'own')).body, { party: null, invites: [] });
        assert.equal((await J('POST', '/api/parties', 'own', { name: '' })).status, 400);
        assert.equal((await J('POST', '/api/parties', 'own', { name: 'Crew', extra: 1 })).status, 400);
        const made = await J('POST', '/api/parties', 'own', { name: 'Crew' });
        assert.equal(made.status, 201);
        assert.equal(made.body.party.name, 'Crew');
        assert.equal(made.body.party.isOwner, true);
        assert.equal((await J('POST', '/api/parties', 'own', { name: 'Again' })).status, 409);

        assert.equal((await J('POST', '/api/parties/invites', 'own', { username: 'api_party_mem', discordId: ids.mem })).status, 400, 'no Discord IDs from the client');
        assert.deepEqual((await J('POST', '/api/parties/invites', 'own', { username: 'nobody_xyz' })).body, NEUTRAL, 'an unknown name looks like a real invitation');
        assert.equal((await J('POST', '/api/parties/invites', 'out', { username: 'api_party_mem' })).status, 404, 'not in a party');
        const dryParty = await J('POST', '/api/parties/invites', 'own', { username: 'api_party_mem', dryRun: true });
        assert.deepEqual([dryParty.status, dryParty.body.name, Object.keys(dryParty.body).sort()], [200, 'api_party_mem', ['avatarUrl', 'name']]);
        assert.equal((await J('GET', '/api/parties', 'mem')).body.invites.length, 0, 'a dry run sends nothing');
        const inv = await J('POST', '/api/parties/invites', 'own', { username: 'api_party_mem' });
        assert.deepEqual([inv.status, inv.body], [200, NEUTRAL]);
        assert.equal(inv.text.includes(ids.mem), false);
        inv.body.id = (await J('GET', '/api/parties', 'mem')).body.invites[0].id;
        assert.equal((await J('POST', '/api/parties/invites', 'own', { username: 'api_party_mem' })).status, 409);
        const mine = await J('GET', '/api/parties', 'mem');
        assert.equal(mine.body.party, null);
        assert.equal(mine.body.invites[0].partyName, 'Crew');
        assert.equal((await J('POST', `/api/parties/invites/${inv.body.id}/accept`, 'out')).status, 404);
        assert.equal((await J('POST', `/api/parties/invites/${inv.body.id}/accept`, 'mem')).status, 200);
        assert.equal((await J('POST', `/api/parties/invites/${inv.body.id}/accept`, 'mem')).status, 409);

        const view = await J('GET', '/api/parties', 'mem');
        assert.deepEqual(view.body.party.members.map((m) => [m.name, m.count]), [['api_party_own', 0], ['api_party_mem', 0]]);
        for (const id of Object.values(ids)) assert.equal(view.text.includes(id), false, 'no Discord ID in the party');
        assert.equal(view.body.party.target, 12, 'nobody finished a task yet: one member worth');
        assert.equal(view.body.party.minToClaim, 6);
        assert.equal(view.body.party.claimable, false);
        assert.equal((await J('POST', '/api/parties/claim', 'mem')).status, 400, 'not finished');
        assert.equal((await J('POST', '/api/parties/claim', 'out')).status, 404);
        assert.equal((await J('POST', '/api/parties/invites', 'mem', { username: 'api_party_out' })).status, 403, 'only the owner invites');
        assert.equal((await J('DELETE', '/api/parties', 'mem')).status, 403, 'only the owner disbands');
        assert.equal((await J('POST', '/api/parties/leave', 'own')).status, 403);

        // Finish the quest (the service tests cover the counting) and claim.
        for (const who of ['own', 'mem']) {
            const { list } = await db.tasks.createList(ids[who], { name: `Party grind ${who}` });
            for (let n = 0; n < 12; n++) await db.tasks.setItemCompleted(ids[who], (await db.tasks.addItem(ids[who], list.id, { name: `t${n}` })).item.id);
        }
        const done = await J('GET', '/api/parties', 'own');
        assert.equal(done.body.party.reached, true);
        assert.equal(done.body.party.claimable, true);
        const claim = await J('POST', '/api/parties/claim', 'own');
        assert.equal(claim.status, 200);
        assert.equal(claim.body.xp, 60);
        assert.equal((await J('POST', '/api/parties/claim', 'own')).status, 409);
        assert.equal((await J('GET', '/api/parties', 'own')).body.party.claimed, true);

        // The owner removes a member by the opaque key; nobody else can, not even oneself.
        const key = (name) => view.body.party.members.find((m) => m.name === name).memberKey;
        assert.match(key('api_party_mem'), /^[a-f0-9]{12}$/);
        assert.equal((await J('DELETE', `/api/parties/members/${key('api_party_mem')}`, 'mem')).status, 403, 'only the owner removes people');
        assert.equal((await J('DELETE', `/api/parties/members/${key('api_party_own')}`, 'own')).status, 400, 'the owner disbands instead');
        assert.equal((await J('DELETE', '/api/parties/members/not-a-key', 'own')).status, 400);
        assert.equal((await J('DELETE', '/api/parties/members/ffffffffffff', 'own')).status, 404);
        assert.equal((await J('DELETE', `/api/parties/members/${key('api_party_mem')}`, 'out')).status, 404, 'not in a party');
        assert.equal((await J('DELETE', `/api/parties/members/${key('api_party_mem')}`, 'own')).status, 200);
        assert.equal((await J('GET', '/api/parties', 'mem')).body.party, null);
        assert.equal((await J('DELETE', `/api/parties/members/${key('api_party_mem')}`, 'own')).status, 404, 'already gone');
        await J('POST', '/api/parties/invites', 'own', { username: 'api_party_mem' });
        const back = { body: { id: (await J('GET', '/api/parties', 'mem')).body.invites[0].id } };
        assert.equal((await J('POST', `/api/parties/invites/${back.body.id}/accept`, 'mem')).status, 200);

        // Leaving, then disbanding.
        assert.equal((await J('POST', '/api/parties/leave', 'mem')).status, 200);
        assert.equal((await J('POST', '/api/parties/leave', 'mem')).status, 404);
        await J('POST', '/api/parties/invites', 'own', { username: 'api_party_mem' });
        const again = { body: { id: (await J('GET', '/api/parties', 'mem')).body.invites[0].id } };
        assert.equal((await J('GET', '/api/parties', 'own')).body.party.invites.length, 1);
        assert.equal((await J('DELETE', `/api/parties/invites/${again.body.id}`, 'mem')).status, 404);
        assert.equal((await J('DELETE', `/api/parties/invites/${again.body.id}`, 'own')).status, 200);
        assert.equal((await J('POST', `/api/parties/invites/${again.body.id}/decline`, 'mem')).status, 409);
        assert.equal((await J('DELETE', '/api/parties', 'own')).status, 200);
        assert.deepEqual((await J('GET', '/api/parties', 'own')).body, { party: null, invites: [] });
    });

    await t.test('large bodies: refused before they are read unless the caller is signed in; limits still apply', async () => {
        const fat = (bytes) => ({ lists: [{ name: 'Big', description: 'x'.repeat(bytes) }] });
        // A stranger is turned away with 401 whatever the size: the 1 MB / 2 MB parsers are behind the session and requireAuth.
        for (const [path, bytes] of [['/api/user/import', 3_000_000], ['/api/import', 3_000_000], ['/api/games/arcade/finish', 300_000], ['/api/User/Import/', 3_000_000]]) {
            assert.equal((await call('POST', path, { body: fat(bytes) })).status, 401, path);
        }
        // Signed in: over the route's own limit is 413; under it the route runs.
        assert.equal((await call('POST', '/api/user/import', { cookie: alice, body: fat(1_200_000) })).status, 413);
        assert.equal((await call('POST', '/api/import', { cookie: alice, body: { csv: 'x'.repeat(2_200_000) } })).status, 413);
        assert.notEqual((await call('POST', '/api/import', { cookie: alice, body: { csv: 'x'.repeat(1_500_000) } })).status, 413, 'a CSV up to 2 MB of JSON is allowed');
        assert.equal((await call('POST', '/api/games/arcade/finish', { cookie: alice, body: fat(200_000) })).status, 413);
        // Every other route keeps the small 16 KB default, signed in or not.
        assert.equal((await call('POST', '/api/lists', { cookie: alice, body: { name: 'x', description: 'y'.repeat(20_000) } })).status, 413);
        assert.equal((await call('POST', '/api/lists', { body: { name: 'x', description: 'y'.repeat(20_000) } })).status, 413);
    });

    // Last on purpose: it uses up the per-address invite budget.
    await t.test('invite lookups are limited per address as well as per account', async () => {
        // Each account makes a single call (far below its own limit of 30), so only the address limit can answer 429.
        let blockedAt = 0;
        for (let n = 1; n <= 80 && !blockedAt; n++) {
            const cookie = await login(db, `2000000000009${String(n).padStart(5, '0')}`);
            const res = await call('POST', '/api/parties/invites', { cookie, body: { username: 'someone_else', dryRun: true } });
            if (res.status === 429) {
                blockedAt = n;
                assert.equal((await res.json()).code, 'RATE_LIMITED');
            }
        }
        assert.ok(blockedAt > 0 && blockedAt <= 70, `the address limit kicked in (after ${blockedAt} calls)`);
    });

    server.close();
    await db.closePool();
});
