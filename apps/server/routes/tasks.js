/**
 * Lists and items. Ownership is enforced inside the shared services: every
 * query is scoped to the logged-in user's Discord ID.
 */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import aiClient from '../lib/aiClient.js';
import { asyncRoute, parse, uid, xpResult } from '../lib/http.js';
import { idParam, listIdParam, createListBody, updateListBody, createItemBody, updateItemBody, toggleItemBody } from '../lib/schemas.js';

export const listsRouter = Router();
export const itemsRouter = Router();

const listWithCounts = (l) => ({ ...l, itemsTotal: l.items_total, itemsCompleted: l.items_completed });

listsRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        const lists = await db.tasks.getLists(uid(req));
        res.json(lists.map(listWithCounts));
    })
);

listsRouter.post(
    '/',
    asyncRoute(async (req, res) => {
        const r = await db.tasks.createList(uid(req), parse(createListBody, req.body));
        aiClient.reindex(uid(req), r.list.id);
        res.status(201).json({ ...r.list, newAchievements: r.achievements, xpResult: xpResult(r.xp) });
    })
);

listsRouter.get(
    '/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const list = await db.tasks.getList(uid(req), id);
        if (!list) return res.status(404).json({ error: 'List not found', code: 'NOT_FOUND' });
        const items = await db.tasks.getItems(uid(req), id);
        res.json({ ...list, items });
    })
);

listsRouter.patch(
    '/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const updated = await db.tasks.updateList(uid(req), id, parse(updateListBody, req.body));
        aiClient.reindex(uid(req), id);
        res.json(updated);
    })
);

listsRouter.delete(
    '/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        await db.tasks.deleteList(uid(req), id);
        aiClient.forget(uid(req), id);
        res.json({ success: true });
    })
);

listsRouter.post(
    '/:listId/items',
    asyncRoute(async (req, res) => {
        const { listId } = parse(listIdParam, req.params);
        const r = await db.tasks.addItem(uid(req), listId, parse(createItemBody, req.body));
        aiClient.reindex(uid(req), listId);
        res.status(201).json({ ...r.item, newAchievements: r.achievements, xpResult: xpResult(r.xp) });
    })
);

itemsRouter.patch(
    '/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const item = await db.tasks.updateItem(uid(req), id, parse(updateItemBody, req.body));
        if (item?.list_id) aiClient.reindex(uid(req), item.list_id);
        res.json(item);
    })
);

itemsRouter.patch(
    '/:id/toggle',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const body = parse(toggleItemBody, req.body && Object.keys(req.body).length ? req.body : undefined);
        const r = await db.tasks.setItemCompleted(uid(req), id, body?.completed);
        if (r.item?.list_id) aiClient.reindex(uid(req), r.item.list_id);
        res.json({ ...r.item, completed: r.completed, newAchievements: r.achievements, xpResult: xpResult(r.xp) });
    })
);

itemsRouter.delete(
    '/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const existing = await db.tasks.getItem(uid(req), id);
        await db.tasks.deleteItem(uid(req), id);
        if (existing?.list_id) aiClient.reindex(uid(req), existing.list_id);
        res.json({ success: true });
    })
);
