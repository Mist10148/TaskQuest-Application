/** Read-only statistics for the Stats page. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { statsHistoryQuery } from '../lib/schemas.js';

const router = Router();

router.get(
    '/xp-history',
    asyncRoute(async (req, res) => {
        const { days } = parse(statsHistoryQuery, req.query);
        res.json(await db.stats.getXPHistory(uid(req), days));
    })
);

router.get(
    '/summary',
    asyncRoute(async (req, res) => {
        res.json(await db.stats.getStatsSummary(uid(req)));
    })
);

export default router;
