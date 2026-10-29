import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ListWithCounts } from "@/lib/api";
import type { useListFilters } from "./useListFilters";

vi.mock("@/components/ai/PriorityPanel", () => ({ PriorityPanel: () => null }));
vi.mock("./ListFilters", () => ({ ListFilters: () => null }));
vi.mock("./InvitesBanner", () => ({ InvitesBanner: () => null }));
vi.mock("./ShortcutsDialog", () => ({ ShortcutsDialog: () => null }));
vi.mock("./TaskSearchResults", () => ({ TaskSearchResults: () => <p>task results</p> }));
vi.mock("@/components/game/TaskComponents", () => ({ TaskListCard: ({ name }: { name: string }) => <p>{name}</p> }));

import { ListOverview } from "./ListOverview";

type Filters = ReturnType<typeof useListFilters>;
const quest = { id: 1, name: "Taxes", itemsTotal: 2, itemsCompleted: 0, priority: null, created_at: "2030-01-01T00:00:00Z" } as unknown as ListWithCounts;
const filtersWith = (over: Partial<Filters> = {}) =>
  ({ visible: [], activeFilters: 0, clearFilters: vi.fn(), searchQuery: "", setSearchQuery: vi.fn(), searchScope: "quests", ...over }) as unknown as Filters;
const show = (props: Partial<React.ComponentProps<typeof ListOverview>> = {}) =>
  render(<ListOverview lists={[quest]} loading={false} filters={filtersWith()} onOpen={() => {}} onCreate={() => {}} onOpenTemplates={() => {}} {...props} />);

describe("ListOverview", () => {
  it("announces the loading skeleton to screen readers", () => {
    show({ loading: true, lists: [] });
    expect(screen.getByRole("status", { name: "Loading quests" })).toBeInTheDocument();
  });

  it("offers to clear the filters when they hide every quest", async () => {
    const filters = filtersWith({ activeFilters: 2, searchQuery: "tax" });
    show({ filters });
    expect(screen.getByText("No quests match your filters")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(filters.clearFilters).toHaveBeenCalled();
    expect(filters.setSearchQuery).toHaveBeenCalledWith("");
  });

  it("has nothing to clear when no filter or search is set", () => {
    show();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("invites a first quest when there are none", () => {
    show({ lists: [] });
    expect(screen.getByText("No quests yet")).toBeInTheDocument();
  });

  it("shows the quests that pass the filters", () => {
    show({ filters: filtersWith({ visible: [quest] }) });
    expect(screen.getByText("Taxes")).toBeInTheDocument();
  });
});
