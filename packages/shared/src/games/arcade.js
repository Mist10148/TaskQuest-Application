/**
 * Arcade run verification (pure). The games run in the browser, but they are
 * deterministic simulators shared with the server (snake.js, dino.js,
 * invaders.js). The client submits the inputs it gave, each with the step it
 * happened on; the server re-plays them from the run's seed and derives the
 * score itself (docs/design/arcade-anti-cheat.md, option D). On top of that:
 * the score must be plausible for the elapsed time, and XP per run is capped.
 */

'use strict';

const { ARCADE_CONFIG } = require('../constants');
const { secureRandom } = require('../random');
const snake = require('./snake');
const dino = require('./dino');
const invaders = require('./invaders');

const SIMULATORS = { snake, dino, invaders };

/**
 * Telemetry limits per game. `maxTicks` is about 10 minutes of play; the input
 * rate cap is per rolling second of simulated time (a person cannot press more).
 * `minPayingRunMs` is the shortest run (in simulated play time) that earns XP: a shorter one is valid but pays nothing, so a
 * script cannot farm the "+1 point" the plausibility bound allows on a run of a few steps.
 * Kept here, next to the simulators, rather than in ARCADE_CONFIG (which is sent to browsers).
 */
const TELEMETRY_LIMITS = {
    snake: { maxTicks: 6_000, maxInputsPerSecond: 15, maxInputs: 3_000, minPayingRunMs: 5_000 },
    dino: { maxTicks: 36_000, maxInputsPerSecond: 8, maxInputs: 3_000, minPayingRunMs: 5_000 },
    invaders: { maxTicks: 36_000, maxInputsPerSecond: 20, maxInputs: 6_000, minPayingRunMs: 5_000 }
};

/**
 * Slack between simulated play time and the server-measured time: network and
 * scheduling jitter in one direction, a hidden tab (the loop pauses) in the other.
 */
const TIME_TOLERANCE = { fasterRatio: 1.05, fasterSlackMs: 2_000, idleSlackMs: 10 * 60 * 1000 };

const OUTDATED_CLIENT = 'This version of the game is out of date. Please refresh the page and try again.';

function isArcadeGame(type) {
    return Object.prototype.hasOwnProperty.call(ARCADE_CONFIG, type);
}

/** A fresh seed (unsigned 32-bit, never 0) for a run. */
function newSeed(rng = secureRandom) {
    return 1 + Math.floor(rng() * 0xfffffffe);
}

/**
 * Plausibility bound and pricing for a score (the pre-telemetry check, still applied to the replayed score).
 * @param {string} type
 * @param {number} score   score (points)
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

/** Structural checks on a timeline; returns an error message or null. */
function validateTimeline(type, ticks, inputs) {
    const limits = TELEMETRY_LIMITS[type];
    const sim = SIMULATORS[type];
    if (!Number.isSafeInteger(ticks) || ticks < 1) return 'Invalid run length';
    if (ticks > limits.maxTicks) return 'Run is too long';
    if (!Array.isArray(inputs) || inputs.length % 2 !== 0) return 'Invalid input timeline';
    if (inputs.length / 2 > limits.maxInputs) return 'Too many inputs for one run';
    const codes = new Set(Object.values(sim.INPUT));
    let prev = 0;
    for (let i = 0; i < inputs.length; i += 2) {
        const tick = inputs[i];
        const code = inputs[i + 1];
        if (!Number.isSafeInteger(tick) || tick < prev || tick >= ticks) return 'Invalid input timeline';
        if (!codes.has(code)) return 'Invalid input timeline';
        prev = tick;
    }
    // Rolling window of one second of simulated time.
    const window = Math.ceil(1000 / sim.STEP_MS);
    for (let lo = 0, hi = 0; hi < inputs.length / 2; hi++) {
        while (inputs[hi * 2] - inputs[lo * 2] >= window) lo++;
        if (hi - lo + 1 > limits.maxInputsPerSecond) return 'Inputs came in faster than a person can play';
    }
    return null;
}

/**
 * Re-play a recorded run. `inputs` is a flat array [tick, code, tick, code, ...]
 * with ascending ticks; an input at tick t is applied during step t (0-based).
 * The run must end by game over on exactly step `ticks`.
 * @returns {{ ok: true, score: number, ticks: number } | { ok: false, error: string }}
 */
function replayRun(type, seed, ticks, inputs) {
    if (!isArcadeGame(type)) return { ok: false, error: 'Unknown arcade game' };
    const problem = validateTimeline(type, ticks, inputs);
    if (problem) return { ok: false, error: problem };
    const sim = SIMULATORS[type];
    const state = sim.create(seed);
    let next = 0;
    for (let t = 0; t < ticks; t++) {
        const now = [];
        while (next < inputs.length && inputs[next] === t) {
            now.push(inputs[next + 1]);
            next += 2;
        }
        sim.step(state, now);
        if (state.over) break;
    }
    if (!state.over || state.tick !== ticks) return { ok: false, error: 'The recorded run does not end where it claims to' };
    if (next !== inputs.length) return { ok: false, error: 'Invalid input timeline' };
    return { ok: true, score: state.score, ticks: state.tick };
}

/**
 * Verify a submitted run end to end and price it.
 * @param {string} type
 * @param {{ seed: number, elapsedMs: number }} run  what the server knows (seed issued at start, time since start)
 * @param {{ score?: number, ticks?: number, inputs?: number[] } | null} claim  what the client sent
 * A valid run shorter than `minPayingRunMs` is accepted but priced at 0 (`tooShort: true`); it is not rejected, so an honest
 * quick game over is never punished with a cancelled run.
 * @returns {{ ok: true, score: number, ticks: number, baseXP: number, tooShort: boolean } | { ok: false, error: string }}
 */
function verifyRun(type, run, claim) {
    if (!isArcadeGame(type)) return { ok: false, error: 'Unknown arcade game' };
    if (!claim || typeof claim !== 'object' || claim.ticks === undefined || claim.inputs === undefined) {
        return { ok: false, error: OUTDATED_CLIENT };
    }
    if (!Number.isSafeInteger(claim.score) || claim.score < 0) return { ok: false, error: 'Score must be a non-negative integer' };
    if (!Number.isSafeInteger(run.seed)) return { ok: false, error: OUTDATED_CLIENT };

    const replay = replayRun(type, run.seed, claim.ticks, claim.inputs);
    if (!replay.ok) return replay;
    if (replay.score !== claim.score) return { ok: false, error: 'The reported score does not match the recorded run' };

    const simulatedMs = replay.ticks * SIMULATORS[type].STEP_MS;
    const elapsedMs = Math.max(0, run.elapsedMs);
    if (simulatedMs > elapsedMs * TIME_TOLERANCE.fasterRatio + TIME_TOLERANCE.fasterSlackMs) {
        return { ok: false, error: 'The run was played faster than real time' };
    }
    if (elapsedMs > simulatedMs + TIME_TOLERANCE.idleSlackMs) {
        return { ok: false, error: 'The run took much longer than the recorded play time' };
    }

    // The previous plausibility bound still applies, on the replayed score.
    const priced = scoreRun(type, replay.score, elapsedMs);
    if (!priced.ok) return priced;
    const tooShort = simulatedMs < TELEMETRY_LIMITS[type].minPayingRunMs;
    return { ok: true, score: priced.score, ticks: replay.ticks, baseXP: tooShort ? 0 : priced.baseXP, tooShort };
}

/** The value at fraction `p` (0 to 1) of an ascending list, by nearest rank. */
function percentile(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/**
 * Calibration data for the plausibility bound, from finished runs (`npm run arcade-report`): how fast real players score.
 * `bound` is the current maxPointsPerSecond; `headroom` is bound / p99 (1 means the bound sits right on the 99th percentile, so
 * tightening it would reject honest players). Nothing here changes a limit: it only reports, so a person decides.
 * @param {Array<{ game: string, score: number, ticks: number }>} runs finished runs (replayed score and tick count)
 * @returns {Array<{ game: string, runs: number, p50: number, p95: number, p99: number, max: number, bound: number, headroom: number|null, nearBound: number }>}
 */
function summarizeRuns(runs) {
    const out = [];
    for (const game of Object.keys(ARCADE_CONFIG)) {
        const step = SIMULATORS[game].STEP_MS;
        const rates = [];
        let nearBound = 0;
        for (const r of runs.filter((x) => x.game === game && Number.isFinite(x.score) && Number.isFinite(x.ticks) && x.ticks > 0)) {
            const seconds = (r.ticks * step) / 1000;
            rates.push(r.score / seconds);
            // "Near the bound": a real run (10+ points) that scored at least 90% of what the bound allows for its length.
            if (r.score >= 10 && r.score >= 0.9 * (Math.floor(seconds * ARCADE_CONFIG[game].maxPointsPerSecond) + 1)) nearBound++;
        }
        rates.sort((a, b) => a - b);
        const round = (n) => Math.round(n * 100) / 100;
        const p99 = percentile(rates, 0.99);
        out.push({
            game,
            runs: rates.length,
            p50: round(percentile(rates, 0.5)),
            p95: round(percentile(rates, 0.95)),
            p99: round(p99),
            max: round(rates.length ? rates[rates.length - 1] : 0),
            bound: ARCADE_CONFIG[game].maxPointsPerSecond,
            headroom: p99 > 0 ? round(ARCADE_CONFIG[game].maxPointsPerSecond / p99) : null,
            nearBound
        });
    }
    return out;
}

module.exports = {
    isArcadeGame,
    scoreRun,
    verifyRun,
    replayRun,
    validateTimeline,
    summarizeRuns,
    newSeed,
    SIMULATORS,
    TELEMETRY_LIMITS,
    TIME_TOLERANCE,
    OUTDATED_CLIENT
};
