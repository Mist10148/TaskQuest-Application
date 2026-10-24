/** Discord OAuth2 login (authorization code flow, `identify` scope only). */

import crypto from 'crypto';
import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
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
    // A visitor who is not logged in only needs this session until the round trip to Discord is done (the callback starts a fresh one),
    // so an anonymous request cannot leave a seven day row behind. originalMaxAge too, or the rolling cookie would restore the long life.
    if (!req.session.user) req.session.cookie.originalMaxAge = req.session.cookie.maxAge = 10 * 60 * 1000;
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

        // A timeout or network error talking to Discord should land the user
        // back on the login page with a message, not on a raw JSON 500.
        let me;
        try {
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
            me = await meRes.json();
        } catch (err) {
            console.warn(`Discord login request failed: ${err.message}`);
            return loginError(res, 'token_failed');
        }
        if (!/^\d{5,25}$/.test(String(me?.id))) return loginError(res, 'profile_failed');

        try {
            await db.users.ensureUser(me.id, { username: me.global_name || me.username, handle: me.username, avatar: me.avatar });
        } catch (err) {
            // A browser navigation: send the person back to the login page, not to a JSON error.
            console.error(`Could not save the user on login: ${err.message}`);
            return loginError(res, 'session_failed');
        }

        // New session ID on login prevents session fixation.
        req.session.regenerate((err) => {
            if (err) return loginError(res, 'session_failed');
            req.session.user = {
                discordId: String(me.id),
                username: me.username,
                globalName: me.global_name || null,
                avatar: me.avatar || null
            };
            req.session.save((saveErr) => {
                if (saveErr) return loginError(res, 'session_failed');
                res.redirect(`${config.publicUrl}/dashboard`);
            });
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
        res.json({
            discord: req.session.user,
            ...stats,
            skills,
            freezeLimits: shared.getFreezeLimits(skills),
            userAchievements: achievements,
            // ai: usable now; aiAvailable: the server offers AI at all (so Settings can show the opt-out switch)
            features: { ai: config.ai.enabled && stats.user.ai_enabled !== 0, aiAvailable: config.ai.enabled }
        });
    })
);

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie(req.app.get('sessionCookieName'), { path: '/' });
        res.json({ success: true });
    });
});

export default router;
