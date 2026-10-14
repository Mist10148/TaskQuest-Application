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
