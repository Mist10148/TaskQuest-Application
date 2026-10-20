/**
 * Service-to-service endpoints for the AI service (chat write tools).
 *
 * Not reachable by browsers: no session, protected by the shared
 * X-AI-Token. They run the same db.tasks.* services as the public API (through db.tasks.asOwner), so XP,
 * achievements and validation behave identically. asOwner refuses (NOT_FOUND) any list the user merely belongs to: the
 * AI can write only to lists the user owns, including the ones they share with others. (The AI's reads are narrower:
 * apps/ai/app/db/repo.py leaves out every list that has members.) The AI service only calls
 * these after the user approved the action in the UI.
 */

import crypto from 'crypto';
import { Router } from 'express';
import db from '@taskquest/shared/db';
import config from '../config.js';
import aiClient from '../lib/aiClient.js';
import { asyncRoute, parse, xpResult } from '../lib/http.js';
import {
    idParam,
    internalCreateListBody,
    internalAddItemBody,
    internalToggleBody,
    internalUpdateListBody,
    internalUpdateItemBody,
    internalSubtasksBody
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
        // One transaction: a failing item rolls the new list back too, so the AI never reports a half-made quest.
        const created = await db.tasks.asOwner.createListWithItems(discordId, fields, items);
        const addedItems = [];
        let xp = created.xp;
        const achievements = [...(created.achievements || [])];
        for (const r of created.items) {
            addedItems.push(r.item);
            achievements.push(...(r.achievements || []));
            if (r.xp?.finalXP) xp = r.xp;
        }
        aiClient.reindex(discordId, created.list.id);
        res.status(201).json({ ...created.list, items: addedItems, newAchievements: achievements, xpResult: xpResult(xp) });
    })
);

router.post(
    '/lists/:id/items',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { discordId, ...fields } = parse(internalAddItemBody, req.body);
        const r = await db.tasks.asOwner.addItem(discordId, id, fields);
        aiClient.reindex(discordId, id);
        res.status(201).json({ ...r.item, newAchievements: r.achievements, xpResult: xpResult(r.xp), bonuses: r.bonuses });
    })
);

router.patch(
    '/items/:id/toggle',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { discordId, completed } = parse(internalToggleBody, req.body);
        const r = await db.tasks.asOwner.setItemCompleted(discordId, id, completed);
        if (r.item?.list_id) aiClient.reindex(discordId, r.item.list_id);
        res.json({ ...r.item, completed: r.completed, newAchievements: r.achievements, xpResult: xpResult(r.xp), bonuses: r.bonuses });
    })
);

router.patch(
    '/items/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { discordId, ...fields } = parse(internalUpdateItemBody, req.body);
        const updated = await db.tasks.asOwner.updateItem(discordId, id, fields);
        aiClient.reindex(discordId, updated.list_id);
        res.json(updated);
    })
);

// Break a task down: 2-8 subtasks under it in one transaction, owner-scoped by the discordId the AI service took from its state.
router.post(
    '/items/:id/subtasks',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { discordId, names } = parse(internalSubtasksBody, req.body);
        const r = await db.tasks.asOwner.addSubtasks(discordId, id, names);
        aiClient.reindex(discordId, r.parent.list_id);
        const achievements = r.items.flatMap((x) => x.achievements || []);
        const xp = r.items.reduce((last, x) => (x.xp?.finalXP ? x.xp : last), null);
        res.status(201).json({ parent: r.parent, items: r.items.map((x) => x.item), newAchievements: achievements, xpResult: xpResult(xp) });
    })
);

router.patch(
    '/lists/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { discordId, ...fields } = parse(internalUpdateListBody, req.body);
        const updated = await db.tasks.asOwner.updateList(discordId, id, fields);
        aiClient.reindex(discordId, id);
        res.json(updated);
    })
);

export default router;
