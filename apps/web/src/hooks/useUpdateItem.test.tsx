import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListWithItems } from "@/lib/api";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), itemsApi: { update } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));

import { useUpdateItem } from "./useApi";

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(["lists", 1], { id: 1, name: "Chores", items: [{ id: 5, list_id: 1, name: "Bin", priority: "LOW", completed: false }] } as unknown as ListWithItems);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useUpdateItem(), { wrapper });
  const priorityOf = () => qc.getQueryData<ListWithItems>(["lists", 1])?.items[0].priority;
  return { result, priorityOf };
}

describe("useUpdateItem", () => {
  beforeEach(() => {
    update.mockClear();
  });

  it("moves a card to its new priority at once", async () => {
    let finish: (v: unknown) => void = () => {};
    update.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result, priorityOf } = setup();
    act(() => void result.current.mutate({ itemId: 5, data: { priority: "HIGH" } }));
    await waitFor(() => expect(priorityOf()).toBe("HIGH"));
    await act(async () => finish({}));
  });

  it("puts the priority back when the server refuses", async () => {
    update.mockImplementation(async () => {
      throw new Error("nope");
    });
    const { result, priorityOf } = setup();
    act(() => void result.current.mutate({ itemId: 5, data: { priority: "HIGH" } }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(priorityOf()).toBe("LOW");
  });

  it("leaves other edits to the server's answer", async () => {
    let finish: (v: unknown) => void = () => {};
    update.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { result, priorityOf } = setup();
    act(() => void result.current.mutate({ itemId: 5, data: { priority: "HIGH", due_date: "2030-01-01" } }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(priorityOf()).toBe("LOW");
    await act(async () => finish({}));
  });
});
