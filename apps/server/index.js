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

    let closing = false;
    const shutdown = (signal) => {
        if (closing) return;
        closing = true;
        console.log(`${signal} received, shutting down...`);
        server.close(async () => {
            await db.closePool().catch(() => {});
            process.exit(0);
        });
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
