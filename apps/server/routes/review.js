/** Weekly review: this week's numbers and a once-a-week XP bonus. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, uid } from '../lib/http.js';

const router = Router();

router.get(
    '/',
    asyncRoute(async (req, res) => {
        res.json(await db.review.getReview(uid(req)));
    })
);

router.post(
    '/claim',
    asyncRoute(async (req, res) => {
        const r = await db.review.claimReview(uid(req));
        res.json({ success: true, ...r, newAchievements: r.achievements });
    })
);

export default router;
