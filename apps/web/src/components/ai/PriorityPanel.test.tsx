import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiPriorityResult } from "@/lib/api";

const api = vi.hoisted(() => ({ prioritize: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), aiApi: api }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { features: { ai: true } } }) }));
vi.mock("@/lib/push", () => ({ announceResult: vi.fn() }));

import { PriorityPanel } from "./PriorityPanel";

const ranking = (n: number): AiPriorityResult =>
  ({
    ranked: Array.from({ length: n }, (_, i) => ({ id: `q${i + 1}`, listId: i + 1, rank: i + 1, name: `Quest ${i + 1}`, reason: "due soon", suggestedPriority: null })),
    focusMessage: "",
    usedFallback: false,
  }) as unknown as AiPriorityResult;

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PriorityPanel />
    </QueryClientProvider>
  );

describe("PriorityPanel", () => {
  beforeEach(() => api.prioritize.mockReset());

  it("ranks five quests, then asks for up to ten on Show more", async () => {
    api.prioritize.mockImplementation(async (limit: number) => ranking(limit === 10 ? 8 : 5));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Prioritize my quests" }));
    expect(await screen.findByText("Quest 5")).toBeInTheDocument();
    expect(api.prioritize).toHaveBeenLastCalledWith(5);
    await userEvent.click(screen.getByRole("button", { name: "Show up to 10" }));
    expect(await screen.findByText("Quest 8")).toBeInTheDocument();
    expect(api.prioritize).toHaveBeenLastCalledWith(10);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show up to 10" })).toBeNull());
  });

  it("offers no more when the first ranking already holds every open quest", async () => {
    api.prioritize.mockResolvedValue(ranking(3));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Prioritize my quests" }));
    expect(await screen.findByText("Quest 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show up to 10" })).toBeNull();
  });
});
