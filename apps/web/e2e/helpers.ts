import crypto from 'node:crypto';
import { test as base, expect, type Browser, type BrowserContext } from '@playwright/test';
// @ts-expect-error plain ESM shared with the config and seed script
import { BASE_URL, COOKIE_NAME, PLAYERS, SESSION_ID, SESSION_SECRET } from './env.mjs';

/** express-session's signed cookie value for a session id (what `cookie-signature` produces). */
export function signedSessionCookie(sessionId: string = SESSION_ID): string {
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(sessionId).digest('base64').replace(/=+$/, '');
    return `s:${sessionId}.${sig}`;
}

/** A separate browser context signed in as one of the extra seeded players (for tests where two people interact). */
export async function playerContext(browser: Browser, who: keyof typeof PLAYERS): Promise<BrowserContext> {
    const context = await browser.newContext({ baseURL: BASE_URL });
    await context.addCookies([
        { name: COOKIE_NAME, value: encodeURIComponent(signedSessionCookie(PLAYERS[who].sessionId)), url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
    ]);
    await context.addInitScript(() => {
        try {
            window.localStorage.setItem('tq.tourSeen', '1');
        } catch {
            /* storage unavailable */
        }
    });
    return context;
}

/** A name that is unique per run, so retried tests never collide with rows they created earlier. */
export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

type Options = { loggedIn: boolean };

/**
 * `test` starts every test logged in as the seeded player with the first-run tour already dismissed.
 * Use `test.use({ loggedIn: false })` for the anonymous experience.
 */
export const test = base.extend<Options>({
    loggedIn: [true, { option: true }],
    context: async ({ context, loggedIn }, use) => {
        if (loggedIn) {
            await context.addCookies([
                { name: COOKIE_NAME, value: encodeURIComponent(signedSessionCookie()), url: BASE_URL, httpOnly: true, sameSite: 'Lax' },
            ]);
        }
        // The welcome tour is a floating card that would cover parts of the page.
        await context.addInitScript(() => {
            try {
                window.localStorage.setItem('tq.tourSeen', '1');
            } catch {
                /* storage unavailable */
            }
        });
        await use(context);
    },
});

export { expect };
