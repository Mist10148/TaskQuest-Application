import { describe, expect, it } from "vitest";
import type { Item } from "./api";
import { addDays, boardColumns, calendarKeyTarget, monthGrid, shiftMonth, tasksByDate } from "./taskViews";

const item = (id: number, extra: Partial<Item> = {}): Item => ({ id, list_id: 1, name: `t${id}`, description: null, completed: false, position: id, created_at: "", ...extra }) as Item;

describe("boardColumns", () => {
  it("groups top-level tasks by priority, open before done, keeping empty columns", () => {
    const cols = boardColumns([item(1, { priority: "HIGH" }), item(2, { priority: "HIGH", completed: true }), item(3), item(4, { priority: "LOW" }), item(5, { parent_id: 1, priority: "HIGH" })]);
    expect(cols.map((c) => c.key)).toEqual(["HIGH", "MEDIUM", "LOW", "NONE"]);
    expect(cols[0].open.map((i) => i.id)).toEqual([1]);
    expect(cols[0].done.map((i) => i.id)).toEqual([2]);
    expect(cols[1].open).toEqual([]);
    expect(cols[3].open.map((i) => i.id)).toEqual([3]);
  });
  it("falls back to the quest's priority for a task without its own", () => {
    const cols = boardColumns([item(1), item(2, { priority: "LOW" })], "MEDIUM");
    expect(cols[1].open.map((i) => i.id)).toEqual([1]);
    expect(cols[2].open.map((i) => i.id)).toEqual([2]);
  });
});

describe("monthGrid", () => {
  it("starts on a Monday and covers the month in whole weeks", () => {
    const weeks = monthGrid(2030, 1); // January 2030 starts on a Tuesday
    expect(weeks[0][0].date).toBe("2029-12-31");
    expect(weeks[0][1]).toEqual({ date: "2030-01-01", inMonth: true });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const days = weeks.flat();
    expect(days.filter((d) => d.inMonth)).toHaveLength(31);
    expect(days[days.length - 1].date >= "2030-01-31").toBe(true);
  });
  it("handles February in a leap year and a month that starts on a Monday", () => {
    expect(monthGrid(2028, 2).flat().filter((d) => d.inMonth)).toHaveLength(29);
    expect(monthGrid(2030, 7)[0][0]).toEqual({ date: "2030-07-01", inMonth: true });
  });
  it("uses five or six rows, never fewer than the month needs", () => {
    for (let m = 1; m <= 12; m++) {
      const weeks = monthGrid(2030, m);
      expect(weeks.length).toBeGreaterThanOrEqual(4);
      expect(weeks.length).toBeLessThanOrEqual(6);
      expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(new Date(Date.UTC(2030, m, 0)).getUTCDate());
    }
  });
});

describe("shiftMonth and tasksByDate", () => {
  it("moves across year boundaries", () => {
    expect(shiftMonth(2030, 12, 1)).toEqual({ year: 2031, month: 1 });
    expect(shiftMonth(2030, 1, -1)).toEqual({ year: 2029, month: 12 });
    expect(shiftMonth(2030, 5, 0)).toEqual({ year: 2030, month: 5 });
  });
  it("groups dated top-level tasks by day", () => {
    const map = tasksByDate([item(1, { due_date: "2030-01-05" }), item(2, { due_date: "2030-01-05T00:00:00.000Z" }), item(3), item(4, { due_date: "2030-01-06", parent_id: 1 })]);
    expect([...map.keys()]).toEqual(["2030-01-05"]);
    expect(map.get("2030-01-05")?.map((i) => i.id)).toEqual([1, 2]);
  });
});

describe("calendarKeyTarget", () => {
  it("moves by days and weeks, across month and year ends", () => {
    expect(calendarKeyTarget("2030-01-31", "ArrowRight")).toBe("2030-02-01");
    expect(calendarKeyTarget("2030-01-01", "ArrowLeft")).toBe("2029-12-31");
    expect(calendarKeyTarget("2030-01-03", "ArrowUp")).toBe("2029-12-27");
    expect(addDays("2030-03-30", 2)).toBe("2030-04-01");
  });

  it("goes to the ends of the week and clamps a month jump", () => {
    expect(calendarKeyTarget("2030-01-10", "Home")).toBe("2030-01-07"); // Thursday -> Monday
    expect(calendarKeyTarget("2030-01-10", "End")).toBe("2030-01-13");
    expect(calendarKeyTarget("2030-03-31", "PageUp")).toBe("2030-02-28");
    expect(calendarKeyTarget("2030-01-31", "PageDown")).toBe("2030-02-28");
  });

  it("ignores other keys", () => {
    expect(calendarKeyTarget("2030-01-10", "a")).toBeNull();
  });
});
