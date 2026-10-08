/**
 * Service-to-service endpoints for the AI service (chat write tools).
 *
 * Not reachable by browsers: no session, protected by the shared
 * X-AI-Token. They run the same db.tasks.* services as the public API, so XP,
 * achievements and validation behave identically. The AI service only calls
 * these after the user approved the action in the UI.
 */

import crypto from 'crypto';
import { Router } from 'express';
import db from '@taskquest/shared/db';
import config from '../config.js';
import { asyncRoute, parse, xpResult } from '../lib/http.js';
import {
    idParam,
    internalCreateListBody,
    internalAddItemBody,
    internalToggleBody,
    internalUpdateListBody
} from '../lib/schemas.js';

/** Constant-time check of the shared secret. 404s when AI is disabled. */
export function requireInternalToken(req, res, next) {
    if (!config.ai.enabled || !config.ai.internalToken) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const given = Buffer.from(String(req.get('x-ai-token') || ''));
    const expected = Buffer.from(config.ai.internalToken);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
        return res.status(401).json({ error: 'Invalid token', code: 'UNAUTHENTICATED' });
    }
    next();
}

const router = Router();

router.post(
    '/lists',
    asyncRoute(async (req, res) => {
        const { discordId, items = [], ...fields } = parse(internalCreateListBody, req.body);
        const created = await db.tasks.createList(discordId, fields);
        const addedItems = [];
        let xp = created.xp;
        const achievements = [...(created.achievements || [])];
        for (const name of items) {
            const r = await db.tasks.addItem(discordId, created.list.id, { name });
            addedItems.push(r.item);
            achievements.push(...(r.achievements || []));
            if (r.xp?.finalXP) xp = r.xp;
        }
        res.status(201).json({ ...created.list, items: addedItems, newAchievements: achievements, xpResult: xpResult(xp) });
    })
);

router.post(
    '/lists/:id/items',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { discordId, ...fields } = parse(internalAddItemBody, req.body);
        const r = await db.tasks.addItem(discordId, id, fields);
        res.status(201).json({ ...r.item, newAchievements: r.achievements, xpResult: xpResult(r.xp) });
    })
);

router.patch(
    '/items/:id/toggle',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { discordId, completed } = parse(internalToggleBody, req.body);
        const r = await db.tasks.setItemCompleted(discordId, id, completed);
        res.json({ ...r.item, completed: r.completed, newAchievements: r.achievements, xpResult: xpResult(r.xp) });
    })
);

router.patch(
    '/lists/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { discordId, ...fields } = parse(internalUpdateListBody, req.body);
        res.json(await db.tasks.updateList(discordId, id, fields));
    })
);

export default router;
