import { describe, expect, it } from "vitest";
import { nextRadioIndex } from "./radioGroup";

describe("nextRadioIndex", () => {
  it("moves forward and back with the arrows, wrapping at both ends", () => {
    expect(nextRadioIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextRadioIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextRadioIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(nextRadioIndex("ArrowUp", 1, 3)).toBe(0);
  });

  it("jumps to the ends with Home and End", () => {
    expect(nextRadioIndex("Home", 2, 3)).toBe(0);
    expect(nextRadioIndex("End", 0, 3)).toBe(2);
  });

  it("ignores other keys and empty groups", () => {
    expect(nextRadioIndex("Enter", 0, 3)).toBeNull();
    expect(nextRadioIndex("ArrowRight", 0, 0)).toBeNull();
  });
});
