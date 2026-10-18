import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkEditDialog } from "./BulkEditDialog";

const setup = () => {
  const onApply = vi.fn();
  render(<BulkEditDialog open onOpenChange={vi.fn()} count={3} pending={false} onApply={onApply} />);
  return onApply;
};

describe("BulkEditDialog", () => {
  it("cannot apply until something changes", () => {
    setup();
    expect(screen.getByText("Edit 3 tasks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("applies a new priority", async () => {
    const onApply = setup();
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "HIGH");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ priority: "HIGH", dueMode: "keep", dueDate: "" });
  });

  it("needs a date once Set a date is chosen", async () => {
    const onApply = setup();
    await userEvent.selectOptions(screen.getByLabelText("Due date"), "set");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("New due date"), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ priority: "keep", dueMode: "set", dueDate: "2026-11-01" });
  });
});
