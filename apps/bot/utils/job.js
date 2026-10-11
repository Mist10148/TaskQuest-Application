/**
 * Background-job wrapper: logs failures instead of crashing, and never runs a
 * job again while its previous run is still going (a slow DM batch or DB stall
 * must not stack up overlapping runs that double-send).
 */

'use strict';

function job(name, fn, log) {
    let isRunning = false;
    return async () => {
        if (isRunning) {
            log('⏭️', name, 'previous run still in progress, skipping');
            return;
        }
        isRunning = true;
        try {
            await fn();
        } catch (err) {
            log('❌', name, err.stack || err.message);
        } finally {
            isRunning = false;
        }
    };
}

module.exports = { job };
