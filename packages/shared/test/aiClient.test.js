/**
 * AI service client used by the bot. Runs against a local stub HTTP server.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { createAiClient, configFromEnv, SseParser, collectChat } = require('../src/ai/client');

const TOKEN = 't'.repeat(40);

/** Start an HTTP server and return { url, close, requests }. */
async function listen(handler) {
    const requests = [];
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        handler(req, res, body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve)))
    };
}

const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
};

const sse = (event, data) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;

const client = (url, overrides = {}) => createAiClient({ enabled: true, serviceUrl: url, token: TOKEN, timeoutMs: 1000, ...overrides });

test('configFromEnv reads the shared AI variables', () => {
    const c = configFromEnv({ AI_ENABLED: 'true', AI_SERVICE_URL: 'http://ai:8000/', AI_INTERNAL_TOKEN: TOKEN, AI_TIMEOUT_MS: '5000' });
    assert.deepEqual(c, { enabled: true, serviceUrl: 'http://ai:8000', token: TOKEN, timeoutMs: 5000 });
    assert.equal(configFromEnv({}).enabled, false);
});

test('disabled client throws AI_DISABLED without any request', async () => {
    const c = createAiClient({ enabled: false, serviceUrl: 'http://127.0.0.1:9' });
    await assert.rejects(c.post('/v1/summary', '1', {}), { code: 'AI_DISABLED', status: 503 });
    await assert.rejects(c.chat('/v1/chat', '1', { message: 'hi' }), { code: 'AI_DISABLED' });
});

test('post sends the token, Discord ID and a request id', async () => {
    const srv = await listen((req, res) => json(res, 200, { headline: 'ok' }));
    try {
        assert.deepEqual(await client(srv.url).post('/v1/summary', '42', { mode: 'digest' }), { headline: 'ok' });
        const [r] = srv.requests;
        assert.equal(r.url, '/v1/summary');
        assert.equal(r.headers['x-ai-token'], TOKEN);
        assert.equal(r.headers['x-discord-id'], '42');
        assert.match(r.headers['x-request-id'], /^[0-9a-f-]{36}$/);
        assert.deepEqual(r.body, { mode: 'digest' });
    } finally {
        await srv.close();
    }
});

test('errors map to TaskQuestError codes', async () => {
    const replies = {
        '/quota': [429, { error: 'Daily AI energy used up.', code: 'AI_QUOTA' }],
        '/missing': [404, { detail: 'List not found' }],
        '/conflict': [409, { detail: 'Nothing is waiting for confirmation' }],
        '/bad': [422, { detail: [] }],
        '/boom': [500, {}]
    };
    const srv = await listen((req, res) => json(res, ...replies[req.url]));
    const c = client(srv.url);
    try {
        await assert.rejects(c.post('/quota', '1', {}), { code: 'AI_QUOTA', status: 429 });
        await assert.rejects(c.post('/missing', '1', {}), { code: 'NOT_FOUND', status: 404, message: 'List not found' });
        await assert.rejects(c.post('/conflict', '1', {}), { code: 'CONFLICT', status: 409 });
        await assert.rejects(c.post('/bad', '1', {}), { code: 'AI_UNAVAILABLE', status: 503 });
        await assert.rejects(c.post('/boom', '1', {}), { code: 'AI_UNAVAILABLE', status: 503 });
    } finally {
        await srv.close();
    }
});

test('unreachable service and timeouts become AI_UNAVAILABLE', async () => {
    await assert.rejects(client('http://127.0.0.1:9').get('/v1/ping', '1'), { code: 'AI_UNAVAILABLE' });
    const srv = await listen(() => {}); // never answers
    try {
        await assert.rejects(client(srv.url, { timeoutMs: 100 }).get('/v1/ping', '1'), { code: 'AI_UNAVAILABLE' });
    } finally {
        await srv.close();
    }
});

test('SseParser handles events split across chunks, CRLF and pings', () => {
    const p = new SseParser();
    const stream = ': ping\r\n\r\n' + sse('token', { text: 'Hel' }) + sse('token', { text: 'lo' }) + 'event: done\r\ndata: {"threadId":"t1"}';
    const events = [];
    for (let i = 0; i < stream.length; i += 7) events.push(...p.push(stream.slice(i, i + 7)));
    events.push(...p.flush());
    assert.deepEqual(events, [
        { event: 'token', data: { text: 'Hel' } },
        { event: 'token', data: { text: 'lo' } },
        { event: 'done', data: { threadId: 't1' } }
    ]);
    assert.deepEqual(new SseParser().push('data: plain\n\n'), [{ event: 'message', data: 'plain' }]);
});

test('collectChat folds a turn into text, sources, tools and confirmations', () => {
    const out = collectChat([
        { event: 'sources', data: [{ id: 'L1', title: 'Math' }] },
        { event: 'token', data: { text: 'You have ' } },
        { event: 'token', data: { text: 'one quest.' } },
        { event: 'sources', data: [{ id: 'L1', title: 'Math' }, { id: 'L2', title: 'Garage' }] },
        { event: 'tool', data: { name: 'get_overdue', status: 'done' } },
        { event: 'confirm', data: { id: 'c1', action: 'complete_item', args: { item_id: 3 }, preview: 'Mark done?' } },
        { event: 'done', data: { threadId: 'abc', usage: { input: 1, output: 2 } } }
    ]);
    assert.equal(out.text, 'You have one quest.');
    assert.deepEqual(out.sources.map((s) => s.id), ['L1', 'L2']);
    assert.equal(out.tools.length, 1);
    assert.equal(out.confirms[0].preview, 'Mark done?');
    assert.equal(out.threadId, 'abc');
    assert.equal(out.error, null);
});

test('chat reads the whole SSE stream; a 429 before streaming is a quota error', async () => {
    const srv = await listen((req, res, body) => {
        if (body.message === 'quota') return json(res, 429, { error: 'Daily AI energy used up.', code: 'AI_QUOTA' });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(sse('token', { text: 'Hi ' }));
        setTimeout(() => {
            res.write(sse('token', { text: 'there' }));
            res.end(sse('done', { threadId: 'th-1' }));
        }, 20);
    });
    const c = client(srv.url);
    try {
        const out = await c.chat('/v1/chat', '7', { message: 'hello' });
        assert.equal(out.text, 'Hi there');
        assert.equal(out.threadId, 'th-1');
        assert.equal(srv.requests[0].headers.accept, 'text/event-stream');
        await assert.rejects(c.chat('/v1/chat', '7', { message: 'quota' }), { code: 'AI_QUOTA' });
    } finally {
        await srv.close();
    }
});

test('reindex and forget are fire-and-forget and never throw', async () => {
    const srv = await listen((req, res) => {
        res.writeHead(req.url === '/internal/forget' ? 500 : 204);
        res.end();
    });
    try {
        const c = client(srv.url);
        assert.equal(c.reindex('7', '11'), undefined);
        assert.equal(c.forget('7', 11), undefined); // a 500 is logged, not thrown
        for (let i = 0; i < 50 && srv.requests.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
        assert.deepEqual(srv.requests.map((r) => [r.url, r.body]).sort(), [
            ['/internal/forget', { discordId: '7', listId: 11 }],
            ['/internal/index', { discordId: '7', listId: 11 }]
        ]);
    } finally {
        await srv.close();
    }
    const off = createAiClient({ enabled: false, serviceUrl: 'http://127.0.0.1:9' });
    assert.doesNotThrow(() => off.reindex('7', 1));
});

test('converse and forgetConversation call the conversation endpoints', async () => {
    const srv = await listen((req, res, body) => {
        if (req.method === 'POST') return json(res, 200, { reply: `echo: ${body.message}`, sources: [], tools: [], usage: {} });
        return json(res, 200, { success: true, forgotten: true });
    });
    try {
        const c = client(srv.url);
        const out = await c.converse('42', { channelId: 900, message: 'hi' });
        assert.equal(out.reply, 'echo: hi');
        await c.converse('42', { channelId: '900', message: 'look', imageUrl: 'https://cdn.discordapp.com/a.png' });
        assert.equal(await c.forgetConversation('42', '900'), true);
        assert.deepEqual(
            srv.requests.map((r) => [r.method, r.url, r.body, r.headers['x-discord-id']]),
            [
                ['POST', '/v1/converse', { channelId: '900', message: 'hi' }, '42'],
                ['POST', '/v1/converse', { channelId: '900', message: 'look', imageUrl: 'https://cdn.discordapp.com/a.png' }, '42'],
                ['DELETE', '/v1/converse/900', undefined, '42']
            ]
        );
    } finally {
        await srv.close();
    }
});
