import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_PALETTE_EVENT } from "@/lib/commands";
import { CommandPalette } from "./CommandPalette";

const searchTasks = vi.fn();
const focusGet = vi.fn();
const focusStart = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    listsApi: { ...actual.listsApi, searchTasks: (q: string) => searchTasks(q) },
    focusApi: { ...actual.focusApi, get: () => focusGet(), start: (m: number) => focusStart(m) },
  };
});

const Where = () => <p data-testid="where">{useLocation().pathname + useLocation().search}</p>;

const open = async (xpEnabled = true) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette aiEnabled={false} xpEnabled={xpEnabled} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  act(() => { window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)); });
  return screen.findByRole("combobox", { name: "Search commands" });
};

describe("CommandPalette task search", () => {
  beforeEach(() => searchTasks.mockReset());

  it("does not search for fewer than two characters", async () => {
    const input = await open();
    await userEvent.type(input, "r");
    await new Promise((r) => setTimeout(r, 400));
    expect(searchTasks).not.toHaveBeenCalled();
  });

  it("lists matching tasks with their quest and opens that quest", async () => {
    searchTasks.mockResolvedValue({ lists: [], tasks: [{ id: 5, name: "Pay rent", description: null, completed: false, parent_id: null, due_date: null, list_id: 42, list_name: "Home" }] });
    const input = await open();
    await userEvent.type(input, "rent");
    const hit = await screen.findByRole("option", { name: /Pay rent/ });
    expect(hit).toHaveTextContent("Home");
    await userEvent.click(hit);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/tasks?list=42"));
    expect(searchTasks).toHaveBeenCalledWith("rent");
  });

  it("says it is searching instead of 'no match' while task results are on their way", async () => {
    let answer: (value: unknown) => void = () => undefined;
    searchTasks.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const input = await open();
    await userEvent.type(input, "zzzz");
    expect(screen.getByRole("status")).toHaveTextContent("Searching tasks…");
    await act(async () => answer({ lists: [], tasks: [] }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No matching command."));
  });

  it("opens blank again after Ctrl+K closed it", async () => {
    searchTasks.mockResolvedValue({ lists: [], tasks: [] });
    const input = await open();
    await userEvent.type(input, "set");
    await userEvent.keyboard("{Control>}k{/Control}");
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
    act(() => { window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)); });
    expect(await screen.findByRole("combobox", { name: "Search commands" })).toHaveValue("");
  });
  it("starts a 25-minute focus session and shows it", async () => {
    focusGet.mockResolvedValue({ active: null });
    focusStart.mockResolvedValue({ sessionId: 1 });
    const input = await open();
    await userEvent.type(input, "25-minute");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/focus"));
    expect(focusStart).toHaveBeenCalledWith(25);
  });

  it("does not cancel a session that is already running", async () => {
    focusStart.mockReset();
    focusGet.mockResolvedValue({ active: { id: 3 } });
    const input = await open();
    await userEvent.type(input, "25-minute");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/focus"));
    expect(focusStart).not.toHaveBeenCalled();
  });

  it("offers the daily reward only with XP on", async () => {
    searchTasks.mockResolvedValue({ lists: [], tasks: [] });
    const input = await open(false);
    await userEvent.type(input, "daily reward");
    expect(screen.queryByRole("option", { name: /Claim daily reward/ })).toBeNull();
  });

  it("asks the server before starting, even with a fresh 'no session' in the cache", async () => {
    focusStart.mockReset();
    focusGet.mockResolvedValue({ active: { id: 9 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    client.setQueryData(["focus"], { active: null });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CommandPalette aiEnabled={false} />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    act(() => { window.dispatchEvent(new Event(OPEN_PALETTE_EVENT)); });
    await userEvent.type(await screen.findByRole("combobox", { name: "Search commands" }), "25-minute");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/focus"));
    expect(focusGet).toHaveBeenCalled();
    expect(focusStart).not.toHaveBeenCalled();
  });

  it("Ctrl+K does not open on top of another dialog", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <div role="dialog" aria-label="Edit task" />
          <CommandPalette aiEnabled={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("combobox", { name: "Search commands" })).toBeNull();
  });
});
