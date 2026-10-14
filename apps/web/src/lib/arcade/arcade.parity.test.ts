// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRng } from "./rng";
import { createRecorder, dino, invaders, replay, snake, type ArcadeKind } from "./index";

/**
 * The shared node tests replay these same recorded runs through the JavaScript simulators
 * (packages/shared/test/arcade.test.js). If a rule changes on one side only, one of the two fails.
 */
interface Fixture {
  game: ArcadeKind;
  seed: number;
  ticks: number;
  score: number;
  inputs: number[];
}

const fixtures: Fixture[] = JSON.parse(readFileSync(new URL("../../../../../packages/shared/test/fixtures/arcade-timelines.json", import.meta.url), "utf8"));

describe("arcade simulators (web) match the shared ones", () => {
  it("has fixtures for every game", () => {
    expect(new Set(fixtures.map((f) => f.game))).toEqual(new Set(["snake", "dino", "invaders"]));
    expect(fixtures.length).toBeGreaterThanOrEqual(9);
  });

  it.each(fixtures.map((f) => [f.game, f.seed, f] as const))("%s seed %i replays to the recorded score and length", (_game, _seed, f) => {
    const out = replay(f.game, f.seed, f.ticks, f.inputs);
    expect(out).toEqual({ score: f.score, tick: f.ticks, over: true });
  });

  it("uses the same random stream as the server", () => {
    expect(createRng(1)()).toBe(0.6270739405881613);
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 20 }, () => a())).toEqual(Array.from({ length: 20 }, () => b()));
  });

  it("a different seed does not replay the same run", () => {
    const f = fixtures.find((x) => x.game === "dino" && x.score >= 20)!;
    const out = replay("dino", f.seed + 1, f.ticks, f.inputs);
    expect(out.score === f.score && out.tick === f.ticks).toBe(false);
  });
});

describe("arcade simulators (web) rules", () => {
  it("snake: no input hits the wall on step 10; reversals are ignored", () => {
    const s = snake.create(7);
    snake.step(s, [snake.INPUT.LEFT]);
    expect(s.dir).toEqual({ x: 1, y: 0 });
    for (let i = 0; i < 9; i++) snake.step(s, []);
    expect([s.over, s.tick, s.score]).toEqual([true, 10, 0]);
  });

  it("dino: one jump at a time, standing still never scores", () => {
    const d = dino.create(5);
    dino.step(d, [dino.INPUT.JUMP]);
    expect(d.dino.jumping).toBe(true);
    const vy = d.dino.vy;
    dino.step(d, [dino.INPUT.JUMP]);
    expect(d.dino.vy).toBeGreaterThan(vy);
    const idle = dino.create(11);
    while (!idle.over) dino.step(idle, []);
    expect(idle.score).toBe(0);
  });

  it("invaders: the shot cooldown counts steps and canShoot predicts it", () => {
    const s = invaders.create(2);
    expect(invaders.canShoot(s)).toBe(true);
    invaders.step(s, [invaders.INPUT.SHOOT, invaders.INPUT.SHOOT]);
    expect(s.bullets).toHaveLength(1);
    expect(invaders.canShoot(s)).toBe(false);
    for (let i = 0; i < invaders.SHOT_COOLDOWN_STEPS; i++) invaders.step(s, []);
    expect(invaders.canShoot(s)).toBe(true);
  });
});

describe("recorder", () => {
  it("records [step, code] pairs and copies them out", () => {
    const r = createRecorder();
    r.record(0, 3);
    r.record(12, 1);
    const t = r.finish(4, 90);
    r.record(13, 2);
    expect(t).toEqual({ score: 4, ticks: 90, inputs: [0, 3, 12, 1] });
  });
});
