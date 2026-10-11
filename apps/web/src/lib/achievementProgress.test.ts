import { describe, expect, it } from "vitest";
import { achievementProgress, cappedDelay, type AchievementStats } from "./achievementProgress";

const stats: AchievementStats = { lists: 3, items: 120, completed: 7, lifetimeXP: 450, level: 5, streak: 0, gamesWon: 2 };

describe("achievementProgress", () => {
  it("reports current and goal with a percentage", () => {
    expect(achievementProgress("FIVE_LISTS", stats)).toEqual({ current: 3, goal: 5, unit: "lists", percent: 60 });
    expect(achievementProgress("XP_500", stats)).toMatchObject({ current: 450, goal: 500, percent: 90 });
  });
  it("never exceeds the goal", () => {
    expect(achievementProgress("TEN_ITEMS", stats)).toMatchObject({ current: 10, percent: 100 });
  });
  it("returns null for achievements without client-side data", () => {
    expect(achievementProgress("SPEND_1000", stats)).toBeNull();
    expect(achievementProgress("SOME_NEW_ONE", stats)).toBeNull();
  });
  it("tolerates missing numbers", () => {
    expect(achievementProgress("STREAK_3", stats)).toMatchObject({ current: 0, percent: 0 });
    expect(achievementProgress("LEVEL_10", { ...stats, level: Number.NaN })).toMatchObject({ current: 0 });
  });
});

describe("cappedDelay", () => {
  it("grows with the index, then stops at the cap", () => {
    expect(cappedDelay(0.2, 2, 0.05)).toBeCloseTo(0.3);
    expect(cappedDelay(0.2, 100, 0.05)).toBe(0.6);
  });
});
