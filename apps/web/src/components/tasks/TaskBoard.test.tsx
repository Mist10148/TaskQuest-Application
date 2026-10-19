import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("moves a card to another column with its priority menu", async () => {
    const onSetPriority = vi.fn();
    render(<TaskBoard items={[item(1, { priority: "LOW" })]} onToggle={() => {}} onEdit={() => {}} onSetPriority={onSetPriority} />);
    await userEvent.selectOptions(screen.getByLabelText('Priority of "Task 1"'), "HIGH");
    expect(onSetPriority).toHaveBeenCalledWith(1, "HIGH");
    await userEvent.selectOptions(screen.getByLabelText('Priority of "Task 1"'), "NONE");
    expect(onSetPriority).toHaveBeenLastCalledWith(1, null);
  });

  it("moves a dragged card to the column it is dropped on", () => {
    const onSetPriority = vi.fn();
    render(<TaskBoard items={[item(1, { priority: "LOW" })]} onToggle={() => {}} onEdit={() => {}} onSetPriority={onSetPriority} />);
    const dataTransfer = { setData: vi.fn(), dropEffect: "", effectAllowed: "" };
    fireEvent.dragStart(screen.getByText("Task 1").closest("li")!, { dataTransfer });
    const high = screen.getByRole("region", { name: "High priority" });
    fireEvent.dragOver(high, { dataTransfer });
    expect(within(high).getByText("Drop here")).toBeInTheDocument();
    fireEvent.drop(high, { dataTransfer });
    expect(onSetPriority).toHaveBeenCalledWith(1, "HIGH");
  });

  it("closes 'No priority' while the quest has a priority, and is fixed when read-only", () => {
    const { unmount } = render(<TaskBoard items={[item(1)]} listPriority="MEDIUM" onToggle={() => {}} onEdit={() => {}} onSetPriority={vi.fn()} />);
    const menu = screen.getByLabelText('Priority of "Task 1"');
    expect(within(menu).getByRole("option", { name: "No priority" })).toBeDisabled();
    expect(menu).toHaveValue("MEDIUM");
    unmount();
    render(<TaskBoard items={[item(1)]} readOnly onToggle={() => {}} onEdit={() => {}} onSetPriority={vi.fn()} />);
    expect(screen.queryByLabelText('Priority of "Task 1"')).not.toBeInTheDocument();
    expect(screen.getByText("Task 1").closest("li")).toHaveAttribute("draggable", "false");
  });
});

