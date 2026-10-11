/**
 * Snake: a pure, deterministic, fixed-timestep simulator (one step every
 * STEP_MS). The browser drives the same rules (apps/web/src/lib/arcade/snake.ts,
 * checked by the parity test) and the server replays the recorded inputs
 * to derive the score itself.
 *
 * Score = pellets eaten. Inputs are direction codes; a reversal into the
 * snake's own neck is ignored, exactly as in play.
 */

'use strict';

const { createRng } = require('./rng');

const STEP_MS = 100;
const GRID_SIZE = 20;
const INPUT = { UP: 1, DOWN: 2, LEFT: 3, RIGHT: 4 };

/** A uniformly random grid cell that is not occupied; null when the grid is full. */
function pickFreeCell(gridSize, occupied, rng) {
    const taken = new Set(occupied.map((c) => c.y * gridSize + c.x));
    const free = [];
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            if (!taken.has(y * gridSize + x)) free.push({ x, y });
        }
    }
    if (free.length === 0) return null;
    return free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
}

function create(seed) {
    const rng = createRng(seed);
    const snake = [{ x: 10, y: 10 }];
    return {
        rng,
        tick: 0,
        over: false,
        score: 0,
        snake,
        dir: { x: 1, y: 0 },
        lastDir: { x: 1, y: 0 },
        food: pickFreeCell(GRID_SIZE, snake, rng) || { x: 15, y: 15 }
    };
}

function applyInput(state, code) {
    const last = state.lastDir;
    if (code === INPUT.UP) {
        if (last.y !== 1) state.dir = { x: 0, y: -1 };
    } else if (code === INPUT.DOWN) {
        if (last.y !== -1) state.dir = { x: 0, y: 1 };
    } else if (code === INPUT.LEFT) {
        if (last.x !== 1) state.dir = { x: -1, y: 0 };
    } else if (code === INPUT.RIGHT) {
        if (last.x !== -1) state.dir = { x: 1, y: 0 };
    }
}

/** Advance one step, applying the inputs that arrived during it. */
function step(state, inputs = []) {
    if (state.over) return;
    state.tick++;
    for (const code of inputs) applyInput(state, code);

    const head = { x: state.snake[0].x + state.dir.x, y: state.snake[0].y + state.dir.y };
    state.lastDir = { ...state.dir };

    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE || state.snake.some((s) => s.x === head.x && s.y === head.y)) {
        state.over = true;
        return;
    }
    state.snake.unshift(head);

    if (head.x === state.food.x && head.y === state.food.y) {
        state.score++;
        const free = pickFreeCell(GRID_SIZE, state.snake, state.rng);
        if (!free) {
            // The snake fills the board: nothing left to eat.
            state.over = true;
            return;
        }
        state.food = free;
    } else {
        state.snake.pop();
    }
}

module.exports = { type: 'snake', STEP_MS, GRID_SIZE, INPUT, create, step, pickFreeCell };
