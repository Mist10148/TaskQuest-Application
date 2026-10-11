/**
 * Space Invaders simulator: a TypeScript mirror of packages/shared/src/games/invaders.js
 * (60 steps per second). Change both together (the parity test checks it).
 */
import { createRng } from "./rng";

export const STEP_MS = 1000 / 60;
export const INPUT = { LEFT_DOWN: 1, LEFT_UP: 2, RIGHT_DOWN: 3, RIGHT_UP: 4, SHOOT: 5 } as const;
export const SHOT_COOLDOWN_STEPS = 15; // 250 ms at 60 steps per second

export interface Alien {
  x: number;
  y: number;
  alive: boolean;
}

export interface InvadersState {
  tick: number;
  over: boolean;
  won: boolean;
  score: number;
  player: { x: number; y: number };
  bullets: { x: number; y: number }[];
  aliens: Alien[];
  alienDir: number;
  alienSpeed: number;
  keys: { left: boolean; right: boolean };
  lastShotTick: number;
}

export function create(seed: number): InvadersState {
  const rng = createRng(seed);
  const offset = Math.floor(rng() * 5) * 10;
  const alienDir = rng() < 0.5 ? -1 : 1;
  const aliens: Alien[] = [];
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
    lastShotTick: -1000,
  };
}

/** True when a SHOOT input given now (during the next step) would fire a bullet. */
export function canShoot(state: InvadersState): boolean {
  return state.tick + 1 - state.lastShotTick >= SHOT_COOLDOWN_STEPS;
}

export function step(state: InvadersState, inputs: readonly number[] = []): void {
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
  const spent = new Set<number>();
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
