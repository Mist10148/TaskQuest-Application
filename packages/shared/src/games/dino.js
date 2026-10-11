/**
 * Dino Runner: a pure, deterministic, fixed-timestep simulator (60 steps per
 * second). Mirrored by apps/web/src/lib/arcade/dino.ts (parity test).
 *
 * Score = obstacles passed. The only input is JUMP, which works on the ground.
 * Obstacle spawns draw from the seeded RNG in a fixed order every step.
 */

'use strict';

const { createRng } = require('./rng');

const STEP_MS = 1000 / 60;
const INPUT = { JUMP: 1 };

const GROUND_Y = 160;
const GRAVITY = 0.9;
const JUMP_FORCE = -16;
const CANVAS_WIDTH = 600;
const DINO_X = 55;

function create(seed) {
    return {
        rng: createRng(seed),
        tick: 0,
        over: false,
        score: 0,
        speed: 6,
        dino: { y: GROUND_Y, vy: 0, jumping: false },
        obstacles: []
    };
}

function step(state, inputs = []) {
    if (state.over) return;
    state.tick++;
    const g = state;
    for (const code of inputs) {
        if (code === INPUT.JUMP && !g.dino.jumping) {
            g.dino.vy = JUMP_FORCE;
            g.dino.jumping = true;
        }
    }

    // Speed up over time
    g.speed = 6 + Math.floor(g.score / 10) * 0.5;

    // Dino physics
    g.dino.vy += GRAVITY;
    g.dino.y += g.dino.vy;
    if (g.dino.y >= GROUND_Y) {
        g.dino.y = GROUND_Y;
        g.dino.vy = 0;
        g.dino.jumping = false;
    }

    // Spawn obstacles
    const lastObstacle = g.obstacles[g.obstacles.length - 1];
    const minGap = 200 + g.rng() * 150;
    if (!lastObstacle || lastObstacle.x < CANVAS_WIDTH - minGap) {
        if (g.rng() < 0.02) {
            const type = g.rng() > 0.75 ? 'bird' : 'cactus';
            const height = type === 'cactus' ? 30 + g.rng() * 25 : 0;
            g.obstacles.push({ x: CANVAS_WIDTH + 50, type, passed: false, height });
        }
    }

    // Move obstacles and score the ones that passed the dino
    for (const o of g.obstacles) {
        o.x -= g.speed;
        if (!o.passed && o.x + 40 < 50) {
            o.passed = true;
            g.score++;
        }
    }
    g.obstacles = g.obstacles.filter((o) => o.x > -60);

    // Collision
    const dinoBox = { x: DINO_X, y: g.dino.y - 42, w: 35, h: 42 };
    for (const o of g.obstacles) {
        const oBox = o.type === 'cactus' ? { x: o.x, y: GROUND_Y - o.height, w: 20, h: o.height } : { x: o.x, y: GROUND_Y - 50, w: 35, h: 16 };
        if (dinoBox.x < oBox.x + oBox.w && dinoBox.x + dinoBox.w > oBox.x && dinoBox.y < oBox.y + oBox.h && dinoBox.y + dinoBox.h > oBox.y) {
            g.over = true;
            return;
        }
    }
}

module.exports = { type: 'dino', STEP_MS, INPUT, GROUND_Y, CANVAS_WIDTH, create, step };
