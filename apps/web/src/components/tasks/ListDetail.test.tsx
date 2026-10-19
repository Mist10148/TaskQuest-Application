import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Item, ListWithItems } from "@/lib/api";

vi.mock("@/components/ai/SummarizeButton", () => ({ SummarizeButton: () => null }));

import { ListDetail } from "./ListDetail";

const item = (id: number, extra: Partial<Item> = {}): Item => ({ id, list_id: 1, name: `Task ${id}`, description: null, completed: false, position: id, created_at: "", ...extra }) as Item;

const list = (items: Item[]): ListWithItems => ({ id: 1, name: "Chores", description: null, priority: null, deadline: null, isOwner: true, role: "owner", items }) as unknown as ListWithItems;

const noop = () => {};
const renderList = (items: Item[]) =>
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

  it("explains an empty result", async () => {
    renderList(tasks);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Due" }), "overdue");
    expect(screen.getByText("No tasks match these filters.")).toBeInTheDocument();
  });
});
