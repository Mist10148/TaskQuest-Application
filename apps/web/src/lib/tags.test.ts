import { describe, expect, it } from "vitest";
import { parseTags } from "./tags";

describe("parseTags", () => {
  it("trims, drops empties and removes duplicates (ignoring case)", () => {
    expect(parseTags("work, home,,Work , ")).toEqual(["work", "home"]);
  });

  it("reads nothing from an empty value", () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });
});
