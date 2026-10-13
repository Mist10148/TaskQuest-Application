/** Classes, skills, achievements and the public leaderboard. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import { asyncRoute, parse, requireAuth, uid, avatarUrl } from '../lib/http.js';
import { keyParam, skillParam, leaderboardQuery } from '../lib/schemas.js';
import { sealId, openId } from '../lib/avatarProxy.js';

const { CLASSES, SKILL_TREES, ACHIEVEMENTS, classOwnershipColumn } = shared;

export const classesRouter = Router();
export const skillsRouter = Router();
export const achievementsRouter = Router();
export const leaderboardRouter = Router();

const owns = (user, key) => key === 'DEFAULT' || Boolean(user[classOwnershipColumn(key)]);

classesRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        const user = await db.users.ensureUser(uid(req));
        res.json({
            classes: Object.entries(CLASSES).map(([key, c]) => ({ key, ...c, owned: owns(user, key), equipped: user.player_class === key })),
            currentClass: user.player_class,
            playerXP: Number(user.player_xp)
        });
    })
);

classesRouter.post(
    '/:key/buy',
    asyncRoute(async (req, res) => {
        const { key } = parse(keyParam, req.params);
        const r = await db.progression.buyClass(uid(req), key);
        res.json({ success: true, user: r.user, newAchievements: r.achievements });
    })
);

classesRouter.post(
    '/:key/equip',
    asyncRoute(async (req, res) => {
        const { key } = parse(keyParam, req.params);
        const r = await db.progression.equipClass(uid(req), key);
        res.json({ success: true, user: r.user });
    })
);

skillsRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        const user = await db.users.ensureUser(uid(req));
        const levels = new Map((await db.users.getUserSkills(uid(req))).map((s) => [s.skill_id, Number(s.skill_level)]));
        res.json({
            skillTrees: Object.entries(SKILL_TREES).map(([classKey, tree]) => ({
                classKey,
                ...tree,
                classOwned: owns(user, classKey),
                skills: Object.entries(tree.skills).map(([id, skill]) => ({ id, ...skill, currentLevel: levels.get(id) || 0 }))
            })),
            skillPoints: Number(user.skill_points) || 0,
            userXP: Number(user.player_xp),
            playerClass: user.player_class
        });
    })
);

// The skill's tree is derived server-side; any `classKey` in the body is ignored.
skillsRouter.post(
    '/:skillId/unlock',
    asyncRoute(async (req, res) => {
        const { skillId } = parse(skillParam, req.params);
        const r = await db.progression.unlockSkill(uid(req), skillId);
        res.json({ success: true, skill: { skill_id: r.skillId, skill_level: r.level }, balance: r.balance });
    })
);

achievementsRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        const unlocked = new Map((await db.users.getAchievements(uid(req))).map((a) => [a.achievement_key, a.unlocked_at]));
        res.json({
            achievements: Object.entries(ACHIEVEMENTS).map(([key, a]) => ({
                key,
                ...a,
                unlocked: unlocked.has(key),
                unlockedAt: unlocked.get(key) || null
            })),
            unlockedCount: [...unlocked.keys()].filter((k) => k in ACHIEVEMENTS).length,
            totalCount: Object.keys(ACHIEVEMENTS).length
        });
    })
);

const BOARD_TTL_MS = 30_000;
const boardCache = new Map(); // `${by}:${class}` -> { at, rows }

/** The ranking queries are heavy and the route is anonymous, so share one result per board for a short while. */
async function cachedBoard(by, playerClass) {
    const cacheKey = `${by}:${playerClass || ''}`;
    const hit = boardCache.get(cacheKey);
    if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.rows;
    const rows = await db.users.getLeaderboard(10, { by, playerClass });
    boardCache.set(cacheKey, { at: Date.now(), rows });
    return rows;
}

// Public, but only exposes display data. No Discord IDs: avatars go through an opaque token.
leaderboardRouter.get(
    '/',
    asyncRoute(async (req, res) => {
        const { by, class: playerClass } = parse(leaderboardQuery, req.query);
        const rows = await cachedBoard(by, playerClass);
        const me = req.session?.user?.discordId;
        res.json(
            rows.map((r) => ({
                rank: r.rank,
                username: r.discord_username || 'Adventurer',
                avatarUrl: avatarUrl(r.discord_id, r.discord_avatar) ? `/api/leaderboard/avatar/${sealId(r.discord_id)}` : null,
                xp: Number(r.player_xp),
                lifetimeXp: Number(r.lifetime_xp_total),
                prestige: Number(r.prestige),
                prestigeTitle: shared.prestigeTitle(r.prestige),
                score: r.score,
                level: Number(r.player_level),
                playerClass: r.player_class,
                cosmetics: shared.describeEquipped(r),
                streak: Number(r.streak_count),
                gamesPlayed: r.games_played,
                tasksCompleted: Number(r.total_items_completed),
                isYou: Boolean(me && me === r.discord_id)
            }))
        );
    })
);

// Serves a leaderboard avatar without revealing whose Discord ID it belongs to.
leaderboardRouter.get(
    '/avatar/:token',
    asyncRoute(async (req, res) => {
        const id = openId(req.params.token);
        const user = id ? await db.users.getUser(id) : null;
        const url = user && avatarUrl(id, user.discord_avatar);
        if (!url) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
        let upstream;
        try {
            upstream = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        } catch {
            return res.status(502).json({ error: 'Avatar unavailable', code: 'UPSTREAM' });
        }
        const type = upstream.headers.get('content-type') || '';
        if (!upstream.ok || !/^image\/(png|gif|webp|jpeg)$/.test(type)) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
        res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
        res.send(Buffer.from(await upstream.arrayBuffer()));
    })
);

leaderboardRouter.get(
    '/me',
    requireAuth,
    asyncRoute(async (req, res) => {
        const { by, class: playerClass } = parse(leaderboardQuery, req.query);
        res.json({ rank: await db.users.getRank(uid(req), by, { playerClass }) });
    })
);
