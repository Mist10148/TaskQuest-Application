/**
 * Seeded PRNG (mulberry32). A TypeScript mirror of packages/shared/src/games/rng.js:
 * the web app cannot import the CommonJS shared package, so the arcade simulators
 * are kept in lock-step by arcade.parity.test.ts, which replays the recorded
 * timelines in packages/shared/test/fixtures against both.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
