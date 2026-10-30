import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListWithItems } from "@/lib/api";

const { toggle } = vi.hoisted(() => ({ toggle: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), itemsApi: { toggle } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));

import { useToggleItem } from "./useApi";

const listWith = (done: boolean): ListWithItems =>
  ({ id: 1, name: "Chores", items: [{ id: 5, list_id: 1, name: "Bin", completed: done }, { id: 6, list_id: 1, name: "Plants", completed: false }] }) as unknown as ListWithItems;

function setup(done = false) {
  const qc = new QueryClient();
  qc.setQueryData(["lists", 1], listWith(done));
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useToggleItem(), { wrapper });
  const completedOf = (id: number) => qc.getQueryData<ListWithItems>(["lists", 1])?.items.find((i) => i.id === id)?.completed;
  return { qc, result, completedOf };
}

describe("useToggleItem", () => {
  beforeEach(() => { toggle.mockClear(); });

  it("flips the row at once when the wanted state is explicit", async () => {
    let finish: (v: unknown) => void = () => {};
    toggle.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result, completedOf } = setup();
    act(() => void result.current.mutate({ itemId: 5, completed: true }));
    await waitFor(() => expect(completedOf(5)).toBe(true));
    expect(completedOf(6)).toBe(false);
    await act(async () => finish({ id: 5, completed: true, newAchievements: [] }));
  });

  it("puts the row back when the server refuses", async () => {
    toggle.mockImplementation(async () => {
      throw new Error("nope");
    });
    const { result, completedOf } = setup();
    act(() => void result.current.mutate({ itemId: 5, completed: true }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(completedOf(5)).toBe(false);
  });

  it("a failed toggle puts back only its own task, not one changed meanwhile", async () => {
    let failFirst: (e: unknown) => void = () => {};
    toggle
      .mockReturnValueOnce(new Promise((_resolve, reject) => { failFirst = reject; }))
      .mockResolvedValueOnce({ id: 6, completed: true, newAchievements: [] });
    const { qc, completedOf } = setup();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const a = renderHook(() => useToggleItem(), { wrapper }).result;
    const b = renderHook(() => useToggleItem(), { wrapper }).result;
    act(() => void a.current.mutate({ itemId: 5, completed: true }));
    await waitFor(() => expect(completedOf(5)).toBe(true));
    act(() => void b.current.mutate({ itemId: 6, completed: true }));
    await waitFor(() => expect(b.current.isSuccess).toBe(true));
    await act(async () => failFirst(new Error("nope")));
    await waitFor(() => expect(a.current.isError).toBe(true));
    expect(completedOf(5)).toBe(false);
    expect(completedOf(6)).toBe(true);
  });

  it("does not guess when only an id is given", async () => {
    let finish: (v: unknown) => void = () => {};
    toggle.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result, completedOf } = setup();
    act(() => void result.current.mutate(5));
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(5));
    expect(completedOf(5)).toBe(false);
    await act(async () => finish({ id: 5, completed: false, newAchievements: [] }));
  });
});
