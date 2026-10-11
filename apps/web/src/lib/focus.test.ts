import { describe, expect, it } from "vitest";
import { canFinish, elapsedMinutes, focusTitle, formatClock, minutesUntilPayable, parseMinutes, remainingMs } from "./focus";

describe("formatClock", () => {
  it("shows minutes and seconds under an hour", () => {
    expect(formatClock(25 * 60_000)).toBe("25:00");
    expect(formatClock(59_000)).toBe("00:59");
  });
  it("adds hours from 60 minutes on", () => {
    expect(formatClock(65 * 60_000)).toBe("1:05:00");
  });
  it("rounds partial seconds up and never goes negative", () => {
    expect(formatClock(1)).toBe("00:01");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-5000)).toBe("00:00");
  });
});

describe("remainingMs", () => {
  it("is the time to the end, floored at zero", () => {
    expect(remainingMs(10_000, 4_000)).toBe(6_000);
    expect(remainingMs(10_000, 12_000)).toBe(0);
  });
});

describe("finish rule", () => {
  const start = 1_000_000;
  it("pays from the minimum minutes on", () => {
    expect(canFinish(start, start + 9 * 60_000 + 59_000, 10)).toBe(false);
    expect(canFinish(start, start + 10 * 60_000, 10)).toBe(true);
  });
  it("counts whole elapsed minutes", () => {
    expect(elapsedMinutes(start, start + 119_000)).toBe(1);
    expect(elapsedMinutes(start, start - 5)).toBe(0);
  });
  it("tells how long until it pays", () => {
    expect(minutesUntilPayable(start, start, 10)).toBe(10);
    expect(minutesUntilPayable(start, start + 9 * 60_000 + 1, 10)).toBe(1);
    expect(minutesUntilPayable(start, start + 11 * 60_000, 10)).toBe(0);
  });
});

describe("parseMinutes", () => {
  it("accepts whole numbers inside the limits", () => {
    expect(parseMinutes("10", 10, 90)).toBe(10);
    expect(parseMinutes(" 90 ", 10, 90)).toBe(90);
  });
  it("rejects everything else", () => {
    for (const bad of ["", "9", "91", "25.5", "-20", "1e2", "abc", "0025x"]) expect(parseMinutes(bad, 10, 90)).toBeNull();
  });
});

describe("focusTitle", () => {
  it("puts the clock first", () => {
    expect(focusTitle(90_000, "TaskQuest")).toBe("01:30 · Focus – TaskQuest");
    expect(focusTitle(90_000, "")).toBe("01:30 · Focus");
  });
});
