/**
 * Run `fn` once per key at a time: callers that arrive while a run for the same key is in flight share its result instead of
 * starting their own. A cache in front of a heavy query still lets every request that arrives during an expiry run the query;
 * this closes that gap. The entry is removed when the run settles (a failure is shared by the callers waiting, never cached).
 */
export function coalesce(inflight, key, fn) {
    const running = inflight.get(key);
    if (running) return running;
    const run = Promise.resolve()
        .then(fn)
        .finally(() => inflight.delete(key));
    inflight.set(key, run);
    return run;
}
