import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUndoableDelete } from "./useUndoableDelete";

vi.mock("sonner", () => ({ toast: vi.fn() }));

describe("useUndoableDelete", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("deletes after the undo window", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useUndoableDelete(run, 1000));
    act(() => result.current.request([1, 2], "Deleted"));
    expect(run).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("sends pending deletes through flush when the page is hidden, and only once", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const flush = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useUndoableDelete(run, 6000, flush));
    act(() => result.current.request([7], "Deleted"));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(flush).toHaveBeenCalledWith(7);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(run).not.toHaveBeenCalled();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
