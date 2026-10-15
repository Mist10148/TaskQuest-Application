/** A daily reflection and a weekly goal: two small, player-driven XP sources. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { reflectionBody, goalBody } from '../lib/schemas.js';

export const todayRouter = Router();
export const reflectionRouter = Router();
export const goalRouter = Router();

todayRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        res.json(await db.today.getToday(uid(req)));
    })
);

reflectionRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        res.json(await db.goals.getReflection(uid(req)));
    })
);

reflectionRouter.post(
    '/',
    asyncRoute(async (req, res) => {
        const { note } = parse(reflectionBody, req.body);
        const r = await db.goals.writeReflection(uid(req), note);
        res.json({ success: true, ...r, newAchievements: r.achievements });
    })
);

goalRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        res.json(await db.goals.getGoal(uid(req)));
    })
);

goalRouter.put(
    '/',
    asyncRoute(async (req, res) => {
        const { target } = parse(goalBody, req.body);
        res.json({ success: true, ...(await db.goals.setGoal(uid(req), target)) });
    })
);

goalRouter.post(
    '/claim',
    asyncRoute(async (req, res) => {
        const r = await db.goals.claimGoal(uid(req));
        res.json({ success: true, ...r, newAchievements: r.achievements });
    })
);
