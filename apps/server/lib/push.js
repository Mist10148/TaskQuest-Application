/**
 * Sending web pushes. The sender and the subscription store are injected, so the logic (who gets a push,
 * what it says, which dead subscriptions are pruned) is tested without the network or a database.
 * Off unless VAPID keys are configured (config.push.enabled).
 */

import webpush from 'web-push';
import db from '@taskquest/shared/db';
import shared from '@taskquest/shared';
import config from '../config.js';
export { pushConfigProblems } from './pushConfig.js';

const { buildPayload } = shared.push;

/** The push service says the subscription is gone for good. */
const isGone = (err) => err?.statusCode === 404 || err?.statusCode === 410;

/**
 * @param {object} deps
 * @param {(subscription: object, payload: string, options: object) => Promise<unknown>} deps.sender  web-push's sendNotification
 * @param {{ list(discordId: string): Promise<object[]>, remove(id: number): Promise<void>, touch(id: number): Promise<void> }} deps.store
 * @param {(discordId: string) => Promise<boolean>} [deps.wantsPush]  the user's web_push preference (default: yes)
 */
export function createPushService({ sender, store, wantsPush = async () => true }) {
    return {
        /**
         * Send one notification to every browser the user subscribed. A 404 or 410 from the push service
         * removes that subscription; any other failure keeps it (it may be a passing outage).
         * @returns {Promise<{ sent: number, pruned: number, failed: number, skipped?: string }>}
         */
        async send(discordId, message) {
            const result = { sent: 0, pruned: 0, failed: 0 };
            if (!(await wantsPush(discordId))) return { ...result, skipped: 'opted-out' };
            const subscriptions = await store.list(discordId);
            if (!subscriptions.length) return { ...result, skipped: 'no-subscriptions' };
            const payload = JSON.stringify(buildPayload(message));
            await Promise.all(
                subscriptions.map(async (sub) => {
                    try {
                        await sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 24 * 60 * 60, urgency: 'normal' });
                        result.sent++;
                        await store.touch(sub.id).catch(() => {});
                    } catch (err) {
                        if (isGone(err)) {
                            result.pruned++;
                            await store.remove(sub.id).catch(() => {});
                        } else {
                            result.failed++;
                        }
                    }
                })
            );
            return result;
        }
    };
}

let service;

/** Tests swap in a service with a mocked sender (or null to reset). */
export function setPushService(replacement) {
    service = replacement ?? undefined;
}

/** The real service (web-push, the database), or null when push is not configured. */
export function getPushService() {
    if (!config.push.enabled) return null;
    if (!service) {
        webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
        service = createPushService({
            sender: (subscription, payload, options) => webpush.sendNotification(subscription, payload, options),
            store: { list: (id) => db.push.listSubscriptions(id), remove: (id) => db.push.deleteSubscriptionById(id), touch: (id) => db.push.touchSubscription(id) },
            wantsPush: async (id) => {
                const user = await db.users.getUser(id);
                return !user || Boolean(user.web_push);
            }
        });
    }
    return service;
}
