/** Discord OAuth2 login (authorization code flow, `identify` scope only). */

import crypto from 'crypto';
import { Router } from 'express';
import db from '@taskquest/shared/db';
import config from '../config.js';
import { asyncRoute, requireAuth, uid } from '../lib/http.js';

const router = Router();
const DISCORD_API = 'https://discord.com/api/v10';

function loginError(res, reason) {
    res.redirect(`${config.publicUrl}/?error=${encodeURIComponent(reason)}`);
}

function safeEqual(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Step 1: redirect to Discord with an unguessable `state` bound to this session.
router.get('/discord', (req, res, next) => {
    const state = crypto.randomBytes(32).toString('base64url');
    req.session.oauthState = state;
    req.session.save((err) => {
        if (err) return next(err);
        const params = new URLSearchParams({
            client_id: config.discord.clientId,
            redirect_uri: config.discord.redirectUri,
            response_type: 'code',
            scope: 'identify',
            state,
            prompt: 'none'
        });
        res.redirect(`https://discord.com/oauth2/authorize?${params}`);
    });
});

// Step 2: Discord redirects back with ?code&state.
router.get(
    '/callback',
    asyncRoute(async (req, res) => {
        const { code, state, error } = req.query;
        const expected = req.session.oauthState;
        delete req.session.oauthState;

        if (error) return loginError(res, 'access_denied');
        if (typeof code !== 'string' || typeof state !== 'string' || !expected || !safeEqual(state, expected)) {
            return loginError(res, 'invalid_state');
        }

        const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: config.discord.clientId,
                client_secret: config.discord.clientSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: config.discord.redirectUri
            }),
            signal: AbortSignal.timeout(10_000)
        });
        if (!tokenRes.ok) {
            console.warn(`Discord token exchange failed with HTTP ${tokenRes.status}`);
            return loginError(res, 'token_failed');
        }
        const tokens = await tokenRes.json();

        const meRes = await fetch(`${DISCORD_API}/users/@me`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
            signal: AbortSignal.timeout(10_000)
        });
        if (!meRes.ok) return loginError(res, 'profile_failed');
        const me = await meRes.json();
        if (!/^\d{5,25}$/.test(String(me.id))) return loginError(res, 'profile_failed');

        await db.users.ensureUser(me.id, { username: me.global_name || me.username, avatar: me.avatar });

        // New session ID on login prevents session fixation.
        req.session.regenerate((err) => {
            if (err) return loginError(res, 'session_failed');
            req.session.user = {
                discordId: String(me.id),
                username: me.username,
                globalName: me.global_name || null,
                avatar: me.avatar || null
            };
            req.session.save(() => res.redirect(`${config.publicUrl}/dashboard`));
        });
    })
);

router.get(
    '/me',
    requireAuth,
    asyncRoute(async (req, res) => {
        const id = uid(req);
        const [stats, skills, achievements] = await Promise.all([
            db.users.getUserStats(id),
            db.users.getUserSkills(id),
            db.users.getAchievements(id)
        ]);
        if (!stats) return res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' });
        res.json({ discord: req.session.user, ...stats, skills, userAchievements: achievements });
    })
);

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie(req.app.get('sessionCookieName'), { path: '/' });
        res.json({ success: true });
    });
});

export default router;
