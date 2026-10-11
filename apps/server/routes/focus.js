/** Focus sessions: a server-timed work timer that pays XP for the minutes that really passed. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { focusStartBody, focusFinishBody } from '../lib/schemas.js';

const router = Router();
const { LIMITS, REWARDS } = shared;

router.get(
    '/',
    asyncRoute(async (req, res) => {
        res.json({
            ...(await db.focus.getFocusStatus(uid(req))),
            config: {
                minMinutes: LIMITS.FOCUS_MIN_MINUTES,
                maxMinutes: LIMITS.FOCUS_MAX_MINUTES,
                xpPerMinute: REWARDS.FOCUS_XP_PER_MINUTE,
                xpPerDay: LIMITS.FOCUS_XP_PER_DAY,
                sessionsPerDay: LIMITS.FOCUS_SESSIONS_PER_DAY
            }
        });
    })
);

router.post(
    '/start',
    asyncRoute(async (req, res) => {
        const { minutes } = parse(focusStartBody, req.body);
        res.json({ success: true, ...(await db.focus.startFocus(uid(req), minutes)) });
    })
);

router.post(
    '/finish',
    asyncRoute(async (req, res) => {
        const { sessionId } = parse(focusFinishBody, req.body);
        const r = await db.focus.finishFocus(uid(req), sessionId);
        res.json({ success: true, ...r, newAchievements: r.achievements });
    })
);

export default router;
