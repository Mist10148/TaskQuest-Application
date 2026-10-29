import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ListWithItems } from "@/lib/api";

const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
const hooks = vi.hoisted(() => ({
  useLists: vi.fn(),
  useList: vi.fn(),
  useCreateList: vi.fn(),
  useUpdateList: vi.fn(),
  useDeleteList: vi.fn(),
  useCreateItem: vi.fn(),
  useToggleItem: vi.fn(),
  useUpdateItem: vi.fn(),
  useDeleteItem: vi.fn(),
  useReorderItems: vi.fn(),
  useMoveItem: vi.fn(),
  useListMembers: vi.fn(),
  invalidateProgress: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { features: { ai: false } } }) }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
// The page's own parts have their own tests: here they are stand-ins that show what the page gave them.
vi.mock("@/components/tasks/ListOverview", () => ({ ListOverview: () => <p>quest log</p> }));
vi.mock("@/components/tasks/ListDetail", () => ({
  ListDetail: ({ list, onBulkComplete }: { list: ListWithItems; onBulkComplete: (ids: number[]) => void }) => (
    <div>
      <p>quest {list.name}</p>
      <button type="button" onClick={() => onBulkComplete(list.items.map((i) => i.id))}>complete all</button>
    </div>
  ),
}));
vi.mock("@/components/tasks/ListFormDialog", () => ({ ListFormDialog: ({ open, mode }: { open: boolean; mode: string }) => (open ? <p>quest dialog {mode}</p> : null) }));
vi.mock("@/components/tasks/ItemFormDialog", () => ({ ItemFormDialog: ({ open }: { open: boolean }) => (open ? <p>task dialog</p> : null) }));
vi.mock("@/components/tasks/TemplatesDialog", () => ({ TemplatesDialog: () => null }));
vi.mock("@/components/tasks/SaveTemplateDialog", () => ({ SaveTemplateDialog: () => null }));
vi.mock("@/components/tasks/MembersDialog", () => ({ MembersDialog: () => null }));
vi.mock("@/components/tasks/ConfirmDeleteDialog", () => ({ ConfirmDeleteDialog: () => null }));

import Tasks from "./Tasks";

const quest = (over: Partial<ListWithItems> = {}) =>
  ({ id: 7, name: "Garden", role: "manager", isOwner: true, shared: false, items: [{ id: 1, name: "Dig", completed: 0 }, { id: 2, name: "Plant", completed: 0 }], ...over }) as unknown as ListWithItems;
const listQuery = (over: Record<string, unknown> = {}) => ({ data: undefined, refetch: vi.fn(), isLoading: false, isError: false, error: null, isFetching: false, ...over });

const Where = () => <p data-testid="where">{useLocation().search}</p>;
const show = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[url]}>
        <Tasks />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Tasks page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.useLists.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });
    hooks.useList.mockReturnValue(listQuery());
    for (const name of ["useCreateList", "useUpdateList", "useDeleteList", "useCreateItem", "useToggleItem", "useUpdateItem", "useDeleteItem", "useReorderItems", "useMoveItem"] as const) {
      hooks[name].mockReturnValue(mutation());
    }
    hooks.useListMembers.mockReturnValue({ data: undefined });
  });

  it("shows the quest log for a list id that is not a plain positive number", () => {
    show("/tasks?list=-3");
    expect(screen.getByText("quest log")).toBeInTheDocument();
    expect(hooks.useList).toHaveBeenCalledWith(0);
  });

  it("opens the quest named in the URL", () => {
    hooks.useList.mockReturnValue(listQuery({ data: quest() }));
    show("/tasks?list=7");
    expect(hooks.useList).toHaveBeenCalledWith(7);
    expect(screen.getByText("quest Garden")).toBeInTheDocument();
  });

  it("?new=quest opens the quest dialog and drops the param", async () => {
    show("/tasks?new=quest");
    expect(screen.getByText("quest dialog create")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^$/));
  });

  it("?new=task with no quest open says to open one first", async () => {
    show("/tasks?new=task");
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Open a quest first, then press N or use Add Task."));
    expect(screen.queryByText("task dialog")).not.toBeInTheDocument();
  });

  it("?new=task on a quest the player may only view does not open the form", async () => {
    hooks.useList.mockReturnValue(listQuery({ data: quest({ role: "viewer", isOwner: false } as Partial<ListWithItems>) }));
    show("/tasks?list=7&new=task");
    await waitFor(() => expect(toast).toHaveBeenCalledWith("You only have view access to this quest."));
    expect(screen.queryByText("task dialog")).not.toBeInTheDocument();
  });

  it("goes back to the quest log when the open quest is gone", async () => {
    hooks.useList.mockReturnValue(listQuery({ isError: true, error: new ApiError("List not found", 404, "NOT_FOUND") }));
    show("/tasks?list=7&task=3");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That quest was not found, or you no longer have access to it."));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^$/));
  });

  it("folds a bulk completion into one summary toast with Undo", async () => {
    const toggle = mutation();
    toggle.mutateAsync.mockResolvedValueOnce({ completed: true, xpResult: { finalXP: 10 } }).mockResolvedValueOnce({ completed: true, xpResult: { finalXP: 12 } });
    hooks.useToggleItem.mockReturnValue(toggle);
    hooks.useList.mockReturnValue(listQuery({ data: quest() }));
    show("/tasks?list=7");
    await userEvent.click(screen.getByRole("button", { name: "complete all" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toggle.mutateAsync).toHaveBeenCalledWith({ itemId: 1, completed: true, quiet: true });
    expect(toggle.mutateAsync).toHaveBeenCalledWith({ itemId: 2, completed: true, quiet: true });
    const [message, options] = toast.success.mock.calls[0];
    expect(message).toBe("✨ 2 tasks done +22 XP!");
    expect(options.action.label).toBe("Undo");
  });
});
