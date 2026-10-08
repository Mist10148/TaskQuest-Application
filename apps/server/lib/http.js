/** Small helpers shared by route modules. */

import shared from '@taskquest/shared';
import { ZodError } from 'zod';

const { TaskQuestError } = shared;

/** Wrap an async route handler so rejections reach the error middleware. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parse with a zod schema; ZodError is turned into a 400 by errorHandler. */
export const parse = (schema, value) => schema.parse(value);

export function requireAuth(req, res, next) {
    if (!req.session?.user?.discordId) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' });
    next();
}

/** Discord ID of the logged-in user. */
export const uid = (req) => req.session.user.discordId;

export function notFound(req, res) {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
    if (err instanceof TaskQuestError) {
        if (err.code === 'COOLDOWN' && err.details?.retryAfterMs) {
            res.set('Retry-After', String(Math.ceil(err.details.retryAfterMs / 1000)));
        }
        return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    }
    if (err instanceof ZodError) {
        const first = err.issues[0];
        const where = first?.path?.length ? `${first.path.join('.')}: ` : '';
        return res.status(400).json({ error: `${where}${first?.message || 'Invalid request'}`, code: 'VALIDATION' });
    }
    if (err?.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Malformed JSON body', code: 'VALIDATION' });
    }
    if (err?.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body too large', code: 'VALIDATION' });
    }
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL' });
}

/** Build a Discord CDN avatar URL without exposing anything else. */
export function avatarUrl(discordId, avatarHash) {
    if (!discordId || !avatarHash || !/^(a_)?[a-f0-9]{32}$/.test(avatarHash)) return null;
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${ext}?size=128`;
}

/** Shape an XP reward for the frontend toast. */
export function xpResult(xp) {
    if (!xp || !xp.finalXP) return null;
    return {
        baseXP: xp.baseXP,
        finalXP: xp.finalXP,
        bonusInfo: xp.bonusInfo,
        balanceAfter: xp.balanceAfter,
        newLevel: xp.level,
        leveledUp: Boolean(xp.leveledUp),
        capped: Boolean(xp.capped)
    };
}
