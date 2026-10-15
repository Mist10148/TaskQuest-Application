#!/usr/bin/env node
/**
 * What each class really earned per action, from the XP log (xp_transactions.player_class, filled since migration 026).
 *
 *   node scripts/xp-report.js [--days 90]
 *
 * Compare the averages with docs/design/balance.md (open question 9). Rows from before the migration have no class (UNKNOWN).
 */
'use strict';

require('../packages/shared/src/env').loadEnv(process.cwd());
const db = require('../packages/shared/src/db');

const i = process.argv.indexOf('--days');
const days = i >= 0 ? Number(process.argv[i + 1]) : 90;

(async () => {
    try {
        await db.assertSchemaCurrent();
        const rows = await db.maintenance.xpByClass({ days });
        if (!rows.length) console.log(`No modified XP in the last ${days} days.`);
        else console.table(rows);
    } catch (err) {
        console.error('✗ report failed:', err.message);
        process.exitCode = 1;
    } finally {
        await db.closePool();
    }
})();
