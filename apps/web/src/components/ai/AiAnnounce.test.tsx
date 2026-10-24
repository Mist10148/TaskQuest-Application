import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSummary } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useSummary: vi.fn(),
  usePrioritize: vi.fn(),
  useUpdateList: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { features: { ai: true } } }) }));
const announceResult = vi.hoisted(() => vi.fn());
vi.mock("@/lib/push", () => ({ announceResult }));

import { PriorityPanel } from "./PriorityPanel";
import { SummarizeButton } from "./SummarizeButton";

const summary: AiSummary = { mode: "list", headline: "Math is half done", highlights: [], blockers: [], next_steps: [], referenced_ids: [], cached: false };

describe("announcing a finished AI result", () => {
  beforeEach(() => {
    announceResult.mockReset().mockResolvedValue(true);
    hooks.useUpdateList.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it("the summary button announces its headline when the summary arrives", async () => {
    const mutate = vi.fn((_body, options) => options?.onSuccess?.(summary));
    hooks.useSummary.mockReturnValue({ mutate, isPending: false, isError: false, data: undefined });
    render(<SummarizeButton body={{ mode: "list", list_id: 1 } as never} />);
    await userEvent.click(screen.getByRole("button", { name: /summarize/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(announceResult).toHaveBeenCalledWith({ title: "Your summary is ready", body: "Math is half done" });
  });

  it("nothing is announced when the summary fails", async () => {
    const mutate = vi.fn(); // onSuccess never runs
    hooks.useSummary.mockReturnValue({ mutate, isPending: false, isError: false, data: undefined });
    render(<SummarizeButton body={{ mode: "list", list_id: 1 } as never} />);
    await userEvent.click(screen.getByRole("button", { name: /summarize/i }));
    expect(announceResult).not.toHaveBeenCalled();
  });

  it("the priority panel announces the focus message, or the first quest, after a click", async () => {
    const ranked = [{ id: "L1", listId: 1, name: "Math homework", rank: 1, reason: "due soon", suggestedPriority: null }];
    const refetch = vi.fn().mockResolvedValue({ data: { ranked, focusMessage: "Start with math", usedFallback: false } });
    hooks.usePrioritize.mockReturnValue({ data: undefined, refetch, isFetching: false, error: null });
    render(<PriorityPanel />);
    await userEvent.click(screen.getByRole("button", { name: /prioritize my quests/i }));
    expect(announceResult).toHaveBeenCalledWith({ title: "Your priorities are ready", body: "Start with math" });

    announceResult.mockClear();
    refetch.mockResolvedValue({ data: { ranked, focusMessage: "", usedFallback: false } });
    await userEvent.click(screen.getByRole("button", { name: /prioritize my quests/i }));
    expect(announceResult).toHaveBeenCalledWith({ title: "Your priorities are ready", body: "Start with Math homework" });
  });

  it("the priority panel says nothing for an empty ranking or an error", async () => {
    const refetch = vi.fn().mockResolvedValue({ data: { ranked: [], focusMessage: "", usedFallback: false } });
    hooks.usePrioritize.mockReturnValue({ data: undefined, refetch, isFetching: false, error: null });
    render(<PriorityPanel />);
    await userEvent.click(screen.getByRole("button", { name: /prioritize my quests/i }));
    refetch.mockResolvedValue({ data: undefined, error: new Error("quota") });
    await userEvent.click(screen.getByRole("button", { name: /prioritize my quests/i }));
    expect(announceResult).not.toHaveBeenCalled();
  });

  it("accepting a suggested priority changes the quest without running the paid ranking again", async () => {
    const ranked = [{ id: "L1", listId: 1, name: "Math homework", rank: 1, reason: "due soon", suggestedPriority: "HIGH" }];
    const refetch = vi.fn();
    const mutateAsync = vi.fn().mockResolvedValue({});
    hooks.useUpdateList.mockReturnValue({ mutateAsync, isPending: false });
    hooks.usePrioritize.mockReturnValue({ data: { ranked, focusMessage: "", usedFallback: false }, refetch, isFetching: false, error: null });
    const onOpen = vi.fn();
    render(<PriorityPanel onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(mutateAsync).toHaveBeenCalledWith({ listId: 1, data: { priority: "HIGH" } });
    expect(refetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Math homework" }));
    expect(onOpen).toHaveBeenCalledWith(1);
  });
});
