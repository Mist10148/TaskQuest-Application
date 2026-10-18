/**
 * HTTP security middleware: security headers, rate limits, CSRF protection
 * and the persistent session store.
 */

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import db from '@taskquest/shared/db';
import config from '../config.js';
import { DbSessionStore } from './sessionStore.js';

/** Security headers, with a CSP matching what the SPA actually loads. */
export function securityHeaders() {
    return helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                'default-src': ["'self'"],
                'script-src': ["'self'"],
                // framer-motion and Radix set inline style attributes.
                'style-src': ["'self'", "'unsafe-inline'"],
                'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com'],
                'font-src': ["'self'", 'data:'],
                'connect-src': ["'self'"],
                'frame-ancestors': ["'none'"],
                'form-action': ["'self'"],
                'object-src': ["'none'"],
                'base-uri': ["'self'"],
                'upgrade-insecure-requests': config.isProduction ? [] : null
            }
        },
        crossOriginEmbedderPolicy: false,
        hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    });
}

const limiterDefaults = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next, options) =>
        res.status(options.statusCode).json({ error: 'Too many requests, please slow down.', code: 'RATE_LIMITED' })
};

/**
 * The rate-limit key of a client address. An IPv6 client usually controls a whole /64, so one address per request would never hit a
 * per-address limit: IPv6 is keyed by its /64 prefix, and an IPv4-mapped IPv6 address by its IPv4 part.
 */
export function ipKey(ip) {
    const text = String(ip || '');
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(text);
    if (mapped) return mapped[1];
    if (!text.includes(':')) return text;
    const [head, tail = ''] = text.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = text.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
    return `${groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, '0')).join(':')}::/64`;
}

/** Keyed by user when logged in, otherwise by IP. */
const keyByUser = (req) => (req.session?.user?.discordId ? `user:${req.session.user.discordId}` : `ip:${ipKey(req.ip)}`);

export const apiLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 900, keyGenerator: keyByUser });
/** Starting a login and finishing it are separate limits (30 each per 15 minutes per client), so one login costs one of each. */
export const authLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 30, keyGenerator: (req) => `ip:${ipKey(req.ip)}` });
/** The OAuth callback is a browser navigation: a refusal sends the person back to the login page with a message, not a JSON error. */
export const authCallbackLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 15 * 60 * 1000,
    limit: 30,
    keyGenerator: (req) => `ip:${ipKey(req.ip)}`,
    handler: (req, res) => res.redirect(`${config.publicUrl}/?error=rate_limited`)
});
export const gameLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 1000, limit: 90, keyGenerator: keyByUser });

export const aiLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 1000, limit: 20, keyGenerator: keyByUser });

/** Inviting looks a person up by name, so failed lookups are limited too, not only the invitations that were sent. */
export const inviteLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 30, keyGenerator: keyByUser });

/**
 * The same lookups, limited per client address as well: one person with many accounts (or a script behind one signed-in account)
 * cannot probe for names faster than a single account could. Both limiters apply to the invite routes.
 */
export const inviteIpLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 60, keyGenerator: (req) => `ip:${ipKey(req.ip)}` });

/**
 * A daily ceiling on the same lookups. The 15 minute limits alone allow thousands of username probes a day per
 * account; a real person needs a handful (the confirmation step and the send itself), and the invitation count
 * (30 a day) only sees invitations that were created.
 */
export const inviteDailyLimiter = rateLimit({ ...limiterDefaults, windowMs: 24 * 60 * 60 * 1000, limit: 100, keyGenerator: keyByUser });
export const inviteIpDailyLimiter = rateLimit({ ...limiterDefaults, windowMs: 24 * 60 * 60 * 1000, limit: 300, keyGenerator: (req) => `ip:${ipKey(req.ip)}` });

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(value) {
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

/**
 * CSRF protection for cookie-authenticated, state-changing requests:
 *  1. The Origin (or, failing that, Referer) must be one of our origins.
 *  2. Bodies must be JSON, which a cross-site HTML form cannot send.
 * Together with SameSite=Lax cookies this blocks cross-site form posts such
 * as a hidden form hitting POST /api/user/reset.
 */
export function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const allowed = new Set(config.allowedOrigins.map(originOf).filter(Boolean));
    const origin = req.get('origin') ? originOf(req.get('origin')) : req.get('referer') ? originOf(req.get('referer')) : null;
    if (!origin || !allowed.has(origin)) {
        return res.status(403).json({ error: 'Cross-site request blocked', code: 'CSRF' });
    }

    const length = Number(req.get('content-length') || 0);
    if (length > 0 && !req.is('application/json')) {
        return res.status(415).json({ error: 'Content-Type must be application/json', code: 'UNSUPPORTED_MEDIA_TYPE' });
    }
    next();
}

/** express-session backed by the web_sessions table (survives restarts and redeploys). */
export function sessionMiddleware(cookieName) {
    const store = new DbSessionStore(db.getPool(), { ttlMs: config.sessionMaxAgeMs });

    return session({
        name: cookieName,
        secret: config.sessionSecret,
        store,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        proxy: Boolean(config.trustProxy),
        cookie: {
            httpOnly: true,
            secure: config.isProduction,
            sameSite: 'lax',
            maxAge: config.sessionMaxAgeMs,
            path: '/'
        }
    });
}
