import { describe, expect, it } from "vitest";
import { barLayout, buildHeatmap, heatLevel, mondayIndex, shortDate, sumBy } from "./stats";
import type { XPHistoryDay } from "./api";

const day = (date: string, tasksCompleted: number, xp = 0): XPHistoryDay => ({ date, xp, tasksCompleted });

describe("mondayIndex", () => {
  it("counts Monday as 0 and Sunday as 6", () => {
    expect(mondayIndex("2026-10-05")).toBe(0); // Monday
    expect(mondayIndex("2026-10-11")).toBe(6); // Sunday
  });
});

describe("heatLevel", () => {
  it("is 0 for no activity and scales to 4", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(3, 0)).toBe(0);
  });
});

describe("buildHeatmap", () => {
  it("builds 12 Monday-first columns of 7 days ending in the current week", () => {
    const grid = buildHeatmap([], "2026-10-07", 12); // a Wednesday
    expect(grid).toHaveLength(12);
    expect(grid.every((c) => c.length === 7)).toBe(true);
    expect(grid[0][0].date).toBe("2026-07-20"); // Monday 11 weeks before this week's Monday (2026-10-05)
    expect(grid[11][0].date).toBe("2026-10-05");
    expect(grid[11][2]).toMatchObject({ date: "2026-10-07", future: false });
    expect(grid[11][3].future).toBe(true);
  });

  it("places counts on their day and zero-fills the rest", () => {
    const grid = buildHeatmap([day("2026-10-07", 4), day("2026-10-06", 1)], "2026-10-07", 12);
    expect(grid[11][2]).toMatchObject({ count: 4, level: 4 });
    expect(grid[11][1]).toMatchObject({ count: 1, level: 1 });
    expect(grid[0][0]).toMatchObject({ count: 0, level: 0 });
  });

  it("never shows activity on future cells", () => {
    const grid = buildHeatmap([day("2026-10-09", 9)], "2026-10-07", 12);
    expect(grid[11][4]).toMatchObject({ future: true, count: 0, level: 0 });
  });
});

describe("barLayout", () => {
  it("scales the tallest bar to the full height", () => {
    const bars = barLayout([0, 5, 10], 90, 100, 0);
    expect(bars.map((b) => b.height)).toEqual([0, 50, 100]);
    expect(bars[2].y).toBe(0);
    expect(bars[1].x).toBe(30);
  });
  it("keeps tiny non-zero values visible and handles empty input", () => {
    expect(barLayout([1, 1000], 20, 100, 0)[0].height).toBe(2);
    expect(barLayout([], 20, 100)).toEqual([]);
    expect(barLayout([0, 0], 20, 100).every((b) => b.height === 0)).toBe(true);
  });
});

describe("formatters", () => {
  it("formats a date without time zone drift", () => {
    expect(shortDate("2026-03-05")).toBe("Mar 5");
  });
  it("sums a field", () => {
    expect(sumBy([day("a", 1, 10), day("b", 2, 5)], "xp")).toBe(15);
    expect(sumBy([day("a", 1, 10), day("b", 2, 5)], "tasksCompleted")).toBe(3);
  });
});
