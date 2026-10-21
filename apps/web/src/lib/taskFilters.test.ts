import { describe, expect, it } from "vitest";
import type { Item } from "./api";
import { DEFAULT_FILTER, dueWindowOf, filterTasks, groupTasks, isFiltering, matchesFilter, tagsIn } from "./taskFilters";

const TODAY = "2030-01-10";
const item = (id: number, extra: Partial<Item> = {}): Item => ({ id, list_id: 1, name: `Task ${id}`, description: null, completed: false, position: id, created_at: "", ...extra }) as Item;

describe("dueWindowOf", () => {
  it("sorts dates into overdue, today, the next 7 days and later", () => {
    expect(dueWindowOf(item(1, { due_date: "2030-01-09" }), TODAY)).toBe("overdue");
    expect(dueWindowOf(item(1, { due_date: "2030-01-09", completed: true }), TODAY)).toBe("later");
    expect(dueWindowOf(item(1, { due_date: "2030-01-10" }), TODAY)).toBe("today");
    expect(dueWindowOf(item(1, { due_date: "2030-01-16" }), TODAY)).toBe("week");
    expect(dueWindowOf(item(1, { due_date: "2030-01-17" }), TODAY)).toBe("later");
    expect(dueWindowOf(item(1), TODAY)).toBe("none");
  });
});

describe("matchesFilter", () => {
  it("lets everything through by default", () => {
    expect(isFiltering(DEFAULT_FILTER)).toBe(false);
    expect(matchesFilter(item(1), DEFAULT_FILTER, null, TODAY)).toBe(true);
  });

  it("filters by status, priority (falling back to the quest's), due window and tag", () => {
    const f = { ...DEFAULT_FILTER, status: "open" as const, priority: "HIGH" as const, due: "week" as const, tag: "work" };
    expect(isFiltering(f)).toBe(true);
    expect(matchesFilter(item(1, { priority: "HIGH", due_date: "2030-01-09", tags: "home, work" }), f, null, TODAY)).toBe(true);
    expect(matchesFilter(item(1, { due_date: "2030-01-09", tags: "work" }), f, "HIGH", TODAY)).toBe(true);
    expect(matchesFilter(item(1, { priority: "HIGH", due_date: "2030-01-09", tags: "work", completed: true }), f, null, TODAY)).toBe(false);
    expect(matchesFilter(item(1, { priority: "HIGH", due_date: "2030-02-01", tags: "work" }), f, null, TODAY)).toBe(false);
    expect(matchesFilter(item(1, { priority: "HIGH", due_date: "2030-01-09", tags: "home" }), f, null, TODAY)).toBe(false);
    expect(matchesFilter(item(1), { ...DEFAULT_FILTER, priority: "none" }, null, TODAY)).toBe(true);
    expect(matchesFilter(item(1), { ...DEFAULT_FILTER, priority: "none" }, "LOW", TODAY)).toBe(false);
  });

  it("filters by assignee", () => {
    const mine = item(1, { assignee: { memberKey: "owner", name: "Me", isYou: true } });
    const theirs = item(2, { assignee: { memberKey: "m1", name: "Sam", isYou: false } });
    expect([mine, theirs, item(3)].filter((i) => matchesFilter(i, { ...DEFAULT_FILTER, assignee: "me" }, null, TODAY)).map((i) => i.id)).toEqual([1]);
    expect([mine, theirs, item(3)].filter((i) => matchesFilter(i, { ...DEFAULT_FILTER, assignee: "unassigned" }, null, TODAY)).map((i) => i.id)).toEqual([3]);
  });
});

describe("filterTasks", () => {
  const parent = item(1, { priority: "LOW" });
  const hit = item(2, { parent_id: 1, priority: "HIGH" });
  const miss = item(3, { parent_id: 1 });
  const children = new Map([[1, [hit, miss]]]);

  it("keeps a parent for a matching subtask and shows only the matching subtasks", () => {
    const out = filterTasks([parent, item(4)], children, { ...DEFAULT_FILTER, priority: "HIGH" }, null, TODAY);
    expect(out.topLevel.map((i) => i.id)).toEqual([1]);
    expect(out.childrenOf.get(1)?.map((i) => i.id)).toEqual([2]);
  });

  it("shows all subtasks of a matching parent", () => {
    const out = filterTasks([parent], children, { ...DEFAULT_FILTER, priority: "LOW" }, null, TODAY);
    expect(out.childrenOf.get(1)?.map((i) => i.id)).toEqual([2, 3]);
  });
});

describe("groupTasks and tagsIn", () => {
  const tasks = [item(1, { priority: "LOW", tags: "home" }), item(2, { priority: "HIGH", due_date: TODAY, tags: "work,home" }), item(3)];

  it("groups by priority in a fixed order and drops empty groups", () => {
    expect(groupTasks(tasks, "priority", null, TODAY).map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["High priority", [2]],
      ["Low priority", [1]],
      ["No priority", [3]],
    ]);
  });

  it("groups by due window and by first tag", () => {
    expect(groupTasks(tasks, "due", null, TODAY).map((g) => g.key)).toEqual(["today", "none"]);
    expect(groupTasks(tasks, "tag", null, TODAY).map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["#home", [1]],
      ["#work", [2]],
      ["No tag", [3]],
    ]);
  });

  it("keeps one unnamed group when not grouping, and lists the tags in use", () => {
    expect(groupTasks(tasks, "none", null, TODAY)).toEqual([{ key: "all", label: "", items: tasks }]);
    expect(tagsIn(tasks)).toEqual(["home", "work"]);
  });
});

describe("text search in a quest", () => {
  const f = (text: string) => ({ ...DEFAULT_FILTER, text });

  it("matches words in the name or description, in any order and any case", () => {
    const t = item(1, { name: "Pay the RENT", description: "Landlord, by bank transfer" });
    expect(matchesFilter(t, f("rent"), null, TODAY)).toBe(true);
    expect(matchesFilter(t, f("landlord pay"), null, TODAY)).toBe(true);
    expect(matchesFilter(t, f("rent mortgage"), null, TODAY)).toBe(false);
    expect(matchesFilter(item(2), f("rent"), null, TODAY)).toBe(false);
  });

  it("counts as filtering unless it is blank, and keeps a parent whose subtask matches", () => {
    expect(isFiltering(f("   "))).toBe(false);
    expect(isFiltering(f("rent"))).toBe(true);
    const parent = item(1, { name: "Flat" });
    const child = item(2, { name: "Pay rent", parent_id: 1 });
    const out = filterTasks([parent], new Map([[1, [child]]]), f("rent"), null, TODAY);
    expect(out.topLevel).toEqual([parent]);
    expect(out.childrenOf.get(1)).toEqual([child]);
  });
});
