/**
 * Lists and items. Ownership is enforced inside the shared services: every
 * query is scoped to the logged-in user's Discord ID.
 */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import aiClient from '../lib/aiClient.js';
import { asyncRoute, parse, uid, xpResult } from '../lib/http.js';
import { idParam, listIdParam, listItemsQuery, searchQuery, saveTemplateBody, createListBody, updateListBody, createItemBody, updateItemBody, toggleItemBody, reorderBody, moveItemBody } from '../lib/schemas.js';

export const listsRouter = Router();
export const itemsRouter = Router();

// Sharing fields are camelCased for the client; the owner's Discord ID is already stripped from lists the caller does not own.
const sharing = ({ is_owner: isOwner, owner_name: ownerName, member_count: memberCount, ...l }) => ({ ...l, isOwner, ownerName, memberCount });
const listWithCounts = (l) => sharing({ ...l, itemsTotal: l.items_total, itemsCompleted: l.items_completed });

listsRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        const lists = await db.tasks.getLists(uid(req));
        res.json(lists.map(listWithCounts));
    })
);

// Declared before /:id so "search" is not read as a list id.
listsRouter.get(
    '/search',
    asyncRoute(async (req, res) => {
        const { q, scope } = parse(searchQuery, req.query);
        res.json(await db.tasks.search(uid(req), q, { scope }));
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
        const { limit, cursor } = parse(listItemsQuery, req.query);
        const list = await db.tasks.getList(uid(req), id);
        if (!list) return res.status(404).json({ error: 'List not found', code: 'NOT_FOUND' });
        if (limit === undefined) return res.json({ ...sharing(list), items: await db.tasks.getItems(uid(req), id, { list }) });
        // One page: read one task more than asked to know whether another page follows.
        const [position, after] = cursor ? cursor.split('.').map(Number) : [];
        const page = await db.tasks.getItems(uid(req), id, { list, limit: limit + 1, after: cursor ? { position, id: after } : null });
        const items = page.slice(0, limit);
        const last = items[items.length - 1];
        res.json({ ...sharing(list), items, nextCursor: page.length > limit ? `${last.position}.${last.id}` : null });
    })
);

listsRouter.patch(
    '/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const updated = await db.tasks.updateList(uid(req), id, parse(updateListBody, req.body));
        aiClient.reindex(uid(req), id);
        res.json(sharing(updated));
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

// Saves the quest's tasks (flattened; no due dates or progress) as a reusable template.
listsRouter.post(
    '/:id/save-as-template',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const body = parse(saveTemplateBody, req.body ?? {});
        res.status(201).json(await db.templates.saveFromList(uid(req), id, body));
    })
);

listsRouter.patch(
    '/:id/reorder',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { itemIds } = parse(reorderBody, req.body);
        await db.tasks.reorderItems(uid(req), id, itemIds);
        res.json(await db.tasks.getItems(uid(req), id));
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

// Moves a top-level task, with its subtasks, to the end of another quest. The answer is the task as GET /api/lists/:id lists it.
itemsRouter.post(
    '/:id/move',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { listId } = parse(moveItemBody, req.body);
        const r = await db.tasks.moveItemToList(uid(req), id, listId);
        aiClient.reindex(uid(req), r.fromListId);
        aiClient.reindex(uid(req), listId);
        res.json({ item: r.item, moved: r.moved });
    })
);

// A task's history, newest first (at most 50 entries). Anyone on the quest may read it.
itemsRouter.get(
    '/:id/activity',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        res.json({ activity: await db.activity.getActivity(uid(req), id) });
    })
);

itemsRouter.patch(
    '/:id/toggle',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const body = parse(toggleItemBody, req.body && Object.keys(req.body).length ? req.body : undefined);
        const r = await db.tasks.setItemCompleted(uid(req), id, body?.completed);
        if (r.item?.list_id) aiClient.reindex(uid(req), r.item.list_id);
        res.json({ ...r.item, completed: r.completed, newAchievements: r.achievements, xpResult: xpResult(r.xp), bonuses: r.bonuses, nextItem: r.nextItem });
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
