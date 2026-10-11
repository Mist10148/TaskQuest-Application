/**
 * Test-only bots that play the arcade simulators with plausible inputs and
 * record the timeline the web client would submit. Used to produce fixtures
 * (generateArcadeFixtures.js) and legitimate runs in the replay/integration tests.
 */

'use strict';

const shared = require('../../src');

const { SIMULATORS } = shared.games.arcade;

const DIRS = [
    { code: 1, x: 0, y: -1 },
    { code: 2, x: 0, y: 1 },
    { code: 3, x: -1, y: 0 },
    { code: 4, x: 1, y: 0 }
];

/** Snake: head for the food, avoiding walls and its own body, until `target` pellets are eaten; then run into a wall. */
function snakeBot(target) {
    return (s) => {
        if (s.score >= target) return [];
        const head = s.snake[0];
        const blocked = (x, y) => x < 0 || x >= 20 || y < 0 || y >= 20 || s.snake.some((c) => c.x === x && c.y === y);
        const options = DIRS.filter((d) => !(d.x === -s.lastDir.x && d.y === -s.lastDir.y) && !blocked(head.x + d.x, head.y + d.y));
        if (options.length === 0) return [];
        const dist = (d) => Math.abs(head.x + d.x - s.food.x) + Math.abs(head.y + d.y - s.food.y);
        options.sort((a, b) => dist(a) - dist(b));
        const best = options[0];
        return best.x === s.dir.x && best.y === s.dir.y ? [] : [best.code];
    };
}

/** Dino: jump shortly before each obstacle, until `target` obstacles are passed; then stop jumping and crash. */
function dinoBot(target) {
    return (s) => {
        if (s.score >= target || s.dino.jumping) return [];
        const ahead = s.obstacles.find((o) => !o.passed && o.x > 40);
        if (ahead && ahead.x - 90 <= s.speed * 9) return [1];
        return [];
    };
}

/**
 * Invaders: line up under the lowest alien and shoot, until `target` kills; then stand still and lose.
 * Hysteresis (start moving beyond 20 px, stop within 6 px) keeps the key presses down to a human rate.
 */
function invadersBot(target) {
    return (s) => {
        if (s.score >= target) return s.keys.left || s.keys.right ? [s.keys.left ? 2 : 4] : [];
        const alive = s.aliens.filter((a) => a.alive);
        if (alive.length === 0) return [];
        const lowest = alive.reduce((best, a) => (a.y > best.y || (a.y === best.y && a.x < best.x) ? a : best));
        const dx = lowest.x + 15 - (s.player.x + 15);
        const out = [];
        let dir = s.keys.left ? -1 : s.keys.right ? 1 : 0;
        if (dir === 0) {
            if (dx < -20) dir = -1;
            else if (dx > 20) dir = 1;
        } else if (Math.abs(dx) <= 6 || Math.sign(dx) !== dir) {
            dir = 0;
        }
        if ((dir === -1) !== s.keys.left) out.push(dir === -1 ? 1 : 2);
        if ((dir === 1) !== s.keys.right) out.push(dir === 1 ? 3 : 4);
        if (Math.abs(dx) <= 14 && SIMULATORS.invaders.canShoot(s)) out.push(5);
        return out;
    };
}

const BOTS = { snake: snakeBot, dino: dinoBot, invaders: invadersBot };

/**
 * Play a whole run and return the telemetry the client would send.
 * @returns {{ seed: number, ticks: number, inputs: number[], score: number } | null} null when the run does not end within maxTicks
 */
function playBot(type, seed, target, maxTicks = 36_000) {
    const sim = SIMULATORS[type];
    const bot = BOTS[type](target);
    const state = sim.create(seed);
    const inputs = [];
    while (!state.over && state.tick < maxTicks) {
        const now = bot(state);
        for (const code of now) inputs.push(state.tick, code);
        sim.step(state, now);
    }
    if (!state.over) return null;
    return { seed, ticks: state.tick, inputs, score: state.score };
}

module.exports = { playBot };
