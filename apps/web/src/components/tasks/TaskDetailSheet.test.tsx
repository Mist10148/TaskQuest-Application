import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Item } from "@/lib/api";
import { TaskDetailSheet } from "./TaskDetailSheet";

const item = (over: Partial<Item> = {}) =>
  ({ id: 7, name: "Pay rent", completed: 0, created_at: "2026-10-01T10:00:00Z", ...over }) as unknown as Item;

const renderSheet = (over: Partial<Item> = {}, props: Partial<Parameters<typeof TaskDetailSheet>[0]> = {}) => {
  const handlers = { onOpenChange: vi.fn(), onToggle: vi.fn(), onEdit: vi.fn(), onOpenSubtask: vi.fn() };
  render(<TaskDetailSheet item={item(over)} subtasks={[]} readOnly={false} {...handlers} {...props} />);
  return handlers;
};

describe("TaskDetailSheet", () => {
  it("renders nothing while there is no task", () => {
    render(<TaskDetailSheet item={null} subtasks={[]} readOnly={false} onOpenChange={vi.fn()} onToggle={vi.fn()} onEdit={vi.fn()} onOpenSubtask={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the full description, tags, repeat and estimate", () => {
    renderSheet({ description: "Landlord's account\nreference 42", tags: "home,money", recurrence: "monthly", estimate_minutes: 15, priority: "HIGH" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/reference 42/)).toBeInTheDocument();
    expect(screen.getByText("#home")).toBeInTheDocument();
    expect(screen.getByText("monthly")).toBeInTheDocument();
    expect(screen.getByText(/15 min/)).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("lists subtasks with their progress and opens one", async () => {
    const { onOpenSubtask } = renderSheet({}, { subtasks: [item({ id: 8, name: "Find the invoice", completed: 1 }), item({ id: 9, name: "Send payment" })] });
    expect(screen.getByText("Subtasks (1/2)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Send payment/ }));
    expect(onOpenSubtask).toHaveBeenCalledWith(9);
  });

  it("completes and edits by id, and offers Reopen on a done task", async () => {
    const { onToggle, onEdit } = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Mark done" }));
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(onToggle).toHaveBeenCalledWith(7);
    expect(onEdit).toHaveBeenCalledWith(7);
  });

  it("shows Reopen for a finished task", () => {
    renderSheet({ completed: 1, completed_by_name: "Sam" });
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.getByText("Done by Sam")).toBeInTheDocument();
  });

  it("has no actions for a viewer", () => {
    renderSheet({}, { readOnly: true });
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("assigns the task to a member of a shared quest", async () => {
    const onAssign = vi.fn();
    const people = [{ memberKey: "owner", name: "Me", isYou: true }, { memberKey: "m1", name: "Sam", isYou: false }];
    renderSheet({}, { assignOptions: people, onAssign });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Assignee" }), "m1");
    expect(onAssign).toHaveBeenCalledWith(7, "m1");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Assignee" }), "");
    expect(onAssign).toHaveBeenLastCalledWith(7, null);
  });

  it("shows the chosen assignee at once, and puts it back if the save fails", async () => {
    let fail: (e: Error) => void = () => undefined;
    const onAssign = vi.fn(() => new Promise((_resolve, reject) => { fail = reject; }));
    const people = [{ memberKey: "owner", name: "Me", isYou: true }, { memberKey: "m1", name: "Sam", isYou: false }];
    renderSheet({}, { assignOptions: people, onAssign });
    const menu = screen.getByRole("combobox", { name: "Assignee" });
    await userEvent.selectOptions(menu, "m1");
    expect(menu).toHaveValue("m1");
    await act(async () => fail(new Error("refused")));
    expect(menu).toHaveValue("");
  });

  it("only shows the assignee to a viewer", () => {
    renderSheet({ assignee: { memberKey: "m1", name: "Sam", isYou: false } }, { readOnly: true, assignOptions: [], onAssign: vi.fn() });
    expect(screen.queryByRole("combobox", { name: "Assignee" })).toBeNull();
    expect(screen.getByText("Sam")).toBeInTheDocument();
  });

  it("moves a top-level task to another quest, but never a subtask", async () => {
    const onMove = vi.fn();
    renderSheet({}, { moveTargets: [{ id: 3, name: "Work" }], onMove });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Move to another quest" }), "3");
    expect(onMove).toHaveBeenCalledWith(7, 3);
  });

  it("offers no move for a subtask", () => {
    renderSheet({ parent_id: 1 }, { moveTargets: [{ id: 3, name: "Work" }], onMove: vi.fn() });
    expect(screen.queryByRole("combobox", { name: "Move to another quest" })).toBeNull();
  });
});

