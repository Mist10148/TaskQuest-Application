import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setUserZone } from "@/lib/dates";
import { useLocalToday } from "./useLocalToday";

describe("useLocalToday", () => {
  afterEach(() => { vi.useRealTimers(); setUserZone(null); });

  it("moves on to the next day while the page stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 10, 23, 59, 30));
    const { result } = renderHook(() => useLocalToday());
    expect(result.current).toBe("2030-01-10");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current).toBe("2030-01-11");
  });

  it("follows a time zone change at once, without waiting for the next check", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-10T23:30:00Z"));
    setUserZone("UTC");
    const { result } = renderHook(() => useLocalToday());
    expect(result.current).toBe("2030-01-10");
    act(() => setUserZone("Asia/Manila")); // already 07:30 on the 11th there
    expect(result.current).toBe("2030-01-11");
  });
});
