import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ListFormDialog } from "./ListFormDialog";
import { EMPTY_LIST_FORM, type ListFormValues } from "./forms";

const renderDialog = (props: Partial<React.ComponentProps<typeof ListFormDialog>> = {}) => {
  const onSubmit = vi.fn();
  render(<ListFormDialog open onOpenChange={() => {}} mode="create" initial={EMPTY_LIST_FORM} pending={false} onSubmit={onSubmit} {...props} />);
  return onSubmit;
};

describe("ListFormDialog", () => {
  it("asks for a name and does not submit with a blank one", async () => {
    const onSubmit = renderDialog();
    await userEvent.type(screen.getByLabelText("Name *"), "   "); // passes the browser's "required", not ours
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give your quest a name.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits what was typed", async () => {
    const onSubmit = renderDialog();
    await userEvent.type(screen.getByLabelText("Name *"), "Spring clean");
    await userEvent.type(screen.getByLabelText("Description (optional)"), "Whole flat");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: "Spring clean", description: "Whole flat" }));
  });

  it("labels the category and priority pickers", () => {
    renderDialog();
    expect(screen.getByLabelText("Category")).toHaveAttribute("id", "list-category");
    expect(screen.getByLabelText("Priority")).toHaveAttribute("id", "list-priority");
  });

  it("starts from the quest being edited", () => {
    const initial: ListFormValues = { ...EMPTY_LIST_FORM, name: "Taxes", deadline: "2030-04-15" };
    renderDialog({ mode: "edit", initial, resetKey: 7 });
    expect(screen.getByLabelText("Name *")).toHaveValue("Taxes");
    expect(screen.getByRole("dialog")).toHaveTextContent("Edit Quest");
  });
});
