/**
 * Server configuration, read once from the environment and validated at
 * startup so misconfiguration fails fast instead of at the first request.
 */

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import sharedEnv from '@taskquest/shared/env';

// apps/server/.env first, then the shared root .env.
sharedEnv.loadEnv(path.dirname(fileURLToPath(import.meta.url)));

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

function stripSlash(url) {
    return url ? url.replace(/\/+$/, '') : url;
}

// The public origin users load the app from. In development this is the
// Vite dev server, which proxies /api to this server.
const publicUrl = stripSlash(env.PUBLIC_URL || env.FRONTEND_URL || (isProduction ? '' : 'http://localhost:8080'));

const config = {
    isProduction,
    // SERVER_PORT lets the bot and web server share one root .env without clashing.
    port: parseInt(env.SERVER_PORT || env.PORT, 10) || 3001,
    publicUrl,
    /** Origins allowed to make state-changing requests (CSRF protection). */
    allowedOrigins: [publicUrl, ...(env.ALLOWED_ORIGINS || '').split(',').map((s) => stripSlash(s.trim()))].filter(Boolean),
    trustProxy: env.TRUST_PROXY !== undefined ? Number(env.TRUST_PROXY) : isProduction ? 1 : 0,
    sessionSecret: env.SESSION_SECRET,
    sessionMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        redirectUri: env.DISCORD_REDIRECT_URI || `${publicUrl}/api/auth/callback`
    },
    serveFrontend: env.SERVE_FRONTEND !== undefined ? env.SERVE_FRONTEND === 'true' : isProduction,
    /** Optional AI service (docs/AI_INTEGRATION.md). Off unless AI_ENABLED=true. */
    ai: {
        enabled: env.AI_ENABLED === 'true',
        serviceUrl: stripSlash(env.AI_SERVICE_URL || 'http://localhost:8000'),
        internalToken: env.AI_INTERNAL_TOKEN,
        timeoutMs: parseInt(env.AI_TIMEOUT_MS, 10) || 20000
    }
};

/** Throws with a list of every problem found. */
export function validateConfig() {
    const problems = [];
    if (!config.publicUrl) problems.push('PUBLIC_URL is required in production (e.g. https://taskquest.example.com).');
    if (!config.discord.clientId) problems.push('DISCORD_CLIENT_ID is required.');
    if (!config.discord.clientSecret) problems.push('DISCORD_CLIENT_SECRET is required.');

    if (!config.sessionSecret || config.sessionSecret.length < 32) {
        if (isProduction) {
            problems.push('SESSION_SECRET must be at least 32 characters (generate one with: openssl rand -base64 48).');
        } else {
            config.sessionSecret = crypto.randomBytes(48).toString('base64');
            console.warn('⚠️  SESSION_SECRET missing/short: using a random one for this run (logins reset on restart).');
        }
    }

    if (config.ai.enabled && (!config.ai.internalToken || config.ai.internalToken.length < 32)) {
        problems.push('AI_INTERNAL_TOKEN must be at least 32 characters when AI_ENABLED=true.');
    }

    if (problems.length) {
        throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    }
    return config;
}

export default config;
