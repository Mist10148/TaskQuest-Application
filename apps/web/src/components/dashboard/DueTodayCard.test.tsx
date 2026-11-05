import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { TodayData, TodayTask } from "@/lib/api";
import { DueTodayCard } from "./DueTodayCard";

const task = (id: number, over: Partial<TodayTask> = {}): TodayTask => ({
  id,
  name: `Task ${id}`,
  listId: 9,
  listName: "Home",
  dueDate: "2030-01-10",
  priority: null,
  estimateMinutes: null,
  overdueDays: 0,
  ...over,
});
const show = (tasks: TodayTask[]) =>
  render(
    <MemoryRouter>
      <DueTodayCard data={{ day: "2030-01-10", tasks } as TodayData} />
    </MemoryRouter>
  );

describe("DueTodayCard", () => {
  it("links each task to its quest and marks an overdue one", () => {
    show([task(1), task(2, { dueDate: "2030-01-08", overdueDays: 2 })]);
    expect(screen.getByRole("link", { name: "Task 1" })).toHaveAttribute("href", "/tasks?list=9&task=1");
    expect(screen.getByText("Overdue:")).toHaveClass("sr-only");
    expect(screen.getByRole("link", { name: "Open Today" })).toHaveAttribute("href", "/today");
  });

  it("shows five and points to Today for the rest", () => {
    show([1, 2, 3, 4, 5, 6, 7].map((id) => task(id)));
    expect(screen.queryByRole("link", { name: "Task 6" })).toBeNull();
    expect(screen.getByRole("link", { name: "and 2 more on Today" })).toHaveAttribute("href", "/today");
  });

  it("says so when nothing needs doing", () => {
    show([]);
    expect(screen.getByText(/Nothing is due or overdue/)).toBeInTheDocument();
  });
});
