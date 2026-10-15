import { describe, expect, it } from "vitest";
import { swipeAction, swipeOffset } from "./swipe";

describe("swipeAction", () => {
  it("completes on a long, mostly sideways swipe to the right", () => {
    expect(swipeAction(120, 10)).toBe("complete");
    expect(swipeAction(80, 0)).toBe("complete");
  });
  it("ignores short swipes, left swipes and scrolling", () => {
    expect(swipeAction(60, 0)).toBeNull();
    expect(swipeAction(-150, 0)).toBeNull();
    expect(swipeAction(120, 100)).toBeNull();
    expect(swipeAction(0, 0)).toBeNull();
  });
});

describe("swipeOffset", () => {
  it("follows the finger to the right, up to a limit", () => {
    expect(swipeOffset(30, 2)).toBe(30);
    expect(swipeOffset(500, 0)).toBe(112);
  });
  it("does not move for vertical or leftward drags", () => {
    expect(swipeOffset(40, 60)).toBe(0);
    expect(swipeOffset(-40, 0)).toBe(0);
  });
});
