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

/** A string the browser may see, or undefined: FastAPI's validation `detail` is a list of objects, not a message. */
const text = (value) => (typeof value === 'string' && value.trim() ? value.slice(0, 500) : undefined);

/** An error code shaped like ours (AI_QUOTA, NOT_FOUND), or undefined. */
const codeOf = (value) => (typeof value === 'string' && /^[A-Z][A-Z_]{1,39}$/.test(value) ? value : undefined);

/** Turn a non-2xx response from the AI service into a TaskQuestError. */
async function toError(response) {
    const body = await response.json().catch(() => ({}));
    const message = text(body?.error) || text(body?.detail);
    const code = codeOf(body?.code);
    if (response.status === 429) {
        return new TaskQuestError('AI_QUOTA', message || 'Daily AI energy used up. It resets at your midnight.', 429);
    }
    // The user switched AI off (perhaps on another device) after Express checked: say so, not "unavailable".
    if (response.status === 403) return new TaskQuestError('AI_OPTED_OUT', message || 'AI features are turned off for your account.', 403);
    if (response.status === 404) return new TaskQuestError(code || 'NOT_FOUND', message || 'Not found.', 404);
    if (response.status === 409) return new TaskQuestError('CONFLICT', message || 'Nothing is waiting for confirmation.', 409);
    // 422 is FastAPI's answer to a body it could not validate: the request was wrong, the service is fine.
    if (response.status === 400 || response.status === 422) {
        return new TaskQuestError(code || 'VALIDATION', message || 'Request rejected by the AI service.', 400);
    }
    return new TaskQuestError('AI_UNAVAILABLE', UNAVAILABLE, 503);
}

/** Resolves when the response has room again (or the client is gone), so a slow reader slows the stream instead of filling memory. */
function drained(res) {
    return new Promise((resolve) => {
        if (res.destroyed || res.writableEnded) return resolve();
        const done = () => {
            res.off('drain', done);
            res.off('close', done);
            resolve();
        };
        res.on('drain', done);
        res.on('close', done);
    });
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
        let idleTimedOut = false;
        let idleTimer;
        const armIdleTimer = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                idleTimedOut = true;
                controller.abort();
            }, config.ai.streamIdleMs);
        };
        armIdleTimer();
        let upstream;
        try {
            upstream = await fetch(`${config.ai.serviceUrl}${path}`, {
                method: 'POST',
                headers: headers(discordId, { Accept: 'text/event-stream' }),
                body: JSON.stringify(body),
                signal: controller.signal
            });
        } catch {
            clearTimeout(idleTimer);
            throw new TaskQuestError('AI_UNAVAILABLE', UNAVAILABLE, 503);
        }
        if (!upstream.ok) {
            clearTimeout(idleTimer);
            throw await toError(upstream);
        }

        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        try {
            for await (const chunk of upstream.body) {
                armIdleTimer();
                if (!res.write(chunk)) await drained(res); // a slow browser must not make the server buffer the whole answer
            }
        } catch {
            // The browser leaving is fine. An upstream drop or stall mid-stream would otherwise look like a clean, truncated answer.
            if ((idleTimedOut || !controller.signal.aborted) && !res.writableEnded) {
                res.write(`event: error
data: ${JSON.stringify({ message: 'The AI connection was interrupted. Please try again.' })}

`);
            }
        } finally {
            clearTimeout(idleTimer);
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

    /**
     * Fire-and-forget: re-index the user's whole library, or delete every vector if they
     * opted out of AI (the AI service checks users.ai_enabled). Never throws.
     */
    syncUser(discordId) {
        if (!config.ai.enabled) return;
        request('POST', '/internal/index', discordId, { discordId: String(discordId) }, { timeoutMs: 5000 }).catch((err) =>
            console.warn('[ai] user sync failed:', err.code || err.message)
        );
    },

    /** Fire-and-forget: drop a deleted list's embeddings. Never throws. */
    forget(discordId, listId) {
        if (!config.ai.enabled) return;
        request('POST', '/internal/forget', discordId, { discordId: String(discordId), listId }, { timeoutMs: 5000 }).catch((err) =>
            console.warn('[ai] forget failed:', err.code || err.message)
        );
    },

    /** Fire-and-forget: drop everything the AI service stored about a user (reset progress). Never throws. */
    forgetUser(discordId) {
        if (!config.ai.enabled) return;
        request('POST', '/internal/forget', discordId, { discordId: String(discordId) }, { timeoutMs: 5000 }).catch((err) =>
            console.warn('[ai] forget user failed:', err.code || err.message)
        );
    }
};

export default aiClient;
