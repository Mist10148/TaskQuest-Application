/**
 * How the bot asks the web server to send a web push (the bot owns the reminder job; the server holds the VAPID keys).
 * Best effort by design: a reminder must never fail or wait because a push could not be sent, so notify() never throws
 * and gives up quickly. Off unless WEB_PUSH_INTERNAL_URL and a token are set.
 */

'use strict';

/** Settings from the shared root .env. The token falls back to AI_INTERNAL_TOKEN, which the bot already has. */
function configFromEnv(env = process.env) {
    const url = String(env.WEB_PUSH_INTERNAL_URL || '').replace(/\/+$/, '');
    const token = env.WEB_PUSH_INTERNAL_TOKEN || env.AI_INTERNAL_TOKEN || '';
    return { enabled: Boolean(url && token), url, token, timeoutMs: parseInt(env.WEB_PUSH_TIMEOUT_MS, 10) || 5000 };
}

/**
 * @param {{ config?: object, fetch?: Function }} [deps]
 * @returns {{ enabled: boolean, notify: (discordId: string, message: { title: string, body?: string, url?: string }) => Promise<boolean> }}
 */
function createPushClient({ config = configFromEnv(), fetch: fetchImpl = globalThis.fetch } = {}) {
    return {
        enabled: Boolean(config.enabled),
        /** Resolves true when the server accepted the request; false on any problem. */
        async notify(discordId, message) {
            if (!config.enabled) return false;
            try {
                const res = await fetchImpl(`${config.url}/internal/push`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-ai-token': config.token },
                    body: JSON.stringify({ discordId: String(discordId), ...message }),
                    signal: AbortSignal.timeout(config.timeoutMs)
                });
                return res.ok;
            } catch {
                return false;
            }
        }
    };
}

module.exports = { configFromEnv, createPushClient };
