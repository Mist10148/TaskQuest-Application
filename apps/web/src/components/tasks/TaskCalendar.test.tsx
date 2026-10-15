import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "@/lib/api";
import { TaskCalendar } from "./TaskCalendar";

const item = (id: number, due: string | null, extra: Partial<Item> = {}): Item => ({ id, list_id: 1, name: `Task ${id}`, description: null, completed: false, position: id, created_at: "", due_date: due, ...extra }) as Item;

describe("TaskCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2030, 0, 10, 12)); // 10 January 2030, local time
  });
  afterEach(() => vi.useRealTimers());

  it("shows the current month with the open count on each day", () => {
    render(<TaskCalendar items={[item(1, "2030-01-15"), item(2, "2030-01-15"), item(3, "2030-01-20", { completed: true })]} onToggle={() => {}} onEdit={() => {}} />);
    expect(screen.getByText("January 2030")).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "2030-01-15, 2 open of 2" })).toHaveTextContent("2 open");
    expect(screen.getByRole("gridcell", { name: "2030-01-20, 0 open of 1" })).toHaveTextContent("done");
  });

  it("lists the tasks of the picked day and completes one", async () => {
    const onToggle = vi.fn();
    render(<TaskCalendar items={[item(1, "2030-01-15"), item(2, "2030-01-16")]} onToggle={onToggle} onEdit={() => {}} />);
    await userEvent.click(screen.getByRole("gridcell", { name: /2030-01-15/ }));
    const day = screen.getByRole("region", { name: "Tasks due 2030-01-15" });
    expect(within(day).getByText("Task 1")).toBeInTheDocument();
    expect(within(day).queryByText("Task 2")).not.toBeInTheDocument();
    await userEvent.click(within(day).getByRole("button", { name: 'Mark "Task 1" done' }));
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it("moves between months and mentions tasks without a date", async () => {
    render(<TaskCalendar items={[item(1, null), item(2, "2030-02-03")]} onToggle={() => {}} onEdit={() => {}} />);
    expect(screen.getByText(/1 open task has no due date/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("February 2030")).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: "2030-02-03, 1 open of 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("January 2030")).toBeInTheDocument();
  });
});
