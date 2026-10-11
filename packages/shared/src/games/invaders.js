/**
 * Space Invaders: a pure, deterministic, fixed-timestep simulator (60 steps per
 * second). Mirrored by apps/web/src/lib/arcade/invaders.ts (parity test).
 *
 * Score = aliens destroyed. Inputs are key-state changes (left/right down/up)
 * and SHOOT, which is limited by a cooldown counted in steps (not wall time).
 * The seed shifts the alien formation and picks its first direction, so a
 * recorded run cannot simply be replayed against a different run.
 */

'use strict';

const { createRng } = require('./rng');

const STEP_MS = 1000 / 60;
const INPUT = { LEFT_DOWN: 1, LEFT_UP: 2, RIGHT_DOWN: 3, RIGHT_UP: 4, SHOOT: 5 };
const SHOT_COOLDOWN_STEPS = 15; // 250 ms at 60 steps per second

function create(seed) {
    const rng = createRng(seed);
    const offset = Math.floor(rng() * 5) * 10;
    const alienDir = rng() < 0.5 ? -1 : 1;
    const aliens = [];
    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 8; col++) {
            aliens.push({ x: 60 + offset + col * 50, y: 40 + row * 40, alive: true });
        }
    }
    return {
        tick: 0,
        over: false,
        won: false,
        score: 0,
        player: { x: 225, y: 350 },
        bullets: [],
        aliens,
        alienDir,
        alienSpeed: 1,
        keys: { left: false, right: false },
        lastShotTick: -1000
    };
}

/** True when a SHOOT input given now (during the next step) would fire a bullet. */
function canShoot(state) {
    return state.tick + 1 - state.lastShotTick >= SHOT_COOLDOWN_STEPS;
}

function step(state, inputs = []) {
    if (state.over) return;
    state.tick++;
    const g = state;
    for (const code of inputs) {
        if (code === INPUT.LEFT_DOWN) g.keys.left = true;
        else if (code === INPUT.LEFT_UP) g.keys.left = false;
        else if (code === INPUT.RIGHT_DOWN) g.keys.right = true;
        else if (code === INPUT.RIGHT_UP) g.keys.right = false;
        else if (code === INPUT.SHOOT && g.tick - g.lastShotTick >= SHOT_COOLDOWN_STEPS) {
            g.bullets.push({ x: g.player.x + 15, y: g.player.y });
            g.lastShotTick = g.tick;
        }
    }

    // Player
    if (g.keys.left && g.player.x > 0) g.player.x -= 5;
    if (g.keys.right && g.player.x < 450) g.player.x += 5;

    // Bullets
    for (const b of g.bullets) b.y -= 8;
    g.bullets = g.bullets.filter((b) => b.y > 0);

    // Aliens
    let moveDown = false;
    for (const a of g.aliens) {
        if (a.alive) {
            a.x += g.alienDir * g.alienSpeed;
            if (a.x < 10 || a.x > 470) moveDown = true;
        }
    }
    if (moveDown) {
        g.alienDir *= -1;
        for (const a of g.aliens) if (a.alive) a.y += 20;
        g.alienSpeed = Math.min(g.alienSpeed + 0.2, 4);
    }

    // Each bullet destroys at most one alien and is used up
    const spent = new Set();
    g.bullets.forEach((b, i) => {
        const hit = g.aliens.find((a) => a.alive && b.x > a.x && b.x < a.x + 30 && b.y > a.y && b.y < a.y + 25);
        if (hit) {
            hit.alive = false;
            spent.add(i);
            g.score++;
        }
    });
    if (spent.size > 0) g.bullets = g.bullets.filter((_, i) => !spent.has(i));

    if (g.aliens.every((a) => !a.alive)) {
        g.over = true;
        g.won = true;
    } else if (g.aliens.some((a) => a.alive && a.y > 320)) {
        g.over = true;
    }
}

module.exports = { type: 'invaders', STEP_MS, INPUT, SHOT_COOLDOWN_STEPS, create, step, canShoot };
