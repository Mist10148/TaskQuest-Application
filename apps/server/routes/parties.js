/**
 * Parties: a small group with a shared weekly quest. Members see each other's display names and this week's counts only;
 * Discord IDs never appear in a request or a response (people are invited by their stored display name).
 */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { inviteLimiter } from '../lib/security.js';
import { idParam, createPartyBody, partyInviteBody } from '../lib/schemas.js';

const router = Router();

// My party with this week's quest (null when I am in none) and the invitations waiting for me.
router.get(
    '/',
    asyncRoute(async (req, res) => {
        const [party, invites] = await Promise.all([db.parties.status(uid(req)), db.parties.listInvites(uid(req))]);
        res.json({ party, invites });
    })
);

router.post(
    '/',
    asyncRoute(async (req, res) => {
        await db.parties.create(uid(req), parse(createPartyBody, req.body).name);
        res.status(201).json(await db.parties.status(uid(req)));
    })
);

router.post(
    '/invites',
    inviteLimiter,
    asyncRoute(async (req, res) => {
        const inv = await db.parties.invite(uid(req), parse(partyInviteBody, req.body));
        res.status(201).json({ id: inv.id, inviteeName: inv.inviteeName, expiresAt: inv.expiresAt });
    })
);

router.post(
    '/invites/:id/accept',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        res.json(await db.parties.respond(uid(req), id, true));
    })
);

router.post(
    '/invites/:id/decline',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        res.json(await db.parties.respond(uid(req), id, false));
    })
);

router.delete(
    '/invites/:id',
    asyncRoute(async (req, res) => {
        const { id } = parse(idParam, req.params);
        await db.parties.revoke(uid(req), id);
        res.json({ success: true });
    })
);

router.post(
    '/leave',
    asyncRoute(async (req, res) => {
        await db.parties.leave(uid(req));
        res.json({ success: true });
    })
);

router.post(
    '/claim',
    asyncRoute(async (req, res) => {
        const r = await db.parties.claim(uid(req));
        res.json({ success: true, ...r, newAchievements: r.achievements });
    })
);

// Disband: delete the party for everyone (owner only).
router.delete(
    '/',
    asyncRoute(async (req, res) => {
        await db.parties.disband(uid(req));
        res.json({ success: true });
    })
);

export default router;
