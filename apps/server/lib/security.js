/**
 * HTTP security middleware: security headers, rate limits, CSRF protection
 * and the persistent session store.
 */

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import db from '@taskquest/shared/db';
import config from '../config.js';
import { MySQLSessionStore } from './sessionStore.js';

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

/** Keyed by user when logged in, otherwise by IP. */
const keyByUser = (req) => (req.session?.user?.discordId ? `user:${req.session.user.discordId}` : `ip:${req.ip}`);

export const apiLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 900, keyGenerator: keyByUser });
export const authLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 30 });
export const gameLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 1000, limit: 90, keyGenerator: keyByUser });

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
    const store = new MySQLSessionStore(db.getPool(), { ttlMs: config.sessionMaxAgeMs });

    return session({
        name: cookieName,
        secret: config.sessionSecret,
        store,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        proxy: config.trustProxy > 0,
        cookie: {
            httpOnly: true,
            secure: config.isProduction,
            sameSite: 'lax',
            maxAge: config.sessionMaxAgeMs,
            path: '/'
        }
    });
}
