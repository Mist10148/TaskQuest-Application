import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Item, ListWithItems } from "@/lib/api";

vi.mock("@/components/ai/SummarizeButton", () => ({ SummarizeButton: () => null }));
// The real drawer loads comments and history through React Query; these tests only care whether it is open and for which task.
vi.mock("./TaskDetailSheet", () => ({ TaskDetailSheet: ({ item }: { item: { name: string } | null }) => (item ? <div role="dialog">{item.name}</div> : null) }));

import { ListDetail } from "./ListDetail";

const item = (id: number, extra: Partial<Item> = {}): Item => ({ id, list_id: 1, name: `Task ${id}`, description: null, completed: false, position: id, created_at: "", ...extra }) as Item;

const list = (items: Item[]): ListWithItems => ({ id: 1, name: "Chores", description: null, priority: null, deadline: null, isOwner: true, role: "owner", items }) as unknown as ListWithItems;

const noop = () => {};
const renderList = (items: Item[], props: Partial<React.ComponentProps<typeof ListDetail>> = {}) =>
  render(
    <MemoryRouter>
      <ListDetail
        list={list(items)}
        aiEnabled={false}
        quickAddPending={false}
        hiddenIds={new Set()}
        onBack={noop}
        onOpenMembers={noop}
        onAddItem={noop}
        onQuickAdd={async () => true}
        onEditList={noop}
        onSaveTemplate={noop}
        onDeleteList={noop}
        onToggleItem={noop}
        onEditItem={noop}
        onSetPriority={noop}
        onDeleteItem={noop}
        onBulkComplete={async () => undefined}
        onBulkDelete={noop}
        onBulkEdit={async () => undefined}
        onReorder={async () => undefined}
        {...props}
      />
    </MemoryRouter>
  );

describe("ListDetail filters and groups", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  const tasks = [item(1, { priority: "HIGH", tags: "work" }), item(2, { priority: "LOW", completed: true }), item(3, { tags: "home" })];

  it("filters the list, says how many are shown and clears", async () => {
    renderList(tasks);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "open");
    expect(screen.queryByText("Task 2")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 3")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tag" }), "home");
    expect(screen.queryByText("Task 1")).not.toBeInTheDocument();
    expect(screen.getByText("Task 3")).toBeInTheDocument();
    // Reordering is not offered while filtered.
    expect(screen.queryByRole("button", { name: 'Move "Task 3" up' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText("Task 2")).toBeInTheDocument();
  });

  it("groups the list under headings and remembers the choice", async () => {
    const { unmount } = renderList(tasks);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "priority");
    expect(within(screen.getByRole("region", { name: "High priority" })).getByText("Task 1")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "No priority" })).getByText("Task 3")).toBeInTheDocument();
    unmount();
    renderList(tasks);
    expect(screen.getByRole("combobox", { name: "Group by" })).toHaveValue("priority");
  });

  it("searches the quest by name and says how many are shown", async () => {
    renderList(tasks);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search this quest" }), "task 3");
    expect(screen.queryByText("Task 1")).not.toBeInTheDocument();
    expect(screen.getByText("Task 3")).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();
  });

  it("explains an empty result", async () => {
    renderList(tasks);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Due" }), "overdue");
    expect(screen.getByText("No tasks match these filters.")).toBeInTheDocument();
  });
});

describe("ListDetail keyboard cursor", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn(); // jsdom has none, and the cursor scrolls its row into view
  });
  afterEach(() => window.localStorage.clear());

  const tasks = [item(1), item(2), item(3, { completed: true })];

  it("moves with j and k and says where it is", async () => {
    renderList(tasks);
    await userEvent.keyboard("j");
    expect(screen.getByRole("status")).toHaveTextContent("Task 1, task 1 of 3");
    await userEvent.keyboard("jj");
    expect(screen.getByRole("status")).toHaveTextContent("Task 3, task 3 of 3, done");
    await userEvent.keyboard("k");
    expect(screen.getByRole("status")).toHaveTextContent("Task 2, task 2 of 3");
  });

  it("completes the highlighted task with x", async () => {
    const onToggleItem = vi.fn();
    renderList(tasks, { onToggleItem });
    await userEvent.keyboard("jx");
    expect(onToggleItem).toHaveBeenCalledWith(1);
  });

  it("ignores x, e and d once the tasks are shown as a board", async () => {
    const onToggleItem = vi.fn();
    const onEditItem = vi.fn();
    const onDeleteItem = vi.fn();
    renderList(tasks, { onToggleItem, onEditItem, onDeleteItem });
    await userEvent.keyboard("j");
    await userEvent.click(screen.getByRole("button", { name: "Board" }));
    await userEvent.keyboard("xed");
    expect(onToggleItem).not.toHaveBeenCalled();
    expect(onEditItem).not.toHaveBeenCalled();
    expect(onDeleteItem).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("ignores x, e and d while selecting tasks", async () => {
    const onToggleItem = vi.fn();
    const onDeleteItem = vi.fn();
    renderList(tasks, { onToggleItem, onDeleteItem });
    await userEvent.keyboard("js");
    await userEvent.keyboard("xd");
    expect(onToggleItem).not.toHaveBeenCalled();
    expect(onDeleteItem).not.toHaveBeenCalled();
  });
});

describe("ListDetail opening a task from a link", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("opens the drawer for the requested task once, then clears the request", () => {
    const onTaskOpened = vi.fn();
    renderList([item(1), item(2, { name: "Pay the rent" })], { openTaskId: 2, onTaskOpened });
    expect(screen.getByRole("dialog")).toHaveTextContent("Pay the rent");
    expect(onTaskOpened).toHaveBeenCalledTimes(1);
  });

  it("just opens the quest when the task is not on it", () => {
    const onTaskOpened = vi.fn();
    renderList([item(1)], { openTaskId: 99, onTaskOpened });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onTaskOpened).toHaveBeenCalledTimes(1);
  });
});
