import { describe, expect, it } from "vitest";
import { goalPercent, todayHeadline } from "./today";

const data = (counts: Partial<{ dueToday: number; overdue: number; doneToday: number }>, tasks = 0) => ({
  counts: { dueToday: 0, overdue: 0, doneToday: 0, ...counts },
  tasks: Array.from({ length: tasks }, (_, i) => ({ id: i, name: "t", listId: 1, listName: "l", dueDate: null, priority: null, estimateMinutes: null, overdueDays: 0 })),
});

describe("todayHeadline", () => {
  it("puts overdue work first", () => {
    expect(todayHeadline(data({ overdue: 1, dueToday: 3 }))).toBe("1 task is overdue. Start with the oldest.");
    expect(todayHeadline(data({ overdue: 4 }))).toBe("4 tasks are overdue. Start with the oldest.");
  });
  it("then what is due today", () => {
    expect(todayHeadline(data({ dueToday: 1 }))).toBe("1 task is due today.");
    expect(todayHeadline(data({ dueToday: 2 }))).toBe("2 tasks are due today.");
  });
  it("celebrates a finished day and explains an empty one", () => {
    expect(todayHeadline(data({ doneToday: 3 }))).toBe("Nice: 3 done today and nothing is waiting.");
    expect(todayHeadline(data({}, 2))).toBe("Nothing is due. These are your HIGH priority tasks.");
    expect(todayHeadline(data({}))).toBe("A clear day. Add a task or take a break.");
  });
});

describe("goalPercent", () => {
  it("is a clamped percentage", () => {
    expect(goalPercent(3, 10)).toBe(30);
    expect(goalPercent(12, 10)).toBe(100);
    expect(goalPercent(0, 10)).toBe(0);
  });
  it("reads no goal as zero", () => {
    expect(goalPercent(5, null)).toBe(0);
    expect(goalPercent(5, 0)).toBe(0);
  });
});
