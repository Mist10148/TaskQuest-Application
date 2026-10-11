import { describe, expect, it } from "vitest";
import { isPrestigeConfirmation, lifetimeTotal } from "./prestige";

describe("isPrestigeConfirmation", () => {
  it("needs the exact word", () => {
    expect(isPrestigeConfirmation("PRESTIGE")).toBe(true);
    expect(isPrestigeConfirmation("  PRESTIGE ")).toBe(true);
    expect(isPrestigeConfirmation("prestige")).toBe(false);
    expect(isPrestigeConfirmation("PRESTIG")).toBe(false);
    expect(isPrestigeConfirmation("")).toBe(false);
  });
});

describe("lifetimeTotal", () => {
  it("prefers the never-reset total once it is larger", () => {
    expect(lifetimeTotal({ lifetime_xp: 120, lifetime_xp_total: 5120 })).toBe(5120);
  });
  it("falls back to lifetime_xp on servers without the total", () => {
    expect(lifetimeTotal({ lifetime_xp: 350 })).toBe(350);
    expect(lifetimeTotal({ player_xp: 40 })).toBe(40);
    expect(lifetimeTotal({})).toBe(0);
  });
  it("never reports less than the level-driving counter", () => {
    expect(lifetimeTotal({ lifetime_xp: 900, lifetime_xp_total: 100 })).toBe(900);
  });
});
