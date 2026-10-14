import { describe, expect, it } from "vitest";
import { isSessionExpired } from "./session";

describe("isSessionExpired", () => {
  it("is true for a 401 API error only", () => {
    expect(isSessionExpired({ status: 401 })).toBe(true);
    expect(isSessionExpired({ status: 403 })).toBe(false);
    expect(isSessionExpired({ status: 500 })).toBe(false);
    expect(isSessionExpired(new Error("x"))).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
    expect(isSessionExpired(undefined)).toBe(false);
  });
});
