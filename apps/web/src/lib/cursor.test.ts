import { describe, expect, it } from "vitest";
import { stepCursor } from "./cursor";

describe("stepCursor", () => {
  const order = [10, 11, 12];

  it("starts at the top going down and the bottom going up", () => {
    expect(stepCursor(order, null, 1)).toBe(10);
    expect(stepCursor(order, null, -1)).toBe(12);
  });

  it("moves one row and stops at the ends", () => {
    expect(stepCursor(order, 10, 1)).toBe(11);
    expect(stepCursor(order, 12, 1)).toBe(12);
    expect(stepCursor(order, 10, -1)).toBe(10);
    expect(stepCursor(order, 12, -1)).toBe(11);
  });

  it("recovers when the row it was on is gone, and handles an empty list", () => {
    expect(stepCursor(order, 99, 1)).toBe(10);
    expect(stepCursor([], 10, 1)).toBeNull();
  });
});
