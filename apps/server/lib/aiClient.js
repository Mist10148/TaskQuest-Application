/**
 * Client for the private AI service (apps/ai). Express is the only public
 * entry point: it authenticates the user and passes the trusted Discord ID
 * in a header; the browser never reaches the AI service directly.
 */

import crypto from 'crypto';
import shared from '@taskquest/shared';
import config from '../config.js';

const { TaskQuestError } = shared;

const UNAVAILABLE = 'The AI service is unavailable right now. Please try again shortly.';

function headers(discordId, extra = {}) {
    return {
        'Content-Type': 'application/json',
        'X-AI-Token': config.ai.internalToken || '',
        ...(discordId ? { 'X-Discord-Id': String(discordId) } : {}),
        'X-Request-Id': crypto.randomUUID(),
        ...extra
    };
}

/** Turn a non-2xx response from the AI service into a TaskQuestError. */
async function toError(response) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 429) {
        return new TaskQuestError('AI_QUOTA', body.error || 'Daily AI energy used up. It resets at midnight UTC.', 429);
    }
    if (response.status === 400 || response.status === 404) {
        return new TaskQuestError(body.code || 'VALIDATION', body.error || body.detail || 'Request rejected by the AI service.', response.status);
    }
    return new TaskQuestError('AI_UNAVAILABLE', UNAVAILABLE, 503);
}

export function assertEnabled() {
    if (!config.ai.enabled) throw new TaskQuestError('AI_DISABLED', 'AI features are not enabled on this server.', 503);
}

async function request(method, path, discordId, body, { timeoutMs = config.ai.timeoutMs } = {}) {
    assertEnabled();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${config.ai.serviceUrl}${path}`, {
            method,
            headers: headers(discordId),
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal
        });
        if (!response.ok) throw await toError(response);
        return response.status === 204 ? null : await response.json();
    } catch (err) {
        if (err instanceof TaskQuestError) throw err;
        throw new TaskQuestError('AI_UNAVAILABLE', UNAVAILABLE, 503);
    } finally {
        clearTimeout(timer);
    }
}

export const aiClient = {
    get: (path, discordId, opts) => request('GET', path, discordId, undefined, opts),
    post: (path, discordId, body, opts) => request('POST', path, discordId, body, opts),
    delete: (path, discordId, opts) => request('DELETE', path, discordId, undefined, opts),

    /**
     * Pipe a Server-Sent Events response from the AI service to `res`.
     * Aborts the upstream request if the browser disconnects.
     */
    async stream(path, discordId, body, res) {
        assertEnabled();
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        let upstream;
        try {
            upstream = await fetch(`${config.ai.serviceUrl}${path}`, {
                method: 'POST',
                headers: headers(discordId, { Accept: 'text/event-stream' }),
                body: JSON.stringify(body),
                signal: controller.signal
            });
        } catch {
            throw new TaskQuestError('AI_UNAVAILABLE', UNAVAILABLE, 503);
        }
        if (!upstream.ok) throw await toError(upstream);

        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        try {
            for await (const chunk of upstream.body) res.write(chunk);
        } catch {
            /* client went away or upstream dropped; nothing more to send */
        }
        res.end();
    },

    /** Fire-and-forget: refresh a list's embeddings after a write. Never throws. */
    reindex(discordId, listId) {
        if (!config.ai.enabled) return;
        request('POST', '/internal/index', discordId, { discordId: String(discordId), listId }, { timeoutMs: 5000 }).catch((err) =>
            console.warn('[ai] reindex failed:', err.code || err.message)
        );
    },

    /** Fire-and-forget: drop a deleted list's embeddings. Never throws. */
    forget(discordId, listId) {
        if (!config.ai.enabled) return;
        request('POST', '/internal/forget', discordId, { discordId: String(discordId), listId }, { timeoutMs: 5000 }).catch((err) =>
            console.warn('[ai] forget failed:', err.code || err.message)
        );
    }
};

export default aiClient;
