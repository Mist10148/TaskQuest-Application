/**
 * Web push rules with no I/O: validating a browser's subscription and building the notification payload.
 * The server sends (apps/server/lib/push.js); the bot only asks it to, through ./client.js.
 */

'use strict';

const crypto = require('crypto');
const net = require('net');
const { errors } = require('../errors');

const PUSH = {
    /** A user can have this many subscribed browsers. */
    MAX_SUBSCRIPTIONS: 10,
    MAX_ENDPOINT_LENGTH: 2048,
    MAX_TITLE: 100,
    MAX_BODY: 300,
    MAX_URL: 200
};

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Byte length of a base64url string, or -1 when it is not base64url. */
function base64urlBytes(value) {
    if (typeof value !== 'string' || !value || value.length > 200 || !BASE64URL.test(value)) return -1;
    return Buffer.from(value, 'base64url').length;
}

/**
 * Check a PushSubscription as the browser serialised it ({ endpoint, keys: { p256dh, auth } }) and return
 * only the fields we store. The endpoint must be an https URL without credentials, at most 2048 chars;
 * p256dh must be a 65-byte P-256 point and auth a 16-byte secret, both base64url.
 * @throws TaskQuestError (VALIDATION)
 */
function validateSubscription(sub) {
    const endpoint = sub && typeof sub === 'object' ? sub.endpoint : undefined;
    if (typeof endpoint !== 'string' || !endpoint || endpoint.length > PUSH.MAX_ENDPOINT_LENGTH) throw errors.validation('Invalid push subscription endpoint.');
    let url;
    try {
        url = new URL(endpoint);
    } catch {
        throw errors.validation('Invalid push subscription endpoint.');
    }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw errors.validation('The push endpoint must be an https URL.');
    // The server POSTs to this URL, so it must be a public DNS name (real push services are): never an IP literal, localhost or an internal name.
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (net.isIP(host) || !host.includes('.') || /(^|\.)(localhost|local|internal|localdomain)$/.test(host)) throw errors.validation('The push endpoint must be a public https URL.');
    const keys = sub.keys && typeof sub.keys === 'object' ? sub.keys : {};
    if (base64urlBytes(keys.p256dh) !== 65 || base64urlBytes(keys.auth) !== 16) throw errors.validation('Invalid push subscription keys.');
    return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/** SHA-256 hex of an endpoint: what the database indexes (the endpoint itself is too long to). */
const endpointHash = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex');

/** The JSON a notification carries. Text is clipped; the url must be a path on our own origin ('/tasks'), else '/'. */
function buildPayload({ title, body, url } = {}) {
    const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
    const path = typeof url === 'string' && /^\/(?!\/)[^\s\\]*$/.test(url) && url.length <= PUSH.MAX_URL ? url : '/';
    return { title: clip(title, PUSH.MAX_TITLE) || 'TaskQuest', body: clip(body, PUSH.MAX_BODY), url: path };
}

module.exports = { PUSH, validateSubscription, endpointHash, buildPayload, base64urlBytes };
