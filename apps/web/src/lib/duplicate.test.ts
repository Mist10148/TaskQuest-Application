import { describe, expect, it } from "vitest";
import type { Item } from "./api";
import { duplicateInput } from "./duplicate";

const item = (over: Partial<Item> = {}) => ({ id: 7, list_id: 1, name: "Pay rent", completed: 1, ...over }) as unknown as Item;

describe("duplicateInput", () => {
  it("copies what describes the task and leaves out completion and the assignee", () => {
    const copy = duplicateInput(
      item({ description: "ref 42", due_date: "2030-01-05T00:00:00.000Z", priority: "HIGH", tags: "home,money", recurrence: "monthly", estimate_minutes: 15, parent_id: 3 } as Partial<Item>)
    );
    expect(copy).toEqual({
      name: "Pay rent (copy)",
      description: "ref 42",
      due_date: "2030-01-05",
      priority: "HIGH",
      tags: ["home", "money"],
      recurrence: "monthly",
      estimate_minutes: 15,
      parent_id: 3,
    });
    expect(copy).not.toHaveProperty("assignee");
    expect(copy).not.toHaveProperty("completed");
  });

  it("keeps a long name within the limit", () => {
    const copy = duplicateInput(item({ name: "x".repeat(200) }));
    expect(copy.name).toHaveLength(200);
    expect(copy.name.endsWith(" (copy)")).toBe(true);
  });
});
