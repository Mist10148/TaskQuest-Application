/** Profile, settings, daily reward, XP history and progress reset. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { settingsBody, resetBody } from '../lib/schemas.js';
import aiClient from '../lib/aiClient.js';

const router = Router();

router.get(
    '/',
    asyncRoute(async (req, res) => {
        const [stats, skills] = await Promise.all([db.users.getUserStats(uid(req)), db.users.getUserSkills(uid(req))]);
        res.json({ ...stats, skills, freezeLimits: shared.getFreezeLimits(skills) });
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
            surpriseBonus: r.surpriseBonus,
            chest: r.chest,
            totalXP: r.totalXP,
            bonusInfo: r.bonusInfo,
            streak: r.streak,
            streakBroken: r.streakBroken,
            streakPreserved: r.streakPreserved,
            freezeUsed: r.freezeUsed,
            newBalance: r.balance,
            newLevel: r.level,
            leveledUp: r.leveledUp,
            newAchievements: r.achievements
        });
    })
);

router.post(
    '/streak-freeze',
    asyncRoute(async (req, res) => {
        const r = await db.progression.buyStreakFreeze(uid(req));
        res.json({ success: true, freezes: r.freezes, cost: r.cost, max: r.max, newBalance: r.balance, newAchievements: r.achievements });
    })
);

// ── Data portability ────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

router.get(
    '/export',
    asyncRoute(async (req, res) => {
        const data = await db.transfer.exportAll(uid(req));
        res.set('Content-Disposition', `attachment; filename="taskquest-export-${today()}.json"`);
        res.json(data);
    })
);

router.get(
    '/export.csv',
    asyncRoute(async (req, res) => {
        const csv = db.transfer.toCsv(await db.transfer.exportAll(uid(req)));
        res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="taskquest-tasks-${today()}.csv"` });
        res.send(csv);
    })
);

// Imports are reward-free (no XP, counters or achievements) and all-or-nothing.
router.post(
    '/import',
    asyncRoute(async (req, res) => {
        const result = await db.transfer.importAll(uid(req), req.body);
        aiClient.syncUser(uid(req));
        res.status(201).json({ success: true, ...result });
    })
);

// The feed token is a secret, so the profile never includes it; Settings asks for it here.
router.get(
    '/calendar-token',
    asyncRoute(async (req, res) => {
        const stats = await db.transfer.getCalendarToken(uid(req));
        res.json({ token: stats });
    })
);

router.post(
    '/calendar-token',
    asyncRoute(async (req, res) => {
        res.json({ token: await db.transfer.regenerateCalendarToken(uid(req)) });
    })
);

router.delete(
    '/calendar-token',
    asyncRoute(async (req, res) => {
        await db.transfer.clearCalendarToken(uid(req));
        res.json({ success: true });
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
        // Deleted quests must not stay searchable: purge vectors, chat threads and summaries too.
        aiClient.forgetUser(uid(req));
        res.json({ success: true, message: 'All progress has been reset' });
    })
);

export default router;
