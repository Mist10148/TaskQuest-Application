import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFixedLoop } from "./gameLoop";

/** A controllable requestAnimationFrame clock. */
function fakeFrames() {
  let now = 0;
  let callback: FrameRequestCallback | null = null;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    callback = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    callback = null;
  });
  return {
    /** Advance the clock and run one animation frame. */
    frame(ms: number) {
      now += ms;
      const cb = callback;
      callback = null;
      cb?.(now);
    },
    isRunning: () => callback !== null,
  };
}

describe("startFixedLoop", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("steps once per interval no matter how fast frames arrive", () => {
    const frames = fakeFrames();
    const step = vi.fn();
    const stop = startFixedLoop(step, 100);
    for (let i = 0; i < 10; i++) frames.frame(16); // 160 ms on a 60 Hz display
    expect(step).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) frames.frame(8); // +80 ms on a 120 Hz display
    expect(step).toHaveBeenCalledTimes(2);
    stop();
  });

  it("catches up a little after a slow frame, then gives up the backlog", () => {
    const frames = fakeFrames();
    const step = vi.fn();
    const stop = startFixedLoop(step, 50);
    frames.frame(200); // 4 steps owed
    expect(step).toHaveBeenCalledTimes(4);
    step.mockClear();
    frames.frame(5000); // a long stall is capped at 250 ms (5 steps) and the rest is dropped
    expect(step).toHaveBeenCalledTimes(5);
    frames.frame(10);
    expect(step).toHaveBeenCalledTimes(5);
    stop();
  });

  it("stops scheduling frames after stop()", () => {
    const frames = fakeFrames();
    const step = vi.fn();
    const stop = startFixedLoop(step, 10);
    stop();
    expect(frames.isRunning()).toBe(false);
    frames.frame(100);
    expect(step).not.toHaveBeenCalled();
  });
});
