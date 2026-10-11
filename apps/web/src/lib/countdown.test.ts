import { describe, expect, it } from "vitest";
import { DAILY_COOLDOWN_MS, formatCountdown, formatLongCountdown, nextClaimAt } from "./countdown";

describe("formatCountdown", () => {
  it("formats hours and minutes", () => {
    expect(formatCountdown(5 * 3600_000 + 12 * 60_000)).toBe("5h 12m");
  });
  it("drops zero minutes or hours", () => {
    expect(formatCountdown(2 * 3600_000)).toBe("2h");
    expect(formatCountdown(45 * 60_000)).toBe("45m");
  });
  it("rounds partial minutes up", () => {
    expect(formatCountdown(1)).toBe("1m");
    expect(formatCountdown(61_000)).toBe("2m");
  });
  it("is 'now' when nothing is left", () => {
    expect(formatCountdown(0)).toBe("now");
    expect(formatCountdown(-5)).toBe("now");
    expect(formatCountdown(Number.NaN)).toBe("now");
  });
});

describe("nextClaimAt", () => {
  it("adds the rolling 24h cooldown", () => {
    expect(nextClaimAt(1000)).toBe(1000 + DAILY_COOLDOWN_MS);
  });
  it("is null when never claimed", () => {
    expect(nextClaimAt(0)).toBeNull();
    expect(nextClaimAt(null)).toBeNull();
  });
});

describe("formatLongCountdown", () => {
  it("adds days for long waits", () => {
    expect(formatLongCountdown(3 * 86_400_000 + 4 * 3600_000)).toBe("3d 4h");
    expect(formatLongCountdown(2 * 86_400_000)).toBe("2d");
  });
  it("matches formatCountdown below a day and says now when over", () => {
    expect(formatLongCountdown(5 * 3600_000 + 12 * 60_000)).toBe("5h 12m");
    expect(formatLongCountdown(0)).toBe("now");
  });
});
