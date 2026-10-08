/**
 * AI integration tests that need no database: the AI client (against a stub AI
 * service), the internal-token middleware and the request schemas.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

process.env.NODE_ENV = 'test';

const { default: config } = await import('../config.js');
const { default: aiClient, assertEnabled } = await import('../lib/aiClient.js');
const { requireInternalToken } = await import('../routes/internal.js');
const schemas = await import('../lib/schemas.js');

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

function configure(overrides = {}) {
    Object.assign(config.ai, { enabled: true, serviceUrl: 'http://127.0.0.1:9', internalToken: TOKEN, timeoutMs: 400, ...overrides });
}

test('aiClient: disabled feature throws AI_DISABLED without any request', async () => {
    configure({ enabled: false });
    assert.throws(() => assertEnabled(), { code: 'AI_DISABLED', status: 503 });
    await assert.rejects(aiClient.post('/v1/summary', '1', {}), { code: 'AI_DISABLED' });
});

test('aiClient: sends the shared token and the trusted Discord ID, returns JSON', async () => {
    const ai = await listen((req, res) => json(res, 200, { pong: true }));
    configure({ serviceUrl: ai.url });
    try {
        assert.deepEqual(await aiClient.post('/v1/summary', '123', { mode: 'digest' }), { pong: true });
        const sent = ai.requests[0];
        assert.equal(sent.headers['x-ai-token'], TOKEN);
        assert.equal(sent.headers['x-discord-id'], '123');
        assert.ok(sent.headers['x-request-id']);
        assert.deepEqual(sent.body, { mode: 'digest' });
    } finally {
        await ai.close();
    }
});

test('aiClient: upstream errors map to TaskQuest error codes', async () => {
    let status = 429;
    const ai = await listen((req, res) => json(res, status, { error: 'nope', detail: 'nope' }));
    configure({ serviceUrl: ai.url });
    try {
        await assert.rejects(aiClient.post('/v1/prioritize', '1', {}), { code: 'AI_QUOTA', status: 429 });
        status = 500;
        await assert.rejects(aiClient.post('/v1/prioritize', '1', {}), { code: 'AI_UNAVAILABLE', status: 503 });
        status = 404;
        await assert.rejects(aiClient.get('/v1/threads/x', '1'), { status: 404 });
    } finally {
        await ai.close();
    }
});

test('aiClient: timeouts and unreachable service become AI_UNAVAILABLE', async () => {
    const slow = await listen(() => {}); // never answers
    configure({ serviceUrl: slow.url, timeoutMs: 100 });
    try {
        await assert.rejects(aiClient.post('/v1/summary', '1', {}), { code: 'AI_UNAVAILABLE' });
    } finally {
        await slow.close();
    }
    configure({ serviceUrl: 'http://127.0.0.1:9' });
    await assert.rejects(aiClient.get('/v1/ping', '1'), { code: 'AI_UNAVAILABLE' });
});

test('aiClient: SSE streams are piped through unchanged', async () => {
    const ai = await listen((req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: token\ndata: {"text":"Hi "}\n\n');
        res.write('event: done\ndata: {"threadId":"t"}\n\n');
        res.end();
    });
    configure({ serviceUrl: ai.url });
    const app = express();
    app.post('/chat', (req, res, next) => aiClient.stream('/v1/chat', '42', { message: 'hi' }, res).catch(next));
    const web = await listen((req, res) => app(req, res));
    try {
        const res = await fetch(`${web.url}/chat`, { method: 'POST' });
        assert.ok(res.headers.get('content-type').startsWith('text/event-stream'));
        assert.equal(res.headers.get('x-accel-buffering'), 'no');
        const text = await res.text();
        assert.match(text, /event: token\ndata: \{"text":"Hi "\}/);
        assert.match(text, /event: done/);
        assert.equal(ai.requests[0].headers['x-discord-id'], '42');
        assert.equal(ai.requests[0].headers.accept, 'text/event-stream');
    } finally {
        await web.close();
        await ai.close();
    }
});

test('aiClient: a failing stream start surfaces as an error before any SSE headers', async () => {
    const ai = await listen((req, res) => json(res, 429, { error: 'quota' }));
    configure({ serviceUrl: ai.url });
    try {
        const fakeRes = { on() {}, set() { throw new Error('headers must not be sent'); } };
        await assert.rejects(aiClient.stream('/v1/chat', '1', {}, fakeRes), { code: 'AI_QUOTA' });
    } finally {
        await ai.close();
    }
});

test('aiClient: reindex and forget are fire-and-forget and never throw', async () => {
    const ai = await listen((req, res) => {
        res.writeHead(204);
        res.end();
    });
    configure({ serviceUrl: ai.url });
    try {
        aiClient.reindex('7', 11);
        aiClient.forget('7', 11);
        for (let i = 0; i < 50 && ai.requests.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
        assert.deepEqual(
            ai.requests.map((r) => [r.url, r.body]),
            [
                ['/internal/index', { discordId: '7', listId: 11 }],
                ['/internal/forget', { discordId: '7', listId: 11 }]
            ]
        );
    } finally {
        await ai.close();
    }
    configure({ serviceUrl: 'http://127.0.0.1:9' });
    assert.doesNotThrow(() => aiClient.reindex('7', 11)); // service down: swallowed
    configure({ enabled: false });
    assert.doesNotThrow(() => aiClient.reindex('7', 11)); // feature off: no-op
});

test('internal token middleware: constant-time check, 404 when AI is off', async () => {
    const app = express();
    app.use(requireInternalToken, (req, res) => res.json({ ok: true }));
    const server = await listen((req, res) => app(req, res));
    const hit = (headers = {}) => fetch(server.url, { headers });
    try {
        configure({ enabled: false });
        assert.equal((await hit({ 'x-ai-token': TOKEN })).status, 404);
        configure();
        assert.equal((await hit()).status, 401);
        assert.equal((await hit({ 'x-ai-token': 'short' })).status, 401);
        assert.equal((await hit({ 'x-ai-token': 'x'.repeat(40) })).status, 401);
        assert.equal((await hit({ 'x-ai-token': TOKEN })).status, 200);
    } finally {
        await server.close();
    }
});

test('schemas: AI request bodies are strict and bounded', () => {
    const { aiSummaryBody, aiPrioritizeBody, aiChatBody, aiResumeBody, uuidParam } = schemas;
    assert.ok(aiSummaryBody.parse({ mode: 'digest' }));
    assert.throws(() => aiSummaryBody.parse({ mode: 'list' }), /listId is required/);
    assert.ok(aiSummaryBody.parse({ mode: 'list', listId: 3 }));
    assert.throws(() => aiSummaryBody.parse({ mode: 'digest', extra: 1 }));
    assert.throws(() => aiSummaryBody.parse({ mode: 'weekly' }));
    assert.throws(() => aiPrioritizeBody.parse({ limit: 99 }));
    assert.equal(aiChatBody.parse({ message: '  hello  ' }).message, 'hello');
    assert.throws(() => aiChatBody.parse({ message: '' }));
    assert.throws(() => aiChatBody.parse({ message: 'x'.repeat(2001) }));
    assert.throws(() => aiChatBody.parse({ message: 'hi', discordId: '2' })); // the browser can never choose whose data is read
    assert.throws(() => aiChatBody.parse({ message: 'hi', threadId: 'not-a-uuid' }));
    assert.deepEqual(aiResumeBody.parse({ approved: false }), { approved: false });
    assert.throws(() => aiResumeBody.parse({ approved: 'yes' }));
    assert.throws(() => uuidParam.parse({ threadId: '../etc/passwd' }));
});

test('schemas: internal write bodies require a numeric Discord ID and reject unknown fields', () => {
    const { internalCreateListBody, internalAddItemBody, internalToggleBody, internalUpdateListBody } = schemas;
    assert.ok(internalCreateListBody.parse({ discordId: '123', name: 'Trip', items: ['a', 'b'], priority: 'HIGH', deadline: '2026-12-01' }));
    assert.throws(() => internalCreateListBody.parse({ discordId: "1' OR 1=1", name: 'x' }));
    assert.throws(() => internalCreateListBody.parse({ discordId: '1', name: 'x', xp: 9999 }));
    assert.throws(() => internalCreateListBody.parse({ discordId: '1', name: 'x', items: Array(21).fill('i') }));
    assert.ok(internalAddItemBody.parse({ discordId: '1', name: 'task' }));
    assert.ok(internalToggleBody.parse({ discordId: '1', completed: true }));
    assert.throws(() => internalUpdateListBody.parse({ discordId: '1', name: 'renamed' })); // only priority/deadline may change
});

test('config: AI_ENABLED requires a long internal token', async () => {
    const { validateConfig } = await import('../config.js');
    Object.assign(config, { publicUrl: 'http://localhost:8080', sessionSecret: 'x'.repeat(48) });
    Object.assign(config.discord, { clientId: 'a', clientSecret: 'b' });
    configure({ internalToken: 'short' });
    assert.throws(() => validateConfig(), /AI_INTERNAL_TOKEN must be at least 32 characters/);
    configure();
    assert.doesNotThrow(() => validateConfig());
    configure({ enabled: false, internalToken: undefined });
    assert.doesNotThrow(() => validateConfig());
});
