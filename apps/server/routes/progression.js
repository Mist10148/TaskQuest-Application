/** Classes, skills, achievements and the public leaderboard. */

import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import { asyncRoute, parse, requireAuth, uid, avatarUrl } from '../lib/http.js';
import { keyParam, skillParam, leaderboardQuery, previewQuery, respecBody } from '../lib/schemas.js';
import { sealId, openId } from '../lib/avatarProxy.js';
import { coalesce } from '../lib/coalesce.js';
import { heavyLimiter } from '../lib/security.js';

const { CLASSES, SKILL_TREES, ACHIEVEMENTS, classOwnershipColumn, simulateAverage, FAVOURABLE } = shared;

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

/**
 * "What would I earn?" for a class: the average XP of a 10 base XP task (five a day on a 7 day streak) with no skills, with
 * the player's own skills of this class and the Default tree, and with the whole class tree. A simulation of the real rules.
 */
classesRouter.get(
    '/:key/preview',
    heavyLimiter,
    asyncRoute(async (req, res) => {
        const { key: raw } = parse(keyParam, req.params);
        const key = String(raw).toUpperCase();
        if (!CLASSES[key]) return res.status(404).json({ error: 'No such class.', code: 'NOT_FOUND' });
        const q = parse(previewQuery, req.query);
        const user = await db.users.ensureUser(uid(req));
        const level = q.level || Number(user.player_level) || 1;
        const mix = q.mix || FAVOURABLE[key] || 'plain';
        const mine = (await db.users.getUserSkills(uid(req))).filter((s) => SKILL_TREES.DEFAULT.skills[s.skill_id] || SKILL_TREES[key]?.skills[s.skill_id]);
        const full = Object.entries(SKILL_TREES[key]?.skills || {}).map(([id, s]) => ({ skill_id: id, skill_level: s.maxLevel }));
        const avg = (skills) => Math.round(simulateAverage(key, skills, { level, mix }) * 10) / 10;
        res.json({ classKey: key, level, mix, base: 10, noSkills: avg([]), yourSkills: avg(mine), fullTree: avg(full) });
    })
);

classesRouter.post(
    '/:key/buy',
    asyncRoute(async (req, res) => {
        const { key } = parse(keyParam, req.params);
        const r = await db.progression.buyClass(uid(req), key);
        res.json({ success: true, user: db.users.publicUser(r.user), newAchievements: r.achievements });
    })
);

classesRouter.post(
    '/:key/equip',
    asyncRoute(async (req, res) => {
        const { key } = parse(keyParam, req.params);
        const r = await db.progression.equipClass(uid(req), key);
        res.json({ success: true, user: db.users.publicUser(r.user) });
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
            userXP: Number(user.player_xp),
            playerClass: user.player_class
        });
    })
);

const PREVIEW_CACHE_MS = 10 * 60 * 1000;
const PREVIEW_CACHE_MAX = 500;
const previewCache = new Map(); // key (class, level, mix, owned skills) -> { body, expires }

/**
 * What each skill's next level would add to the average XP of a task, for the class you have equipped at your level
 * (a simulation of the real rules; `gain` is XP per 10 base XP task, 0 for a skill that does nothing for your class).
 */
skillsRouter.get(
    '/preview',
    heavyLimiter,
    asyncRoute(async (req, res) => {
        const q = parse(previewQuery, req.query);
        const user = await db.users.ensureUser(uid(req));
        const cls = user.player_class;
        const level = q.level || Number(user.player_level) || 1;
        const mix = q.mix || FAVOURABLE[cls] || 'plain';
        const rows = await db.users.getUserSkills(uid(req));
        const levels = new Map(rows.map((s) => [s.skill_id, Number(s.skill_level)]));
        // The simulation is ~0.3 s of CPU for the whole catalogue, so identical inputs share one result for a while.
        const cacheKey = `${cls}|${level}|${mix}|${[...levels].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, n]) => `${id}:${n}`).join(',')}`;
        const cached = previewCache.get(cacheKey);
        if (cached && cached.expires > Date.now()) return res.json(cached.body);
        const asRows = (m) => [...m].map(([skill_id, skill_level]) => ({ skill_id, skill_level }));
        const avg = (m) => simulateAverage(cls, asRows(m), { level, mix });
        const base = avg(levels);
        const gains = {};
        for (const tree of Object.values(SKILL_TREES)) {
            for (const [id, skill] of Object.entries(tree.skills)) {
                const have = levels.get(id) || 0;
                if (have >= skill.maxLevel) continue;
                const next = new Map(levels).set(id, have + 1);
                gains[id] = Math.round((avg(next) - base) * 10) / 10;
            }
        }
        const body = { classKey: cls, level, mix, base: 10, average: Math.round(base * 10) / 10, gains };
        if (previewCache.size >= PREVIEW_CACHE_MAX) previewCache.clear();
        previewCache.set(cacheKey, { body, expires: Date.now() + PREVIEW_CACHE_MS });
        res.json(body);
    })
);

/** Unlearn a whole tree for a partial refund (once a day). */
skillsRouter.post(
    '/respec',
    asyncRoute(async (req, res) => {
        const { classKey } = parse(respecBody, req.body);
        res.json({ success: true, ...(await db.progression.respecSkills(uid(req), classKey)) });
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
const boardInflight = new Map(); // the same keys, while a query for them is running

/** Forget every cached board (tests read the board right after changing a player's standing). */
export function clearBoardCache() {
    boardCache.clear();
    rankCache.clear();
}

const RANK_TTL_MS = 10_000;
const RANK_CACHE_MAX = 2000;
const rankCache = new Map(); // `${user}:${by}:${class}` -> { at, rank }
const rankInflight = new Map();

/** The ranking queries are heavy and the route is anonymous, so share one result per board for a short while. */
async function cachedBoard(by, playerClass) {
    const cacheKey = `${by}:${playerClass || ''}`;
    const hit = boardCache.get(cacheKey);
    if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.rows;
    return coalesce(boardInflight, cacheKey, async () => {
        const rows = await db.users.getLeaderboard(10, { by, playerClass });
        boardCache.set(cacheKey, { at: Date.now(), rows });
        return rows;
    });
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
        // Ranking runs correlated subqueries over every player, so a user polling this route shares one answer for a few seconds.
        const key = `${uid(req)}:${by}:${playerClass || ''}`;
        const hit = rankCache.get(key);
        if (hit && Date.now() - hit.at < RANK_TTL_MS) return res.json({ rank: hit.rank });
        const rank = await coalesce(rankInflight, key, async () => {
            const value = await db.users.getRank(uid(req), by, { playerClass });
            if (rankCache.size >= RANK_CACHE_MAX) rankCache.clear();
            rankCache.set(key, { at: Date.now(), rank: value });
            return value;
        });
        res.json({ rank });
    })
);
