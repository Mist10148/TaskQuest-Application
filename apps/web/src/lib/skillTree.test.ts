import { describe, expect, it } from "vitest";
import { skillDepth, skillTiers } from "./skillTree";

const tree = [
  { id: "boost", requires: null },
  { id: "daily", requires: "boost" },
  { id: "momentum", requires: "boost" },
  { id: "shield", requires: "daily" },
  { id: "freeze", requires: "shield" },
];

describe("skillTiers", () => {
  it("groups skills by the length of their prerequisite chain", () => {
    expect(skillTiers(tree).map((t) => t.map((s) => s.id))).toEqual([["boost"], ["daily", "momentum"], ["shield"], ["freeze"]]);
  });
  it("keeps the listed order inside a tier and treats an unknown prerequisite as a root", () => {
    expect(skillTiers([{ id: "a", requires: "ghost" }, { id: "b", requires: null }]).map((t) => t.map((s) => s.id))).toEqual([["a", "b"]]);
  });
  it("handles an empty tree and a cycle without looping", () => {
    expect(skillTiers([])).toEqual([]);
    const cycle = [{ id: "x", requires: "y" }, { id: "y", requires: "x" }];
    expect(skillDepth(cycle[0], new Map(cycle.map((s) => [s.id, s])))).toBeLessThan(3);
  });
});
