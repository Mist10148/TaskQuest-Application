import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Item } from "@/lib/api";
import { TaskRow } from "./TaskRow";

const item = (over: Partial<Item> = {}) => ({ id: 7, name: "Pay rent", completed: 0, ...over }) as unknown as Item;

const renderRow = (over: Partial<Item> = {}, props: Partial<Parameters<typeof TaskRow>[0]> = {}) => {
  const handlers = { onSelect: vi.fn(), onToggle: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
  render(<TaskRow item={item(over)} selectMode={false} selected={false} {...handlers} {...props} />);
  return handlers;
};

describe("TaskRow", () => {
  it("has one stable toggle name and exposes the state with aria-pressed", () => {
    renderRow();
    expect(screen.getByRole("button", { name: 'Mark "Pay rent" as done' })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the same name when completed and reports pressed", () => {
    renderRow({ completed: 1 });
    expect(screen.getByRole("button", { name: 'Mark "Pay rent" as done' })).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles by id", async () => {
    const { onToggle } = renderRow();
    await userEvent.click(screen.getByRole("button", { name: 'Mark "Pay rent" as done' }));
    expect(onToggle).toHaveBeenCalledWith(7);
  });

  it("is read-only for a viewer of a shared quest", async () => {
    const { onToggle } = renderRow({}, { readOnly: true });
    const toggle = screen.getByRole("button", { name: 'Mark "Pay rent" as done' });
    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("announces the priority to screen readers", () => {
    renderRow({ priority: "HIGH" });
    expect(screen.getByText(/high priority:/)).toHaveClass("sr-only");
  });
});

describe("TaskRow details button", () => {
  it("opens the details by id, also for a viewer", async () => {
    const onOpenDetails = vi.fn();
    renderRow({}, { onOpenDetails, readOnly: true });
    await userEvent.click(screen.getByRole("button", { name: 'Details of "Pay rent"' }));
    expect(onOpenDetails).toHaveBeenCalledWith(7);
  });

  it("has no details button unless a handler is given", () => {
    renderRow();
    expect(screen.queryByRole("button", { name: /Details of/ })).toBeNull();
  });

  it("shows who it is assigned to and how many comments it has", () => {
    renderRow({ assignee: { memberKey: "m1", name: "Sam", isYou: false }, comment_count: 2 });
    expect(screen.getByText("Assigned to")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("comments")).toBeInTheDocument();
  });
  it("snoozes an open task to tomorrow, and offers nothing to snooze on a finished one", async () => {
    const onSnooze = vi.fn();
    renderRow({}, { onSnooze });
    await userEvent.click(screen.getByRole("button", { name: 'Snooze "Pay rent" to tomorrow' }));
    expect(onSnooze).toHaveBeenCalledWith(7);
  });

  it("has no snooze action once the task is done", () => {
    renderRow({ completed: 1 }, { onSnooze: vi.fn() });
    expect(screen.queryByRole("button", { name: 'Snooze "Pay rent" to tomorrow' })).toBeNull();
  });

  it("gathers the row actions in one menu for small screens", async () => {
    const onSnooze = vi.fn();
    const { onDelete } = renderRow({}, { onSnooze });
    await userEvent.click(screen.getByRole("button", { name: 'More actions for "Pay rent"' }));
    expect(screen.getByRole("menuitem", { name: "Snooze to tomorrow" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(7);
  });

  it("has no action menu for a viewer", () => {
    renderRow({}, { readOnly: true });
    expect(screen.queryByRole("button", { name: 'More actions for "Pay rent"' })).toBeNull();
  });
});

