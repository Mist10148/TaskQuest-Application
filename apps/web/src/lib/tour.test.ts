import { describe, expect, it } from "vitest";
import { clampStep, hasSeenTour, markTourSeen, readTourStep, resetTour, saveTourStep, TOUR_STEPS, type TourStorage } from "./tour";

const fake = (): TourStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe("tour steps", () => {
  it("link only to in-app routes, each with a label", () => {
    for (const step of TOUR_STEPS) {
      if (step.to) {
        expect(step.to.startsWith("/")).toBe(true);
        expect(step.toLabel).toBeTruthy();
      }
    }
  });
  it("following a step link marks the tour seen, so a remounted layout does not restart it", () => {
    const s = fake();
    expect(hasSeenTour(s)).toBe(false);
    markTourSeen(s); // what OnboardingTour's link click does via finish()
    expect(hasSeenTour(s)).toBe(true);
  });
});

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

describe("tour step memory", () => {
  it("resumes the saved step and forgets it at step 0", () => {
    const s = fake();
    expect(readTourStep(s)).toBe(0);
    saveTourStep(2, s);
    expect(readTourStep(s)).toBe(2);
    saveTourStep(0, s);
    expect(readTourStep(s)).toBe(0);
  });
  it("ignores junk and clamps", () => {
    const s = fake();
    s.setItem("tq.tourStep", "abc");
    expect(readTourStep(s)).toBe(0);
    s.setItem("tq.tourStep", "99");
    expect(readTourStep(s)).toBe(TOUR_STEPS.length - 1);
    expect(readTourStep(null)).toBe(0);
  });
});
