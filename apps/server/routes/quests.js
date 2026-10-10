/** Daily and weekly quests. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { questParam } from '../lib/schemas.js';

const router = Router();

router.get(
    '/',
    asyncRoute(async (req, res) => {
        res.json({ quests: await db.quests.getQuests(uid(req)) });
    })
);

router.post(
    '/:key/claim',
    asyncRoute(async (req, res) => {
        const { key } = parse(questParam, req.params);
        const r = await db.quests.claimQuest(uid(req), key);
        res.json({ success: true, ...r, newAchievements: r.achievements });
    })
);

export default router;
