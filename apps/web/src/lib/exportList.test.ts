import { describe, expect, it } from "vitest";
import type { Item, ListWithItems } from "./api";
import { csvCell, exportFileName, listToCsv, listToMarkdown } from "./exportList";

const item = (id: number, name: string, over: Partial<Item> = {}): Item =>
  ({ id, list_id: 1, name, description: null, completed: 0, position: id, created_at: "2030-01-01T00:00:00Z", ...over }) as Item;
const quest = (items: Item[], over: Partial<ListWithItems> = {}) =>
  ({ id: 1, name: "Move house", description: null, category: "Home", deadline: "2030-02-01", priority: null, items, ...over }) as unknown as ListWithItems;

describe("listToCsv", () => {
  it("uses the full export's columns, puts subtasks under their parent, and marks done tasks", () => {
    const csv = listToCsv(quest([item(2, "Pack", { completed: 1 }), item(1, "Book van", { due_date: "2030-01-20", priority: "HIGH", tags: "car,money" }), item(3, "Kitchen", { parent_id: 2 })]));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("list,task,subtask_of,done,due_date,priority,tags,repeat,list_deadline,list_category,description");
    expect(lines[1]).toBe('Move house,Book van,,no,2030-01-20,HIGH,"car,money",,2030-02-01,Home,');
    expect(lines[2]).toMatch(/^Move house,Pack,,yes,/);
    expect(lines[3]).toMatch(/^Move house,Kitchen,Pack,no,/);
  });

  it("keeps an empty quest as one row", () => {
    expect(listToCsv(quest([])).trim().split("\r\n")).toHaveLength(2);
  });

  it("defuses formulas and quotes what needs quoting, like the server", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(null)).toBe("");
  });
});

describe("listToMarkdown", () => {
  it("is a checklist with details and indented subtasks", () => {
    const md = listToMarkdown(quest([item(1, "Book *van*", { due_date: "2030-01-20", priority: "HIGH", tags: "car" }), item(2, "Pack", { completed: 1 }), item(3, "Kitchen", { parent_id: 2 })]));
    expect(md).toContain("# Move house");
    expect(md).toContain("Due 2030-02-01");
    expect(md).toContain(String.raw`- [ ] Book \*van\* (due 2030-01-20, HIGH, #car)`);
    expect(md).toContain("- [x] Pack");
    expect(md).toContain("  - [ ] Kitchen");
  });
});

describe("exportFileName", () => {
  it("makes a safe name from the quest", () => {
    expect(exportFileName({ name: "Move house: phase 2!" }, "csv")).toBe("move-house-phase-2.csv");
    expect(exportFileName({ name: "🎉" }, "md")).toBe("quest.md");
  });
});
