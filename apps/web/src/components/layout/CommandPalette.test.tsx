import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_PALETTE_EVENT } from "@/lib/commands";
import { CommandPalette } from "./CommandPalette";

const searchTasks = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listsApi: { ...actual.listsApi, searchTasks: (q: string) => searchTasks(q) } };
});

const Where = () => <p data-testid="where">{useLocation().pathname + useLocation().search}</p>;

const open = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette aiEnabled={false} />
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
});

