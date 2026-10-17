#!/usr/bin/env node
/**
 * How fast real players score in the arcade games, to check the plausibility bound (ARCADE_CONFIG.maxPointsPerSecond).
 *
 *   node scripts/arcade-report.js [--days 90]
 *
 * Per game: runs, points per second at the median, 95th and 99th percentile and the maximum, the current bound, the headroom
 * (bound / p99) and how many runs scored at least 90% of what the bound allows. A headroom close to 1 means the bound sits on
 * real play, so lowering it would reject honest players; a large one means it can come down. The report never changes anything.
 * See docs/design/arcade-anti-cheat.md.
 */
'use strict';

require('../packages/shared/src/env').loadEnv(process.cwd());
const db = require('../packages/shared/src/db');
const { arcade } = require('../packages/shared/src').games;

const i = process.argv.indexOf('--days');
const days = i >= 0 ? Number(process.argv[i + 1]) : 90;

(async () => {
    try {
        await db.assertSchemaCurrent();
        const runs = await db.maintenance.arcadeRuns({ days });
        if (!runs.length) console.log(`No finished arcade runs in the last ${days} days.`);
        else console.table(arcade.summarizeRuns(runs));
    } catch (err) {
        console.error('✗ report failed:', err.message);
        process.exitCode = 1;
    } finally {
        await db.closePool();
    }
})();
