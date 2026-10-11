/** Task templates: save a set of tasks once, turn it into a quest whenever needed. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import aiClient from '../lib/aiClient.js';
import { asyncRoute, parse, uid, xpResult } from '../lib/http.js';
import { idParam, createTemplateBody, applyTemplateBody } from '../lib/schemas.js';

const router = Router();

router.get(
    '/',
    asyncRoute(async (req, res) => {
        res.json(await db.templates.listTemplates(uid(req)));
    })
);

router.post(
    '/',
    asyncRoute(async (req, res) => {
        res.status(201).json(await db.templates.createTemplate(uid(req), parse(createTemplateBody, req.body)));
    })
);

router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        await db.templates.deleteTemplate(uid(req), id);
        res.json({ success: true });
    })
);

// Creates a quest (or adds to `listId`); every task is rewarded like a hand-made one, so the daily caps apply.
router.post(
    '/:id/apply',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const r = await db.templates.applyTemplate(uid(req), id, parse(applyTemplateBody, req.body ?? {}));
        aiClient.reindex(uid(req), r.list.id);
        res.status(201).json({ list: r.list, items: r.items, created: r.created, xpResult: xpResult(r.xp), newAchievements: r.achievements });
    })
);

export default router;
