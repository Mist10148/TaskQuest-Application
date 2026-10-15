/** Express application factory (no listening; see index.js). */

import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import config from './config.js';
import { asyncRoute, requireAuth, uid, notFound, errorHandler } from './lib/http.js';
import authRouter from './routes/auth.js';
import userRouter from './routes/user.js';
import importRouter from './routes/import.js';
import templatesRouter from './routes/templates.js';
import { listsRouter, itemsRouter } from './routes/tasks.js';
import { listSharingRouter, invitesRouter } from './routes/sharing.js';
import partiesRouter from './routes/parties.js';
import { classesRouter, skillsRouter, achievementsRouter, leaderboardRouter } from './routes/progression.js';
import gamesRouter from './routes/games.js';
import questsRouter from './routes/quests.js';
import cosmeticsRouter from './routes/cosmetics.js';
import { pushConfig, pushRouter, requirePushToken, internalPushRouter } from './routes/push.js';
import focusRouter from './routes/focus.js';
import reviewRouter from './routes/review.js';
import { todayRouter, reflectionRouter, goalRouter } from './routes/engagement.js';
import statsRouter from './routes/stats.js';
import calendarRouter from './routes/calendar.js';
import aiRouter from './routes/ai.js';
import internalRouter, { requireInternalToken } from './routes/internal.js';
import { securityHeaders, sessionMiddleware, csrfProtection, apiLimiter, authLimiter, gameLimiter, aiLimiter } from './lib/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../web/dist');
const SESSION_COOKIE = 'tq.sid';

/**
 * Routes that carry more than the default 16 KB of JSON, and how much. Their bigger parser is mounted per route, after the
 * session, the rate limiter and requireAuth, so a stranger or a flood is refused before a large body is read or parsed.
 * Imports carry whole lists (the shared service caps their size); a CSV of up to 1 MB of text grows a little once its line
 * breaks and quotes are escaped as JSON; an arcade run carries its recorded input timeline (up to ~12k small integers).
 */
const LARGE_BODIES = [
    { prefix: '/api/user/import', limit: '1mb' },
    { prefix: '/api/import', limit: '2mb' },
    { prefix: '/api/games/arcade', limit: '128kb' }
];

/** Whether the request path is under one of the routes above (compared the way Express routes: ignoring case and a trailing slash). */
const hasLargeBody = (req) => {
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    return LARGE_BODIES.some(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`));
};

export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.set('sessionCookieName', SESSION_COOKIE);

    app.use(securityHeaders());
    // Service-to-service (AI chat write tools): token-protected, no session or CSRF.
    app.use('/internal/push', express.json({ limit: '4kb' }), requirePushToken, internalPushRouter); // the bot asks for a web push (own token check)
    app.use('/internal', express.json({ limit: '16kb' }), requireInternalToken, internalRouter);
    // Everything gets the small default parser, except the few routes that mount their own bigger one further down (LARGE_BODIES).
    const smallJson = express.json({ limit: '16kb' });
    app.use((req, res, next) => (hasLargeBody(req) ? next() : smallJson(req, res, next)));
    app.use(sessionMiddleware(SESSION_COOKIE));
    app.use('/api', apiLimiter, csrfProtection);
    app.use(['/api/auth/discord', '/api/auth/callback'], authLimiter);
    app.use('/api/games', gameLimiter);
    for (const { prefix, limit } of LARGE_BODIES) app.use(prefix, requireAuth, express.json({ limit }));

    // ── Public endpoints ─────────────────────────────────────────────────────
    app.get('/api/health', async (req, res) => {
        try {
            await db.ping();
            res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
        } catch {
            res.status(503).json({ status: 'error', database: 'unavailable' });
        }
    });

    app.get('/api/data/classes', (req, res) => res.json(shared.CLASSES));
    app.get('/api/data/skills', (req, res) => res.json(shared.SKILL_TREES));
    app.get('/api/data/achievements', (req, res) => res.json(shared.ACHIEVEMENTS));

    app.use('/api/auth', authRouter);
    app.use('/api/leaderboard', leaderboardRouter);
    app.use('/api/calendar', calendarRouter);
    app.get('/api/push/config', pushConfig);

    // ── Authenticated endpoints ──────────────────────────────────────────────
    app.use('/api/user', requireAuth, userRouter);
    app.use('/api/import', requireAuth, importRouter);
    app.use('/api/templates', requireAuth, templatesRouter);
    app.use('/api/lists', requireAuth, listsRouter);
    app.use('/api/lists', requireAuth, listSharingRouter);
    app.use('/api/invites', requireAuth, invitesRouter);
    app.use('/api/parties', requireAuth, partiesRouter);
    app.use('/api/items', requireAuth, itemsRouter);
    app.use('/api/classes', requireAuth, classesRouter);
    app.use('/api/skills', requireAuth, skillsRouter);
    app.use('/api/achievements', requireAuth, achievementsRouter);
    app.use('/api/games', requireAuth, gamesRouter);
    app.use('/api/quests', requireAuth, questsRouter);
    app.use('/api/cosmetics', requireAuth, cosmeticsRouter);
    app.use('/api/push', requireAuth, pushRouter);
    app.use('/api/focus', requireAuth, focusRouter);
    app.use('/api/review', requireAuth, reviewRouter);
    app.use('/api/today', requireAuth, todayRouter);
    app.use('/api/reflection', requireAuth, reflectionRouter);
    app.use('/api/goal', requireAuth, goalRouter);
    app.use('/api/stats', requireAuth, statsRouter);
    app.use('/api/ai', requireAuth, aiLimiter, aiRouter);
    app.get('/api/xp/history', requireAuth, asyncRoute(async (req, res) => res.json(await db.users.getXPHistory(uid(req), 50))));

    app.use('/api', notFound);

    // ── Frontend (single origin: the SPA and the API share cookies) ─────────
    if (config.serveFrontend) {
        app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));
        app.get('*', (req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
    }

    app.use(errorHandler);
    return app;
}
