/**
 * Shared lists: members and invitations. Access is decided inside @taskquest/shared (db.sharing, db.access): a stranger gets 404
 * from every route here, a member whose role is too weak gets 403. Discord IDs never appear in a request or a response:
 * people are invited by their exact Discord username and members are addressed by an opaque member key.
 */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { inviteLimiter } from '../lib/security.js';
import { idParam, inviteBody, memberRoleBody, memberKeyParam } from '../lib/schemas.js';

export const listSharingRouter = Router();
export const invitesRouter = Router();

listSharingRouter.get(
    '/:id/members',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        res.json(await db.sharing.listMembers(uid(req), id));
    })
);

listSharingRouter.post(
    '/:id/invites',
    inviteLimiter,
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        const body = parse(inviteBody, req.body);
        const inv = await db.sharing.invite(uid(req), id, body);
        if (inv.dryRun) return res.json({ name: inv.name, avatarUrl: inv.avatarUrl });
        res.status(201).json({ id: inv.id, role: inv.role, expiresAt: inv.expiresAt, inviteeName: inv.inviteeName });
    })
);

listSharingRouter.patch(
    '/:id/members/:memberKey',
    asyncRoute(async (req, res) => {
        const { id, memberKey } = parse(memberKeyParam, req.params);
        const { role } = parse(memberRoleBody, req.body);
        res.json(await db.sharing.setRole(uid(req), id, memberKey, role));
    })
);

listSharingRouter.delete(
    '/:id/members/:memberKey',
    asyncRoute(async (req, res) => {
        const { id, memberKey } = parse(memberKeyParam, req.params);
        await db.sharing.removeMember(uid(req), id, memberKey);
        res.json({ success: true });
    })
);

listSharingRouter.post(
    '/:id/leave',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        await db.sharing.leave(uid(req), id);
        res.json({ success: true });
    })
);

// ── My invitations ──────────────────────────────────────────────────────────

invitesRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        res.json(await db.sharing.listInvites(uid(req)));
    })
);

invitesRouter.post(
    '/:id/accept',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        res.json(await db.sharing.respond(uid(req), id, true));
    })
);

invitesRouter.post(
    '/:id/decline',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        res.json(await db.sharing.respond(uid(req), id, false));
    })
);

// Withdraw an invitation of a list I manage.
invitesRouter.delete(
    '/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        await db.sharing.revoke(uid(req), id);
        res.json({ success: true });
    })
);
