/**
 * Arcade telemetry: the browser plays the shared deterministic simulators and
 * records every input with the step it was given on. The server replays that
 * timeline from the run's seed and pays on the score it derives itself
 * (docs/design/arcade-anti-cheat.md).
 */
import * as snake from "./snake";
import * as dino from "./dino";
import * as invaders from "./invaders";

export { snake, dino, invaders };

export type ArcadeKind = "snake" | "dino" | "invaders";

/** What the server needs to verify a run: the score is only a claim, the inputs are the evidence. */
export interface ArcadeTelemetry {
  score: number;
  /** Simulation steps the run lasted (it ends on game over, on exactly this step). */
  ticks: number;
  /** Flat [step, code, step, code, ...]: an input at step t was given during step t (0-based). */
  inputs: number[];
}

/** Collects the input timeline of one run. */
export function createRecorder() {
  const inputs: number[] = [];
  return {
    /** Record that `code` was given while the simulation was about to run step number `tick`. */
    record(tick: number, code: number) {
      inputs.push(tick, code);
    },
    finish(score: number, ticks: number): ArcadeTelemetry {
      return { score, ticks, inputs: inputs.slice() };
    },
  };
}

/** The simulator contract the game components and the replay share. */
interface Simulator<S extends { tick: number; over: boolean; score: number }> {
  create(seed: number): S;
  step(state: S, inputs?: readonly number[]): void;
}

const SIMULATORS = { snake, dino, invaders } as unknown as Record<ArcadeKind, Simulator<{ tick: number; over: boolean; score: number }>>;

/**
 * Re-run a recorded timeline the way the server does. Used by the parity test
 * to prove the TypeScript simulators agree with the JavaScript ones.
 */
export function replay(kind: ArcadeKind, seed: number, ticks: number, inputs: readonly number[]): { score: number; tick: number; over: boolean } {
  const sim = SIMULATORS[kind];
  const state = sim.create(seed);
  let next = 0;
  for (let t = 0; t < ticks; t++) {
    const now: number[] = [];
    while (next < inputs.length && inputs[next] === t) {
      now.push(inputs[next + 1]);
      next += 2;
    }
    sim.step(state, now);
    if (state.over) break;
  }
  return { score: state.score, tick: state.tick, over: state.over };
}
