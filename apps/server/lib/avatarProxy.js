/**
 * Opaque avatar tokens for the public leaderboard. A Discord CDN avatar URL
 * contains the user's Discord ID, which the leaderboard promises never to
 * expose, so rows carry a token instead and /api/leaderboard/avatar/:token
 * fetches the image server-side. The token is the ID sealed with AES-256-GCM
 * under a key derived from the session secret, so it can't be reversed or
 * forged by a client.
 */

import crypto from 'crypto';
import config from '../config.js';

const key = () => crypto.createHash('sha256').update(`avatar-token:${config.sessionSecret}`).digest();

/**
 * The token for an ID is stable: the IV is derived from the ID itself (a keyed hash), so the same player always gets the same URL and
 * browsers and CDNs can cache the image. Reusing an IV is only unsafe for different plaintexts; here the plaintext is the same too.
 */
export function sealId(discordId) {
    const iv = crypto.createHmac('sha256', key()).update(`iv:${discordId}`).digest().subarray(0, 12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const body = Buffer.concat([cipher.update(String(discordId), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** @returns {string|null} the Discord ID, or null for a malformed or forged token */
export function openId(token) {
    try {
        const raw = Buffer.from(String(token), 'base64url');
        if (raw.length < 29) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        const id = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
        return /^\d{5,25}$/.test(id) ? id : null;
    } catch {
        return null;
    }
}
