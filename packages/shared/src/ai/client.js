/**
 * Client for the private AI service (apps/ai) for callers that are not Express,
 * such as the Discord bot. Like the web server's client (apps/server/lib/aiClient.js)
 * it sends the shared X-AI-Token and the trusted Discord ID; unlike it, chat
 * responses are read to the end and returned as one collected result instead of
 * being piped to a browser.
 */

'use strict';

const crypto = require('crypto');
const { TaskQuestError } = require('../errors');

const UNAVAILABLE = 'The AI service is unavailable right now. Please try again shortly.';

/** Settings from the shared root .env (the same variables the web server reads). */
function configFromEnv(env = process.env) {
    return {
        enabled: env.AI_ENABLED === 'true',
        serviceUrl: (env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, ''),
        token: env.AI_INTERNAL_TOKEN || '',
        timeoutMs: parseInt(env.AI_TIMEOUT_MS, 10) || 20000
    };
}

/** Turn a non-2xx response from the AI service into a TaskQuestError. */
async function toError(response) {
    const body = await response.json().catch(() => ({}));
    const message = body.error || body.detail;
    if (response.status === 429) {
        return new TaskQuestError('AI_QUOTA', message || 'Daily AI energy used up. It resets at midnight UTC.', 429);
    }
    if (response.status === 404) return new TaskQuestError(body.code || 'NOT_FOUND', message || 'Not found.', 404);
    if (response.status === 409) return new TaskQuestError('CONFLICT', message || 'Nothing is waiting for confirmation.', 409);
    if (response.status === 400) return new TaskQuestError(body.code || 'VALIDATION', message || 'Request rejected by the AI service.', 400);
    return new TaskQuestError('AI_UNAVAILABLE', UNAVAILABLE, 503);
}

/**
 * Incremental Server-Sent Events parser. Feed it text chunks as they arrive
 * (events may be split anywhere); it returns the complete events seen so far
 * as { event, data } with `data` JSON-decoded when possible.
 */
class SseParser {
    constructor() {
        this.buffer = '';
    }

    push(chunk) {
        this.buffer += chunk;
        const events = [];
        // Events end with a blank line; sse-starlette uses \r\n line endings.
        const blocks = this.buffer.split(/\r\n\r\n|\n\n|\r\r/);
        this.buffer = blocks.pop();
        for (const block of blocks) {
            const parsed = SseParser.parseBlock(block);
            if (parsed) events.push(parsed);
        }
        return events;
    }

    /** Whatever is left once the stream ends (a final event without its blank line). */
    flush() {
        const rest = this.buffer;
        this.buffer = '';
        const parsed = rest.trim() ? SseParser.parseBlock(rest) : null;
        return parsed ? [parsed] : [];
    }

    static parseBlock(block) {
        let event = 'message';
        const data = [];
        for (const line of block.split(/\r\n|\n|\r/)) {
            if (!line || line.startsWith(':')) continue; // comments are keep-alive pings
            const colon = line.indexOf(':');
            const field = colon === -1 ? line : line.slice(0, colon);
            const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (field === 'event') event = value;
            else if (field === 'data') data.push(value);
        }
        if (!data.length) return null;
        const raw = data.join('\n');
        try {
            return { event, data: JSON.parse(raw) };
        } catch {
            return { event, data: raw };
        }
    }
}

/** Fold a chat turn's events into one result for callers that cannot stream. */
function collectChat(events) {
    const result = { text: '', sources: [], tools: [], confirms: [], error: null, threadId: null, usage: null };
    const seen = new Set();
    for (const { event, data } of events) {
        if (event === 'token') result.text += data.text || '';
        else if (event === 'sources') {
            for (const s of Array.isArray(data) ? data : []) {
                if (!seen.has(s.id)) {
                    seen.add(s.id);
                    result.sources.push(s);
                }
            }
        } else if (event === 'tool') result.tools.push(data);
        else if (event === 'confirm') result.confirms.push(data);
        else if (event === 'error') result.error = (data && data.message) || String(data);
        else if (event === 'done') {
            result.threadId = data.threadId || null;
            result.usage = data.usage || null;
        }
    }
    return result;
}

function createAiClient(options = {}) {
    const config = { ...configFromEnv(), ...options };

    function assertEnabled() {
        if (!config.enabled) throw new TaskQuestError('AI_DISABLED', 'AI features are not enabled on this server.', 503);
    }

    function headers(discordId, extra = {}) {
        return {
            'Content-Type': 'application/json',
            'X-AI-Token': config.token || '',
            ...(discordId ? { 'X-Discord-Id': String(discordId) } : {}),
            'X-Request-Id': crypto.randomUUID(),
            ...extra
        };
    }

    async function send(method, path, discordId, body, timeoutMs, accept) {
        assertEnabled();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || config.timeoutMs);
        try {
            const response = await fetch(`${config.serviceUrl}${path}`, {
                method,
                headers: headers(discordId, accept ? { Accept: accept } : {}),
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal
            });
            if (!response.ok) throw await toError(response);
            return { response, done: () => clearTimeout(timer) };
        } catch (err) {
            clearTimeout(timer);
            if (err instanceof TaskQuestError) throw err;
            throw new TaskQuestError('AI_UNAVAILABLE', UNAVAILABLE, 503);
        }
    }

    async function request(method, path, discordId, body, { timeoutMs } = {}) {
        const { response, done } = await send(method, path, discordId, body, timeoutMs);
        try {
            return response.status === 204 ? null : await response.json();
        } catch {
            throw new TaskQuestError('AI_UNAVAILABLE', UNAVAILABLE, 503);
        } finally {
            done();
        }
    }

    /** POST to an SSE endpoint and read the whole stream into collectChat()'s shape. */
    async function chat(path, discordId, body, { timeoutMs = Math.max(config.timeoutMs, 90000) } = {}) {
        const { response, done } = await send('POST', path, discordId, body, timeoutMs, 'text/event-stream');
        const parser = new SseParser();
        const decoder = new TextDecoder();
        const events = [];
        try {
            for await (const chunk of response.body) events.push(...parser.push(decoder.decode(chunk, { stream: true })));
            events.push(...parser.push(decoder.decode()), ...parser.flush());
        } catch {
            throw new TaskQuestError('AI_UNAVAILABLE', UNAVAILABLE, 503);
        } finally {
            done();
        }
        return collectChat(events);
    }

    return {
        get enabled() {
            return config.enabled;
        },
        assertEnabled,
        get: (path, discordId, opts) => request('GET', path, discordId, undefined, opts),
        post: (path, discordId, body, opts) => request('POST', path, discordId, body, opts),
        delete: (path, discordId, opts) => request('DELETE', path, discordId, undefined, opts),
        chat
    };
}

module.exports = { createAiClient, configFromEnv, SseParser, collectChat };
