/**
 * Fixed-timestep game loop on requestAnimationFrame.
 *
 * `setInterval` runs at whatever pace the browser allows: games went faster or
 * slower with the device, kept ticking in background tabs and drifted. This runs
 * `step` exactly once every `stepMs` of real time regardless of the display's
 * refresh rate, and stops while the tab is hidden (rAF is paused by the browser;
 * the clock is reset on return so there is no burst of catch-up steps).
 *
 * @returns a function that stops the loop
 */
export function startFixedLoop(step: () => void, stepMs: number): () => void {
  const MAX_CATCH_UP_STEPS = 5;
  let raf = 0;
  let stopped = false;
  let last = performance.now();
  let accumulator = 0;

  const frame = (now: number) => {
    if (stopped) return;
    accumulator += Math.min(now - last, 250);
    last = now;
    let steps = 0;
    while (accumulator >= stepMs && steps < MAX_CATCH_UP_STEPS) {
      step();
      accumulator -= stepMs;
      steps++;
    }
    if (steps === MAX_CATCH_UP_STEPS) accumulator = 0; // far behind (slow device): drop the backlog instead of spiralling
    raf = requestAnimationFrame(frame);
  };

  const onVisibility = () => {
    last = performance.now();
    accumulator = 0;
  };

  document.addEventListener("visibilitychange", onVisibility);
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
