/**
 * Regenerates packages/shared/test/fixtures/arcade-timelines.json: recorded
 * runs (seed, inputs, ticks) with the score the simulator derives. Both the
 * shared node tests and the web app's parity test replay these, so a change to
 * any simulator that is not mirrored on the other side fails a test.
 *
 *   node packages/shared/test/helpers/generateArcadeFixtures.js
 *
 * Only regenerate on purpose (a deliberate rule change): the point of the file
 * is that it does not follow the code by accident.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { playBot } = require('./arcadeBots');
const { replayRun } = require('../../src').games.arcade;

const PLAN = [
    ['snake', 101, 0],
    ['snake', 4242, 6],
    ['snake', 987654321, 25],
    ['snake', 5, 34],
    ['dino', 7, 0],
    ['dino', 31337, 5],
    ['dino', 424242, 20],
    ['dino', 99, 40],
    ['invaders', 1, 0],
    ['invaders', 2024, 8],
    ['invaders', 555555, 32],
    ['invaders', 9, 32]
];

const runs = PLAN.map(([game, seed, target]) => {
    const run = playBot(game, seed, target);
    if (!run) throw new Error(`${game} seed ${seed} target ${target} did not finish`);
    const check = replayRun(game, seed, run.ticks, run.inputs);
    if (!check.ok || check.score !== run.score) throw new Error(`${game} seed ${seed} does not replay: ${check.error}`);
    return { game, seed, ticks: run.ticks, score: run.score, inputs: run.inputs };
});

const file = path.join(__dirname, '..', 'fixtures', 'arcade-timelines.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(runs) + '\n');
for (const r of runs) console.log(r.game.padEnd(9), 'seed', String(r.seed).padEnd(10), 'ticks', String(r.ticks).padEnd(6), 'inputs', r.inputs.length / 2, 'score', r.score);
