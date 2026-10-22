/**
 * Comments on tasks. Access is decided by the shared service (db.comments, through db.access): anyone on the task's quest reads,
 * an editor or better writes, the author or a manager deletes, and a stranger gets 404 for the task and the comment alike.
 * Authors are shown by display name only.
 */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { commentLimiter } from '../lib/security.js';
import { idParam, bigIdParam, commentBody } from '../lib/schemas.js';

/** Mounted on /api/items, next to the task routes. */
export const itemCommentsRouter = Router();
/** Mounted on /api/comments. */
export const commentsRouter = Router();

itemCommentsRouter.get(
    '/:id/comments',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        res.json({ comments: await db.comments.listComments(uid(req), id) });
    })
);

itemCommentsRouter.post(
    '/:id/comments',
    commentLimiter,
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const { body } = parse(commentBody, req.body);
        res.status(201).json(await db.comments.addComment(uid(req), id, body));
    })
);

commentsRouter.delete(
    '/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(bigIdParam, req.params);
        await db.comments.deleteComment(uid(req), id);
        res.json({ success: true });
    })
);
