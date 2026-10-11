/** The cosmetics shop: titles, avatar frames and profile accents bought with XP. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { cosmeticParam, equipCosmeticBody } from '../lib/schemas.js';

const router = Router();

router.get(
    '/',
    asyncRoute(async (req, res) => {
        await db.users.ensureUser(uid(req));
        res.json(await db.cosmetics.listCosmetics(uid(req)));
    })
);

router.post(
    '/:id/buy',
    asyncRoute(async (req, res) => {
        const { id } = parse(cosmeticParam, req.params);
        const r = await db.cosmetics.buyCosmetic(uid(req), id);
        res.json({ success: true, id: r.id, kind: r.kind, name: r.name, cost: r.cost, balance: r.balance, newAchievements: r.achievements });
    })
);

router.post(
    '/equip',
    asyncRoute(async (req, res) => {
        const { kind, id } = parse(equipCosmeticBody, req.body);
        const r = await db.cosmetics.equipCosmetic(uid(req), kind, id);
        res.json({ success: true, kind: r.kind, id: r.id, equipped: r.equipped });
    })
);

export default router;
