/** Public AI endpoints. Thin proxy: validate, add the trusted Discord ID, forward. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { aiSummaryBody, aiPrioritizeBody, aiChatBody, aiResumeBody, uuidParam } from '../lib/schemas.js';
import aiClient, { assertEnabled } from '../lib/aiClient.js';

const router = Router();

// Every route needs the feature flag and the user's own opt-in.
router.use(
    asyncRoute(async (req, res, next) => {
        assertEnabled();
        const user = await db.users.getUser(uid(req));
        if (user && user.ai_enabled === 0) {
            return res.status(403).json({ error: 'AI features are turned off for your account.', code: 'AI_OPTED_OUT' });
        }
        next();
    })
);

router.get('/ping', asyncRoute(async (req, res) => res.json(await aiClient.get('/v1/ping', uid(req)))));

router.post(
    '/summary',
    asyncRoute(async (req, res) => {
        res.json(await aiClient.post('/v1/summary', uid(req), parse(aiSummaryBody, req.body), { timeoutMs: 45000 }));
    })
);

router.post(
    '/prioritize',
    asyncRoute(async (req, res) => {
        res.json(await aiClient.post('/v1/prioritize', uid(req), parse(aiPrioritizeBody, req.body ?? {}), { timeoutMs: 45000 }));
    })
);

router.post(
    '/chat',
    asyncRoute(async (req, res) => {
        await aiClient.stream('/v1/chat', uid(req), parse(aiChatBody, req.body), res);
    })
);

router.post(
    '/chat/:threadId/resume',
    asyncRoute(async (req, res) => {
        const { threadId } = parse(uuidParam, req.params);
        await aiClient.stream(`/v1/chat/${threadId}/resume`, uid(req), parse(aiResumeBody, req.body), res);
    })
);

router.get('/threads', asyncRoute(async (req, res) => res.json(await aiClient.get('/v1/threads', uid(req)))));

router.get(
    '/threads/:threadId',
    asyncRoute(async (req, res) => {
        const { threadId } = parse(uuidParam, req.params);
        res.json(await aiClient.get(`/v1/threads/${threadId}`, uid(req)));
    })
);

router.delete(
    '/threads/:threadId',
    asyncRoute(async (req, res) => {
        const { threadId } = parse(uuidParam, req.params);
        res.json(await aiClient.delete(`/v1/threads/${threadId}`, uid(req)));
    })
);

export default router;
