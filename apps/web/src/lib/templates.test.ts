import { describe, expect, it } from "vitest";
import { defaultTemplateName, saveTemplateProblem, templateSummary } from "./templates";

const items = ["Laundry", "Plan meals", "Water plants", "Bins"].map((name) => ({ name }));

describe("templateSummary", () => {
  it("counts the tasks and previews the first three", () => {
    expect(templateSummary({ items, itemCount: 4 })).toBe("4 tasks: Laundry, Plan meals, Water plants…");
    expect(templateSummary({ items: items.slice(0, 1), itemCount: 1 })).toBe("1 task: Laundry");
  });
});

describe("saveTemplateProblem", () => {
  it("allows 1 to 30 tasks", () => {
    expect(saveTemplateProblem(0)).toMatch(/at least one/);
    expect(saveTemplateProblem(1)).toBeNull();
    expect(saveTemplateProblem(30)).toBeNull();
    expect(saveTemplateProblem(31)).toMatch(/at most 30/);
  });
});

describe("defaultTemplateName", () => {
  it("trims and fits the name limit", () => {
    expect(defaultTemplateName("  Trip  ")).toBe("Trip");
    expect(defaultTemplateName("x".repeat(150))).toHaveLength(100);
  });
});
