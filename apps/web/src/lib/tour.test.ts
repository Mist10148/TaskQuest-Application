import { describe, expect, it } from "vitest";
import { clampStep, hasSeenTour, markTourSeen, resetTour, TOUR_STEPS, type TourStorage } from "./tour";

const fake = (): TourStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe("tour flag", () => {
  it("is unseen until marked, and can be reset", () => {
    const s = fake();
    expect(hasSeenTour(s)).toBe(false);
    markTourSeen(s);
    expect(hasSeenTour(s)).toBe(true);
    resetTour(s);
    expect(hasSeenTour(s)).toBe(false);
  });
  it("counts as seen (never nags) when storage is missing or throws", () => {
    expect(hasSeenTour(null)).toBe(true);
    const broken: TourStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(hasSeenTour(broken)).toBe(true);
    expect(() => markTourSeen(broken)).not.toThrow();
    expect(() => resetTour(broken)).not.toThrow();
  });
});

describe("tour steps", () => {
  it("has four steps", () => {
    expect(TOUR_STEPS).toHaveLength(4);
  });
  it("clamps the step index", () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(99)).toBe(3);
    expect(clampStep(2)).toBe(2);
  });
});
