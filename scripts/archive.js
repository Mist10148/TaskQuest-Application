#!/usr/bin/env node
/**
 * Move old XP transactions (and, with --games, finished game sessions) to the *_archive tables.
 *
 *   node scripts/archive.js [--days 365] [--batch 5000] [--games] [--dry-run]
 *
 * Reads DB_* from the environment or the root .env, like `npm run db:migrate`. Take a backup first. Caps and the history view
 * only look at recent rows; stats that look back further than --days will not see archived XP. --games also lowers the
 * games played and won counts, because they are counted from the sessions.
 */
'use strict';

require('../packages/shared/src/env').loadEnv(process.cwd());
const db = require('../packages/shared/src/db');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};

(async () => {
    try {
        await db.assertSchemaCurrent();
        const r = await db.maintenance.archiveOld({ days: value('--days', 365), batch: value('--batch', 5000), games: flag('--games'), dryRun: flag('--dry-run') });
        const verb = r.dryRun ? 'would move' : 'moved';
        console.log(`Cutoff ${r.cutoff.toISOString()}: ${verb} ${r.xpTransactions} xp_transactions` + (r.gameSessions === null ? '' : ` and ${r.gameSessions} game_sessions`) + '.');
    } catch (err) {
        console.error('✗ archive failed:', err.message);
        process.exitCode = 1;
    } finally {
        await db.closePool();
    }
})();
