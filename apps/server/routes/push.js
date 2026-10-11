/**
 * Web push: the browser side (config, subscribe, unsubscribe) and the token-protected internal endpoint
 * the bot calls to push a reminder. All of it answers 404 when VAPID keys are not configured.
 */

import crypto from 'crypto';
import { Router } from 'express';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import config from '../config.js';
import { asyncRoute, parse, uid } from '../lib/http.js';
import { getPushService } from '../lib/push.js';
import { subscribeBody, unsubscribeBody, internalPushBody } from '../lib/schemas.js';

const { errors } = shared;

/** Public: whether push is on and the key the browser subscribes with (it is a public key). */
export function pushConfig(req, res) {
    res.json(config.push.enabled ? { enabled: true, publicKey: config.push.publicKey } : { enabled: false });
}

function requirePushEnabled(req, res, next) {
    if (!config.push.enabled) throw errors.notFound('Push notifications are not enabled on this server.');
    next();
}

export const pushRouter = Router();

pushRouter.post(
    '/subscribe',
    requirePushEnabled,
    asyncRoute(async (req, res) => {
        const { subscription } = parse(subscribeBody, req.body);
        const { count } = await db.push.addSubscription(uid(req), subscription);
        res.status(201).json({ success: true, subscriptions: count });
    })
);

pushRouter.delete(
    '/subscribe',
    asyncRoute(async (req, res) => {
        const { endpoint } = parse(unsubscribeBody, req.body);
        res.json({ success: true, removed: await db.push.removeSubscription(uid(req), endpoint) });
    })
);

/** Constant-time check of the shared secret (header X-AI-Token, like the other internal routes). 404s unless push and a token are configured. */
export function requirePushToken(req, res, next) {
    const expected = config.push.enabled ? config.push.internalToken : '';
    if (!expected) return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    const given = Buffer.from(String(req.get('x-ai-token') || ''));
    const want = Buffer.from(expected);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(401).json({ error: 'Invalid token', code: 'UNAUTHENTICATED' });
    next();
}

export const internalPushRouter = Router();

internalPushRouter.post(
    '/',
    asyncRoute(async (req, res) => {
        const { discordId, title, body, url } = parse(internalPushBody, req.body);
        res.json(await getPushService().send(discordId, { title, body, url }));
    })
);
