/**
 * Seeded PRNG (mulberry32) for the deterministic arcade simulators. The server
 * issues a seed per run; the browser and the server then derive the same
 * sequence. Integer maths only, so every JS engine produces the same stream.
 * Mirrored in apps/web/src/lib/arcade/rng.ts (kept in lock-step by the parity test).
 */

'use strict';

/** @param {number} seed unsigned 32-bit integer @returns {() => number} generator of floats in [0, 1) */
function createRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

module.exports = { createRng };
