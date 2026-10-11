/**
 * Snake simulator: a TypeScript mirror of packages/shared/src/games/snake.js.
 * The game component drives this on a fixed timestep and the server replays the
 * recorded inputs through the JS twin. Change both together (the parity test checks it).
 */
import { pickFreeCell, type Cell } from "../gameHelpers";
import { createRng } from "./rng";

export const STEP_MS = 100;
export const GRID_SIZE = 20;
export const INPUT = { UP: 1, DOWN: 2, LEFT: 3, RIGHT: 4 } as const;

export interface SnakeState {
  rng: () => number;
  tick: number;
  over: boolean;
  score: number;
  snake: Cell[];
  dir: Cell;
  lastDir: Cell;
  food: Cell;
}

export function create(seed: number): SnakeState {
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
    food: pickFreeCell(GRID_SIZE, snake, rng) ?? { x: 15, y: 15 },
  };
}

function applyInput(state: SnakeState, code: number) {
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
export function step(state: SnakeState, inputs: readonly number[] = []): void {
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
