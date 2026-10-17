'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../src');
const { createRng } = require('../src/games/rng');
const fixtures = require('./fixtures/arcade-timelines.json');
const { playBot } = require('./helpers/arcadeBots');

const { arcade } = shared.games;
const { snake, dino, invaders } = arcade.SIMULATORS;

/** Server view of a legitimate run: played in real time, plus a little network slack. */
const realTime = (type, ticks) => ({ elapsedMs: Math.ceil(ticks * arcade.SIMULATORS[type].STEP_MS) + 300 });
const claimOf = (run) => ({ score: run.score, ticks: run.ticks, inputs: run.inputs });

test('rng: seeded, repeatable, in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seq = Array.from({ length: 50 }, () => a());
    assert.deepEqual(seq, Array.from({ length: 50 }, () => b()));
    assert.ok(seq.every((n) => n >= 0 && n < 1));
    assert.notDeepEqual(seq, Array.from({ length: 50 }, createRng(43)));
    assert.equal(createRng(1)(), 0.6270739405881613, 'known value: the web port must produce the same stream');
});

test('arcade.newSeed gives non-zero 32-bit seeds', () => {
    assert.equal(arcade.newSeed(() => 0), 1);
    assert.equal(arcade.newSeed(() => 0.999999999999), 0xfffffffe);
    for (let i = 0; i < 100; i++) {
        const s = arcade.newSeed();
        assert.ok(Number.isInteger(s) && s >= 1 && s < 0xffffffff);
    }
});

test('snake: moves, eats, grows, dies on walls and itself', () => {
    const s = snake.create(1);
    assert.equal(s.snake.length, 1);
    snake.step(s, []);
    assert.deepEqual(s.snake[0], { x: 11, y: 10 });
    assert.equal(s.tick, 1);

    // Reversing into the neck is ignored; a turn is not.
    snake.step(s, [snake.INPUT.LEFT]);
    assert.deepEqual(s.dir, { x: 1, y: 0 });
    snake.step(s, [snake.INPUT.DOWN]);
    assert.deepEqual(s.dir, { x: 0, y: 1 });

    // No input: runs into the right wall on step 10 (x goes 10 -> 19 in 9 steps).
    const wall = snake.create(7);
    for (let i = 0; i < 9; i++) snake.step(wall, []);
    assert.equal(wall.over, false);
    snake.step(wall, []);
    assert.deepEqual([wall.over, wall.tick, wall.score], [true, 10, 0]);
    snake.step(wall, []);
    assert.equal(wall.tick, 10, 'a finished game does not advance');

    // Eating: put the food right in front of the head.
    const eat = snake.create(3);
    eat.food = { x: 11, y: 10 };
    snake.step(eat, []);
    assert.equal(eat.score, 1);
    assert.equal(eat.snake.length, 2);
    assert.notDeepEqual(eat.food, { x: 11, y: 10 });

    // Self collision: a 5-long snake that curls back on itself.
    const curl = snake.create(3);
    curl.snake = [{ x: 10, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 }, { x: 11, y: 10 }, { x: 11, y: 9 }];
    curl.dir = { x: 1, y: 0 };
    curl.lastDir = { x: 0, y: -1 };
    curl.food = { x: 0, y: 0 };
    snake.step(curl, []);
    assert.equal(curl.over, true, 'moving into its own body ends the run');
});

test('snake: the same seed gives the same food; filling the board ends the run', () => {
    const food = (seed) => snake.create(seed).food;
    assert.deepEqual(food(99), food(99));
    assert.ok([1, 2, 3, 4, 5, 6].some((n) => JSON.stringify(food(n)) !== JSON.stringify(food(99))));
    const cells = [];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) cells.push({ x, y });
    assert.equal(snake.pickFreeCell(20, cells, () => 0.5), null);
});

test('dino: jump, gravity, one jump at a time, deterministic obstacles', () => {
    const d = dino.create(5);
    dino.step(d, [dino.INPUT.JUMP]);
    assert.equal(d.dino.jumping, true);
    assert.ok(d.dino.y < dino.GROUND_Y);
    const vy = d.dino.vy;
    dino.step(d, [dino.INPUT.JUMP]);
    assert.ok(d.dino.vy > vy, 'a second jump in the air does nothing; gravity keeps pulling');
    for (let i = 0; i < 60 && d.dino.jumping; i++) dino.step(d, []);
    assert.equal(d.dino.jumping, false);
    assert.equal(d.dino.y, dino.GROUND_Y);

    const run = (seed) => {
        const s = dino.create(seed);
        while (!s.over) dino.step(s, []);
        return [s.tick, s.score, s.obstacles.length];
    };
    assert.deepEqual(run(11), run(11));
    assert.equal(run(11)[1], 0, 'standing still never passes an obstacle');
});

test('dino: passing obstacles scores and speeds the game up', () => {
    const run = playBot('dino', 424242, 20);
    assert.equal(run.score, 20);
    const s = dino.create(424242);
    s.score = 10;
    dino.step(s, []);
    assert.equal(s.speed, 6.5);
});

test('invaders: shot cooldown counts steps, bullets kill one alien each, standing still loses', () => {
    const s = invaders.create(2);
    assert.equal(s.aliens.length, 32);
    assert.equal(invaders.canShoot(s), true);
    invaders.step(s, [invaders.INPUT.SHOOT, invaders.INPUT.SHOOT]);
    assert.equal(s.bullets.length, 1, 'two shots in one step: the cooldown allows one');
    invaders.step(s, [invaders.INPUT.SHOOT]);
    assert.equal(s.bullets.length, 1, 'still cooling down');
    assert.equal(invaders.canShoot(s), false);
    for (let i = 0; i < invaders.SHOT_COOLDOWN_STEPS; i++) invaders.step(s, []);
    assert.equal(invaders.canShoot(s), true);

    const idle = invaders.create(3);
    while (!idle.over) invaders.step(idle, []);
    assert.deepEqual([idle.won, idle.score], [false, 0]);

    // One bullet, two aliens stacked on it: only one dies.
    const stack = invaders.create(4);
    stack.aliens = [
        { x: 100, y: 100, alive: true },
        { x: 100, y: 110, alive: true },
        { x: 400, y: 40, alive: true }
    ];
    stack.alienDir = 1;
    stack.bullets = [{ x: 115, y: 130 }];
    invaders.step(stack, []);
    assert.equal(stack.score, 1);
    assert.equal(stack.bullets.length, 0, 'the bullet is used up');
});

test('invaders: the seed changes the formation, the same seed repeats it', () => {
    const first = (seed) => invaders.create(seed).aliens[0].x;
    assert.equal(first(8), first(8));
    assert.ok([1, 2, 3, 4, 5, 6, 7].some((n) => first(n) !== first(8)));
});

test('recorded fixtures replay to the stored score', () => {
    assert.ok(fixtures.length >= 9);
    const games = new Set(fixtures.map((f) => f.game));
    assert.deepEqual([...games].sort(), ['dino', 'invaders', 'snake']);
    for (const f of fixtures) {
        const r = arcade.replayRun(f.game, f.seed, f.ticks, f.inputs);
        assert.deepEqual([f.game, f.seed, r.ok, r.score], [f.game, f.seed, true, f.score]);
    }
});

test('verifyRun: a legitimate recorded run is paid on the replayed score', () => {
    for (const f of fixtures) {
        const out = arcade.verifyRun(f.game, { seed: f.seed, ...realTime(f.game, f.ticks) }, claimOf(f));
        assert.equal(out.ok, true, `${f.game} ${f.seed}: ${out.error}`);
        assert.equal(out.score, f.score);
        assert.equal(out.baseXP, Math.min(f.score * shared.ARCADE_CONFIG[f.game].xpPerPoint, shared.ARCADE_CONFIG[f.game].maxXP));
    }
});

test('verifyRun rejects tampered, truncated, extended and foreign runs', () => {
    const scored = fixtures.filter((f) => f.score > 0);
    assert.ok(scored.length >= 6);
    for (const f of scored) {
        const run = { seed: f.seed, ...realTime(f.game, f.ticks) };
        const bad = (claim, run2 = run) => arcade.verifyRun(f.game, run2, claim);

        assert.equal(bad({ ...claimOf(f), score: f.score + 1 }).ok, false, 'score edited up');
        assert.equal(bad({ ...claimOf(f), score: f.score - 1 }).ok, false, 'score edited down');
        assert.equal(bad({ ...claimOf(f), ticks: f.ticks - 1 }).ok, false, 'truncated');
        assert.equal(bad({ ...claimOf(f), ticks: f.ticks + 5 }, { seed: f.seed, ...realTime(f.game, f.ticks + 5) }).ok, false, 'extended');
        assert.equal(bad(claimOf(f), { ...run, seed: f.seed + 1 }).ok, false, 'wrong seed');
        const dropped = f.inputs.slice(2);
        assert.equal(bad({ ...claimOf(f), inputs: dropped }).ok, false, 'first input removed');
    }
});

test('verifyRun rejects malformed timelines', () => {
    const f = fixtures.find((x) => x.game === 'invaders' && x.score > 0);
    const run = { seed: f.seed, ...realTime('invaders', f.ticks) };
    const bad = (claim) => arcade.verifyRun('invaders', run, claim);
    const base = claimOf(f);
    assert.equal(bad({ ...base, inputs: [...f.inputs, f.ticks, 5] }).ok, false, 'input at or after the end');
    assert.equal(bad({ ...base, inputs: [5, 5, 2, 5] }).ok, false, 'ticks out of order');
    assert.equal(bad({ ...base, inputs: [...f.inputs, f.ticks - 1] }).ok, false, 'odd length');
    assert.equal(bad({ ...base, inputs: [1, 99] }).ok, false, 'unknown input code');
    assert.equal(bad({ ...base, inputs: [0.5, 5] }).ok, false, 'fractional tick');
    assert.equal(bad({ ...base, inputs: 'nope' }).ok, false);
    assert.equal(bad({ ...base, ticks: 0 }).ok, false);
    assert.equal(bad({ ...base, score: -1 }).ok, false);
    assert.equal(bad({ ...base, score: 1.5 }).ok, false);
    assert.equal(arcade.verifyRun('pong', run, base).ok, false);
});

test('verifyRun: impossible input rates, long runs and too many inputs', () => {
    const rate = (type, perSecond, ticks) => {
        const sim = arcade.SIMULATORS[type];
        const code = Object.values(sim.INPUT)[0];
        const window = Math.ceil(1000 / sim.STEP_MS);
        const inputs = [];
        for (let i = 0; i < perSecond; i++) inputs.push(Math.floor((i * window) / perSecond), code);
        return arcade.validateTimeline(type, ticks, inputs);
    };
    for (const type of ['snake', 'dino', 'invaders']) {
        const cap = arcade.TELEMETRY_LIMITS[type].maxInputsPerSecond;
        assert.equal(rate(type, cap, 6000), null, `${type}: exactly the cap is fine`);
        assert.match(rate(type, cap + 1, 6000), /faster than a person/, `${type}: one over the cap`);
        assert.match(arcade.validateTimeline(type, arcade.TELEMETRY_LIMITS[type].maxTicks + 1, []), /too long/);
        const n = arcade.TELEMETRY_LIMITS[type].maxInputs + 1;
        const many = [];
        for (let i = 0; i < n; i++) many.push(i, Object.values(arcade.SIMULATORS[type].INPUT)[0]);
        assert.match(arcade.validateTimeline(type, arcade.TELEMETRY_LIMITS[type].maxTicks, many), /Too many inputs/);
    }
});

test('verifyRun: wall time must agree with the recorded ticks', () => {
    const f = fixtures.find((x) => x.game === 'snake' && x.score >= 25);
    const claim = claimOf(f);
    const simulated = f.ticks * snake.STEP_MS;
    const at = (elapsedMs) => arcade.verifyRun('snake', { seed: f.seed, elapsedMs }, claim);
    assert.equal(at(simulated).ok, true);
    assert.equal(at((simulated - arcade.TIME_TOLERANCE.fasterSlackMs) / arcade.TIME_TOLERANCE.fasterRatio + 1).ok, true, 'within the tolerance');
    assert.match(at(simulated / 4 - 3000).error, /faster than real time/);
    assert.match(at(0).error, /faster than real time/);
    assert.equal(at(simulated + arcade.TIME_TOLERANCE.idleSlackMs - 1).ok, true, 'a paused tab is allowed');
    assert.match(at(simulated + arcade.TIME_TOLERANCE.idleSlackMs + 1).error, /longer than the recorded/);
});

test('verifyRun keeps the plausibility bound and the XP cap on the replayed score', () => {
    const f = fixtures.find((x) => x.game === 'snake' && x.score >= 25);
    // 25 pellets in 349 steps (35 s) is fine; the same run claiming only 3 s of wall time is not.
    assert.equal(arcade.verifyRun('snake', { seed: f.seed, elapsedMs: 3_000 }, claimOf(f)).ok, false);
    const capped = playBot('dino', 99, 40);
    const out = arcade.verifyRun('dino', { seed: 99, ...realTime('dino', capped.ticks) }, claimOf(capped));
    assert.equal(out.ok, true);
    assert.equal(out.baseXP, 40);
});

test('verifyRun: score-only submissions from an old client ask for a refresh', () => {
    const f = fixtures[1];
    const run = { seed: f.seed, ...realTime(f.game, f.ticks) };
    for (const claim of [null, undefined, 5, { score: 3 }, { score: 3, ticks: 10 }]) {
        const out = arcade.verifyRun(f.game, run, claim);
        assert.equal(out.ok, false);
        assert.match(out.error, /refresh the page/);
    }
    assert.match(arcade.verifyRun(f.game, { elapsedMs: 5000 }, claimOf(f)).error, /refresh the page/, 'a run issued without a seed cannot be verified');
});

// ─── anti-cheat option B: minimum paying run, calibration report ────────────────

test('a valid run shorter than the minimum is accepted but pays nothing', () => {
    const short = playBot('snake', 1, 2); // 2 pellets in 2.7 s
    assert.ok(short.score === 2 && short.ticks * snake.STEP_MS < arcade.TELEMETRY_LIMITS.snake.minPayingRunMs);
    const out = arcade.verifyRun('snake', { seed: 1, ...realTime('snake', short.ticks) }, claimOf(short));
    assert.equal(out.ok, true, 'not rejected, so an honest quick game over cancels nothing');
    assert.equal(out.score, 2);
    assert.equal(out.tooShort, true);
    assert.equal(out.baseXP, 0);
});

test('a run at or past the minimum pays as before', () => {
    for (const f of fixtures.filter((x) => x.score > 0)) {
        const out = arcade.verifyRun(f.game, { seed: f.seed, ...realTime(f.game, f.ticks) }, claimOf(f));
        const long = f.ticks * arcade.SIMULATORS[f.game].STEP_MS >= arcade.TELEMETRY_LIMITS[f.game].minPayingRunMs;
        assert.equal(out.tooShort, !long, `${f.game} ${f.seed}`);
        assert.equal(out.baseXP > 0, long, `${f.game} ${f.seed}`);
    }
});

test('the minimum is a server-side limit that browsers never receive', () => {
    for (const game of Object.keys(shared.ARCADE_CONFIG)) {
        assert.ok(arcade.TELEMETRY_LIMITS[game].minPayingRunMs > 0, game);
        assert.equal('minPayingRunMs' in shared.ARCADE_CONFIG[game], false, game);
    }
});

test('summarizeRuns reports points per second per game and how near the bound real play gets', () => {
    // Snake: 100 ms steps. 600 steps = 60 s. The bound is 2 points/s, so 120 would be the limit.
    const runs = [
        { game: 'snake', score: 30, ticks: 600 },
        { game: 'snake', score: 60, ticks: 600 },
        { game: 'snake', score: 118, ticks: 600 }, // 98% of the bound
        { game: 'snake', score: 5, ticks: 0 }, // no steps: ignored
        { game: 'dino', score: 40, ticks: 3752 }
    ];
    const report = arcade.summarizeRuns(runs);
    assert.deepEqual(report.map((r) => r.game), ['snake', 'dino', 'invaders']);
    const [snakeRow, dinoRow, invadersRow] = report;
    assert.equal(snakeRow.runs, 3);
    assert.equal(snakeRow.p50, 1);
    assert.equal(snakeRow.max, 1.97);
    assert.equal(snakeRow.bound, 2);
    assert.equal(snakeRow.headroom, 1.02, 'the bound sits almost on the fastest run: do not tighten it');
    assert.equal(snakeRow.nearBound, 1);
    assert.equal(dinoRow.runs, 1);
    assert.deepEqual([invadersRow.runs, invadersRow.p99, invadersRow.headroom, invadersRow.nearBound], [0, 0, null, 0], 'a game with no runs reports zeros');
});
