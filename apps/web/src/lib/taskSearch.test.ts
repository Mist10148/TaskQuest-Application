import { describe, expect, it } from "vitest";
import { searchableQuery, snippetAround } from "./taskSearch";

describe("searchableQuery", () => {
  it("needs two characters after trimming", () => {
    expect(searchableQuery("")).toBeNull();
    expect(searchableQuery(" a ")).toBeNull();
    expect(searchableQuery("  ab ")).toBe("ab");
  });
});

describe("snippetAround", () => {
  const long = `${"intro ".repeat(20)}the vinegar step${" outro".repeat(20)}`;
  it("centres on the match with ellipses", () => {
    const s = snippetAround(long, "VINEGAR", 10);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("vinegar");
    expect(s.length).toBeLessThan(40);
  });
  it("returns short text whole and collapses whitespace", () => {
    expect(snippetAround("use\n  vinegar", "vinegar")).toBe("use vinegar");
    expect(snippetAround(null, "x")).toBe("");
  });
  it("falls back to the start when the match is not in the text", () => {
    expect(snippetAround("a".repeat(200), "zzz", 10)).toBe(`${"a".repeat(20)}…`);
  });
});
