import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { isPendingConflict, withoutFailedTurn } from "./chatTurn";

describe("isPendingConflict", () => {
  it("is true only for an HTTP 409 ApiError", () => {
    expect(isPendingConflict(new ApiError("Confirm or cancel the pending action first", 409))).toBe(true);
    expect(isPendingConflict(new ApiError("Boom", 500))).toBe(false);
    expect(isPendingConflict(new Error("409"))).toBe(false);
    expect(isPendingConflict(undefined)).toBe(false);
  });
});

describe("withoutFailedTurn", () => {
  const u = { role: "user" as const, text: "hi" };
  const empty = { role: "assistant" as const, text: "" };

  it("drops the rejected user message and the empty placeholder", () => {
    const earlier = [{ role: "user" as const, text: "a" }, { role: "assistant" as const, text: "b" }];
    expect(withoutFailedTurn([...earlier, u, empty])).toEqual(earlier);
    expect(withoutFailedTurn([u, empty])).toEqual([]);
  });

  it("keeps a placeholder that already received text", () => {
    const answered = [u, { role: "assistant" as const, text: "partial" }];
    expect(withoutFailedTurn(answered)).toBe(answered);
  });
});
