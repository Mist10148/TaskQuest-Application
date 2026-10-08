'use strict';

const crypto = require('crypto');

/**
 * Uniform float in [0, 1) from the OS CSPRNG. Used for anything that decides
 * XP outcomes so results cannot be predicted from Math.random state.
 */
function secureRandom() {
    return crypto.randomInt(0, 2 ** 32) / 2 ** 32;
}

/** Uniform integer in [0, max). */
function randomInt(max, rng = secureRandom) {
    return Math.floor(rng() * max);
}

/** Fisher–Yates shuffle returning a new array. */
function shuffle(array, rng = secureRandom) {
    const out = [...array];
    for (let i = out.length - 1; i > 0; i--) {
        const j = randomInt(i + 1, rng);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

module.exports = { secureRandom, randomInt, shuffle };
