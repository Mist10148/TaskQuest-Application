import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quickAdd";

// 2030-03-13 is a Wednesday. The same cases run against packages/shared/src/quickAdd.js.
const TODAY = "2030-03-13";
const none = { due_date: null, priority: null, tags: [], recurrence: null };

const CASES: Array<[string, Record<string, unknown>]> = [
  ["Finish report fri !high #work every week", { name: "Finish report", due_date: "2030-03-15", priority: "HIGH", tags: ["work"], recurrence: "weekly" }],
  ["Buy milk tomorrow", { ...none, name: "Buy milk", due_date: "2030-03-14" }],
  ["Call mom today !m", { ...none, name: "Call mom", due_date: "2030-03-13", priority: "MEDIUM" }],
  ["Water plants daily #home #garden", { ...none, name: "Water plants", tags: ["home", "garden"], recurrence: "daily" }],
  ["Pay rent every month", { ...none, name: "Pay rent", recurrence: "monthly" }],
  ["Review PR wed", { ...none, name: "Review PR", due_date: "2030-03-20" }],
  ["Dentist in 3 days", { ...none, name: "Dentist", due_date: "2030-03-16" }],
  ["Plan trip in 2 weeks !low", { ...none, name: "Plan trip", due_date: "2030-03-27", priority: "LOW" }],
  ["Taxes 2030-04-15", { ...none, name: "Taxes", due_date: "2030-04-15" }],
  ["Birthday card apr 9", { ...none, name: "Birthday card", due_date: "2030-04-09" }],
  ["Birthday card 9 April", { ...none, name: "Birthday card", due_date: "2030-04-09" }],
  ["Renew passport jan 5", { ...none, name: "Renew passport", due_date: "2031-01-05" }],
  ["Buy sun cream", { ...none, name: "Buy sun cream" }],
  ["Marketing 5 ideas", { ...none, name: "Marketing 5 ideas" }],
  ["Fix bug 2030-02-30", { ...none, name: "Fix bug 2030-02-30" }],
  ["Just a plain task", { ...none, name: "Just a plain task" }],
  ["!high", { ...none, name: "", priority: "HIGH" }],
  ["  spaced   out   tomorrow  ", { ...none, name: "spaced out", due_date: "2030-03-14" }],
  ["Email Sam tomorrow, then friday", { ...none, name: "Email Sam then friday", due_date: "2030-03-14" }],
];

describe("parseQuickAdd", () => {
  it.each(CASES)("%s", (input, expected) => {
    expect(parseQuickAdd(input, TODAY)).toEqual(expected);
  });

  it("keeps at most five tags and ignores a second priority", () => {
    const r = parseQuickAdd("x #a #b #c #d #e #f !high !low", TODAY);
    expect(r.tags).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.priority).toBe("HIGH");
    expect(r.name).toBe("x #f !low");
  });

  it("handles empty and prototype-like words", () => {
    expect(parseQuickAdd("", TODAY).name).toBe("");
    expect(parseQuickAdd("constructor __proto__ toString", TODAY).name).toBe("constructor __proto__ toString");
  });
});
