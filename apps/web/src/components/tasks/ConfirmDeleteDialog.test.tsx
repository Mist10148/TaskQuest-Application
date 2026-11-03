import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";

const renderDialog = (pending: boolean) =>
  render(<ConfirmDeleteDialog open onOpenChange={() => {}} title="Delete quest" description="Gone for good." confirmLabel="Delete" pending={pending} onConfirm={vi.fn()} />);

describe("ConfirmDeleteDialog", () => {
  it("keeps the confirm button's name while the delete is pending", () => {
    renderDialog(true);
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("ignores Escape while the delete is pending, and closes on it otherwise", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<ConfirmDeleteDialog open onOpenChange={onOpenChange} title="Delete quest" description="Gone." confirmLabel="Delete" pending onConfirm={vi.fn()} />);
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    rerender(<ConfirmDeleteDialog open onOpenChange={onOpenChange} title="Delete quest" description="Gone." confirmLabel="Delete" pending={false} onConfirm={vi.fn()} />);
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the label and allows cancelling otherwise", () => {
    renderDialog(false);
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
