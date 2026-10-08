/**
 * Arcade score validation (pure). The arcade games run in the browser, so the
 * server cannot verify the gameplay itself. It can, however, bound the reward:
 * a run must have been started by the server, the score must be plausible for
 * the elapsed time, and the XP per run is capped.
 */

'use strict';

const { ARCADE_CONFIG } = require('../constants');

function isArcadeGame(type) {
    return Object.prototype.hasOwnProperty.call(ARCADE_CONFIG, type);
}

/**
 * @param {string} type
 * @param {number} score   reported score (points)
 * @param {number} elapsedMs  server-measured time since the run started
 * @returns {{ ok: true, score: number, baseXP: number } | { ok: false, error: string }}
 */
function scoreRun(type, score, elapsedMs) {
    if (!isArcadeGame(type)) return { ok: false, error: 'Unknown arcade game' };
    if (!Number.isSafeInteger(score) || score < 0) return { ok: false, error: 'Score must be a non-negative integer' };

    const cfg = ARCADE_CONFIG[type];
    const seconds = Math.max(0, elapsedMs) / 1000;
    const plausibleMax = Math.floor(seconds * cfg.maxPointsPerSecond) + 1;
    if (score > plausibleMax) return { ok: false, error: 'Score is not plausible for the run duration' };

    return { ok: true, score, baseXP: Math.min(score * cfg.xpPerPoint, cfg.maxXP) };
}

module.exports = { isArcadeGame, scoreRun };
