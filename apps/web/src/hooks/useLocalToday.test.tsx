import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocalToday } from "./useLocalToday";

describe("useLocalToday", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("moves on to the next day while the page stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 10, 23, 59, 30));
    const { result } = renderHook(() => useLocalToday());
    expect(result.current).toBe("2030-01-10");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current).toBe("2030-01-11");
  });
});
