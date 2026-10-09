/** Profile, settings, daily reward, XP history and progress reset. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { settingsBody, resetBody } from '../lib/schemas.js';
import aiClient from '../lib/aiClient.js';

const router = Router();

router.get(
    '/',
    asyncRoute(async (req, res) => {
        const [stats, skills] = await Promise.all([db.users.getUserStats(uid(req)), db.users.getUserSkills(uid(req))]);
        res.json({ ...stats, skills });
    })
);

router.patch(
    '/',
    asyncRoute(async (req, res) => {
        const body = parse(settingsBody, req.body);
        const result = await db.users.updateSettings(uid(req), body);
        // Opting out deletes the user's vectors now; opting back in rebuilds them.
        if (body.ai_enabled !== undefined) aiClient.syncUser(uid(req));
        res.json(result);
    })
);

router.post(
    '/daily',
    asyncRoute(async (req, res) => {
        const r = await db.progression.claimDaily(uid(req));
        if (!r.claimed) {
            return res.json({ success: false, error: 'Already claimed', remaining: r.remainingMs, streak: r.streak });
        }
        res.json({
            success: true,
            baseXP: r.baseXP,
            classBonus: r.classBonus,
            streakBonus: r.streakBonus,
            skillDailyBonus: r.skillDailyBonus,
            totalXP: r.totalXP,
            bonusInfo: r.bonusInfo,
            streak: r.streak,
            streakBroken: r.streakBroken,
            streakPreserved: r.streakPreserved,
            newBalance: r.balance,
            newLevel: r.level,
            leveledUp: r.leveledUp,
            newAchievements: r.achievements
        });
    })
);

router.get(
    '/xp-history',
    asyncRoute(async (req, res) => {
        res.json(await db.users.getXPHistory(uid(req), 50));
    })
);

// Destructive: requires {"confirm":"RESET"} in the body.
router.post(
    '/reset',
    asyncRoute(async (req, res) => {
        parse(resetBody, req.body);
        await db.users.resetProgress(uid(req));
        res.json({ success: true, message: 'All progress has been reset' });
    })
);

export default router;
