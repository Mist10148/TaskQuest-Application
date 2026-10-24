/**
 * Background-job wrapper: logs failures instead of crashing, and never runs a
 * job again while its previous run is still going (a slow DM batch or DB stall
 * must not stack up overlapping runs that double-send).
 *
 * On shutdown, `stopJobs()` keeps new runs from starting and `whenIdle()` waits (up to a limit)
 * for the ones in flight, so a DM that was just sent still gets its "sent" mark saved.
 */

'use strict';

const running = new Set();
let stopped = false;

function job(name, fn, log) {
    let isRunning = false;
    return async () => {
        if (stopped) return;
        if (isRunning) {
            log('⏭️', name, 'previous run still in progress, skipping');
            return;
        }
        isRunning = true;
        const run = (async () => {
            try {
                await fn();
            } catch (err) {
                log('❌', name, err.stack || err.message);
            } finally {
                isRunning = false;
            }
        })();
        running.add(run);
        try {
            await run;
        } finally {
            running.delete(run);
        }
    };
}

/** No job starts after this. */
function stopJobs() {
    stopped = true;
}

/** Resolves when no job is running, or after `timeoutMs`, whichever comes first. Returns true when idle. */
async function whenIdle(timeoutMs = 10_000) {
    if (!running.size) return true;
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const idle = Promise.allSettled([...running]).then(() => true);
    try {
        return await Promise.race([idle, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/** For tests: allow jobs again after stopJobs(). */
function resetJobs() {
    stopped = false;
}

module.exports = { job, stopJobs, whenIdle, resetJobs };
