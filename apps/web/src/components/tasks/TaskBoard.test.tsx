import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Item } from "@/lib/api";
import { TaskBoard } from "./TaskBoard";

const item = (id: number, extra: Partial<Item> = {}): Item => ({ id, list_id: 1, name: `Task ${id}`, description: null, completed: false, position: id, created_at: "", ...extra }) as Item;

describe("TaskBoard", () => {
  it("puts each task in the column of its priority and keeps empty columns", () => {
    render(<TaskBoard items={[item(1, { priority: "HIGH" }), item(2, { priority: "LOW", completed: true }), item(3)]} onToggle={() => {}} onEdit={() => {}} />);
    expect(within(screen.getByRole("region", { name: "High priority" })).getByText("Task 1")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Low priority" })).getByText("Task 2")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "No priority" })).getByText("Task 3")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Medium priority" })).getByText("Nothing here")).toBeInTheDocument();
  });

  it("completes a task from its circle and opens it from its name", async () => {
    const onToggle = vi.fn();
    const onEdit = vi.fn();
    render(<TaskBoard items={[item(7, { priority: "HIGH" })]} onToggle={onToggle} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: 'Mark "Task 7" done' }));
    await userEvent.click(screen.getByRole("button", { name: "Task 7" }));
    expect(onToggle).toHaveBeenCalledWith(7);
    expect(onEdit).toHaveBeenCalledWith(7);
  });

  it("is read only for a viewer", () => {
    render(<TaskBoard items={[item(1)]} readOnly onToggle={() => {}} onEdit={() => {}} />);
    expect(screen.getByRole("button", { name: 'Mark "Task 1" done' })).toBeDisabled();
  });
});
