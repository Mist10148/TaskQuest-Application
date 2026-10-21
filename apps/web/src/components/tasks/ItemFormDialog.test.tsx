import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { addDays, localToday } from "@/lib/dates";
import { ItemFormDialog } from "./ItemFormDialog";
import type { ItemFormValues } from "./forms";

const initial: ItemFormValues = { name: "Pay rent", description: "", due_date: "2030-01-01", priority: "none", tags: "", recurrence: "none", estimate: "", parent_id: "none" };

const renderDialog = (onSubmit = vi.fn()) =>
  render(<ItemFormDialog open onOpenChange={() => {}} mode="edit" initial={initial} parentOptions={[]} pending={false} onSubmit={onSubmit} />);

describe("ItemFormDialog due date quick picks", () => {
  it("sets today, tomorrow and next week", async () => {
    renderDialog();
    const due = screen.getByLabelText("Due date");
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(due).toHaveValue(localToday());
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(due).toHaveValue(addDays(localToday(), 1));
    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(due).toHaveValue(addDays(localToday(), 7));
  });

  it("clears the date and does not submit the form", async () => {
    const onSubmit = vi.fn();
    renderDialog(onSubmit);
    await userEvent.click(screen.getByRole("button", { name: "No date" }));
    expect(screen.getByLabelText("Due date")).toHaveValue("");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("ItemFormDialog form", () => {
  it("asks for a name and does not submit with a blank one", async () => {
    const onSubmit = vi.fn();
    render(<ItemFormDialog open onOpenChange={() => {}} mode="create" initial={{ ...initial, name: "" }} parentOptions={[]} pending={false} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Task Name *"), "   "); // passes the browser's "required", not ours
    await userEvent.click(screen.getByRole("button", { name: /add task/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give your task a name.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the edited values", async () => {
    const onSubmit = vi.fn();
    renderDialog(onSubmit);
    await userEvent.type(screen.getByLabelText("Tags"), "home");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Pay rent", tags: "home" }));
  });
});
