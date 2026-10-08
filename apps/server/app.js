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
import { listsRouter, itemsRouter } from './routes/tasks.js';
import { classesRouter, skillsRouter, achievementsRouter, leaderboardRouter } from './routes/progression.js';
import gamesRouter from './routes/games.js';
import aiRouter from './routes/ai.js';
import internalRouter, { requireInternalToken } from './routes/internal.js';
import { securityHeaders, sessionMiddleware, csrfProtection, apiLimiter, authLimiter, gameLimiter, aiLimiter } from './lib/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../web/dist');
const SESSION_COOKIE = 'tq.sid';

export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.set('sessionCookieName', SESSION_COOKIE);

    app.use(securityHeaders());
    // Service-to-service (AI chat write tools): token-protected, no session or CSRF.
    app.use('/internal', express.json({ limit: '16kb' }), requireInternalToken, internalRouter);
    app.use(express.json({ limit: '16kb' }));
    app.use(sessionMiddleware(SESSION_COOKIE));
    app.use('/api', apiLimiter, csrfProtection);
    app.use(['/api/auth/discord', '/api/auth/callback'], authLimiter);
    app.use('/api/games', gameLimiter);

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

    // ── Authenticated endpoints ──────────────────────────────────────────────
    app.use('/api/user', requireAuth, userRouter);
    app.use('/api/lists', requireAuth, listsRouter);
    app.use('/api/items', requireAuth, itemsRouter);
    app.use('/api/classes', requireAuth, classesRouter);
    app.use('/api/skills', requireAuth, skillsRouter);
    app.use('/api/achievements', requireAuth, achievementsRouter);
    app.use('/api/games', requireAuth, gamesRouter);
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
