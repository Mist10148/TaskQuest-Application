/**
 * Settings shared by the Playwright config, the seed script and the test helpers.
 * Override the database through E2E_DB_* (the target database is WIPED by seed.mjs, so use a throwaway one).
 */

const e = process.env;

export const PORT = Number(e.E2E_PORT || 3101);
export const BASE_URL = `http://localhost:${PORT}`;

export const DB = {
    DB_URL: '',
    DB_HOST: e.E2E_DB_HOST || '127.0.0.1',
    DB_PORT: e.E2E_DB_PORT || '3306',
    DB_USER: e.E2E_DB_USER || 'root',
    DB_PASSWORD: e.E2E_DB_PASSWORD ?? '',
    DB_NAME: e.E2E_DB_NAME || 'taskquest_e2e',
};

/** Not a secret: it only signs cookies for the throwaway test database. */
export const SESSION_SECRET = 'e2e-session-secret-'.padEnd(48, 'x');

export const COOKIE_NAME = 'tq.sid';
export const USER_ID = '900000000000000001';
export const SESSION_ID = 'e2e00000000000000000000000000001';

/**
 * Two more players for the shared-list specs, so the first player's XP (which the shop and class specs depend on) is never
 * touched: a "captain" who owns shared quests and an "ally" who is invited to them. `username` is both the stored display name
 * and the Discord username an invitation is addressed to.
 */
export const PLAYERS = {
    captain: { id: '900000000000000002', sessionId: 'e2e00000000000000000000000000002', username: 'e2e_captain', globalName: 'E2E Captain' },
    ally: { id: '900000000000000003', sessionId: 'e2e00000000000000000000000000003', username: 'e2e_ally', globalName: 'E2E Ally' },
};

/** Environment for the API server (also read by seed.mjs, which uses the same database). */
export const SERVER_ENV = {
    ...DB,
    NODE_ENV: 'development',
    SERVER_PORT: String(PORT),
    PUBLIC_URL: BASE_URL,
    SERVE_FRONTEND: 'true',
    SESSION_SECRET,
    DISCORD_CLIENT_ID: 'e2e',
    DISCORD_CLIENT_SECRET: 'e2e',
    AI_ENABLED: 'false',
};
