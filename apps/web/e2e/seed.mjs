/**
 * Resets the e2e database and seeds one player, a few quests and a logged-in session.
 *
 *   node e2e/seed.mjs        (WIPES every table in E2E_DB_NAME, default taskquest_e2e)
 *
 * No real Discord login is involved: the session row is written straight into
 * web_sessions, exactly where the server's own session store keeps it, and tests present
 * the matching signed cookie (see helpers.ts). Production code has no test login route.
 */

import { SERVER_ENV, USER_ID, SESSION_ID, PLAYERS } from './env.mjs';

Object.assign(process.env, SERVER_ENV);

const { default: db } = await import('@taskquest/shared/db');

try {
    const pool = db.getPool();
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public');
    await db.runMigrations({ log: () => {} });

    await db.users.ensureUser(USER_ID, { username: 'e2e_hero', avatar: null });
    const chores = (await db.tasks.createList(USER_ID, { name: 'Seed chores', priority: 'HIGH' })).list;
    await db.tasks.addItem(USER_ID, chores.id, { name: 'Water the plants' });
    await db.tasks.addItem(USER_ID, chores.id, { name: 'Take out the bin' });
    await db.tasks.createList(USER_ID, { name: 'Seed reading' });

    // Fixed balance regardless of what creating the lists paid: level 4, enough for the 300 XP
    // class but not the 400+ XP ones, so the shop shows both an affordable and a locked class.
    await db.query('UPDATE users SET player_xp = 350, lifetime_xp = 350, player_level = 4 WHERE discord_id = ?', [USER_ID]);

    const data = JSON.stringify({
        cookie: { path: '/', httpOnly: true, originalMaxAge: 86_400_000 },
        user: { discordId: USER_ID, username: 'e2e_hero', globalName: 'E2E Hero', avatar: null },
    });
    await db.query('INSERT INTO web_sessions (session_id, expires, data) VALUES (?, ?, ?)', [
        SESSION_ID,
        Math.floor(Date.now() / 1000) + 86_400,
        data,
    ]);
    // Two more players for the shared-list specs. The captain owns "Viewer board" and has already invited the ally to it as
    // a viewer (accepted), so the read-only experience can be checked without any setup in the test itself.
    for (const p of Object.values(PLAYERS)) {
        await db.users.ensureUser(p.id, { username: p.username, handle: p.username, avatar: null });
        await db.query('INSERT INTO web_sessions (session_id, expires, data) VALUES (?, ?, ?)', [
            p.sessionId,
            Math.floor(Date.now() / 1000) + 86_400,
            JSON.stringify({
                cookie: { path: '/', httpOnly: true, originalMaxAge: 86_400_000 },
                user: { discordId: p.id, username: p.username, globalName: p.globalName, avatar: null },
            }),
        ]);
    }
    const board = (await db.tasks.createList(PLAYERS.captain.id, { name: 'Viewer board' })).list;
    await db.tasks.addItem(PLAYERS.captain.id, board.id, { name: 'Read only task' });
    const invitation = await db.sharing.invite(PLAYERS.captain.id, board.id, { username: PLAYERS.ally.username, role: 'viewer' });
    await db.sharing.respond(PLAYERS.ally.id, invitation.id, true);

    console.log(`e2e: seeded ${SERVER_ENV.DB_NAME} (user ${USER_ID}, session ${SESSION_ID})`);
} finally {
    await db.closePool();
}
