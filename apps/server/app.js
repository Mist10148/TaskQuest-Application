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
import { classesRouter, skillsRouter, achievementsRouter, leaderboardRouter } from './routes/progression.js';
import gamesRouter from './routes/games.js';
import questsRouter from './routes/quests.js';
import cosmeticsRouter from './routes/cosmetics.js';
import focusRouter from './routes/focus.js';
import reviewRouter from './routes/review.js';
import statsRouter from './routes/stats.js';
import calendarRouter from './routes/calendar.js';
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
    // Imports carry whole lists, so that one route gets a bigger body limit (the shared service caps its size).
    app.use('/api/user/import', express.json({ limit: '1mb' }));
    // A CSV of up to 1 MB of text grows a little once its line breaks and quotes are escaped as JSON.
    app.use('/api/import', express.json({ limit: '2mb' }));
    // An arcade run carries its recorded input timeline (up to ~12k small integers).
    app.use('/api/games/arcade', express.json({ limit: '128kb' }));
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
    app.use('/api/calendar', calendarRouter);

    // ── Authenticated endpoints ──────────────────────────────────────────────
    app.use('/api/user', requireAuth, userRouter);
    app.use('/api/import', requireAuth, importRouter);
    app.use('/api/templates', requireAuth, templatesRouter);
    app.use('/api/lists', requireAuth, listsRouter);
    app.use('/api/items', requireAuth, itemsRouter);
    app.use('/api/classes', requireAuth, classesRouter);
    app.use('/api/skills', requireAuth, skillsRouter);
    app.use('/api/achievements', requireAuth, achievementsRouter);
    app.use('/api/games', requireAuth, gamesRouter);
    app.use('/api/quests', requireAuth, questsRouter);
    app.use('/api/cosmetics', requireAuth, cosmeticsRouter);
    app.use('/api/focus', requireAuth, focusRouter);
    app.use('/api/review', requireAuth, reviewRouter);
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
