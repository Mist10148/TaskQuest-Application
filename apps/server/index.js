/**
 * TaskQuest web server: Express API + Discord OAuth, and (in production) the
 * built React app from apps/web/dist on the same origin.
 */

import db from '@taskquest/shared/db';
import config, { validateConfig } from './config.js';
import { createApp } from './app.js';

async function main() {
    validateConfig();
    await db.ping();
    // Migrations are idempotent and lock-protected, so both apps may run them.
    if (process.env.MIGRATE_ON_START !== 'false') await db.runMigrations();
    else await db.assertSchemaCurrent();

    const app = createApp();
    const server = app.listen(config.port, () => {
        console.log(`🌐 TaskQuest web server listening on :${config.port} (${config.isProduction ? 'production' : 'development'})`);
        console.log(`   Public URL: ${config.publicUrl}`);
    });

    // Abandoned game sessions are settled (bets refunded) here as well as in the bot, so the web
    // app is correct on its own. The job is idempotent (row locks), so running in both is safe.
    let expiring = false;
    const expireGames = async () => {
        if (expiring) return;
        expiring = true;
        try {
            const expired = await db.games.expireStaleSessions();
            if (expired > 0) console.log(`Expired ${expired} abandoned game sessions (bets refunded)`);
        } catch (err) {
            console.error('Game session expiry failed:', err.message);
        } finally {
            expiring = false;
        }
    };
    void expireGames();
    setInterval(expireGames, 5 * 60 * 1000).unref();

    let closing = false;
    const shutdown = (signal) => {
        if (closing) return;
        closing = true;
        console.log(`${signal} received, shutting down...`);
        server.close(async () => {
            await db.closePool().catch(() => {});
            process.exit(0);
        });
        // Long-lived connections (an AI chat stream, keep-alive sockets) would hold server.close() open until the timeout below.
        server.closeIdleConnections?.();
        setTimeout(() => server.closeAllConnections?.(), 5_000).unref();
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

main().catch((err) => {
    console.error(`❌ Failed to start: ${err.message}`);
    process.exit(1);
});
