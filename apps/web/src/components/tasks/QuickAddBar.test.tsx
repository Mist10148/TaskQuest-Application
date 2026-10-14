import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QuickAddBar } from "./QuickAddBar";

const setup = (onAdd: (p: unknown) => Promise<boolean>, extra = {}) =>
  render(
    <MemoryRouter>
      <QuickAddBar pending={false} aiEnabled={false} onAdd={onAdd} {...extra} />
    </MemoryRouter>,
  );

describe("QuickAddBar", () => {
  it("shows what it understood and clears the text once the task is created", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    setup(onAdd);
    const input = screen.getByLabelText("Quick add a task");
    await userEvent.type(input, "Finish report !high #work");
    expect(screen.getByText("#work")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: "Finish report", priority: "HIGH", tags: ["work"] }));
    expect(input).toHaveValue("");
  });

  it("keeps what was typed when the task could not be created", async () => {
    setup(vi.fn().mockResolvedValue(false));
    const input = screen.getByLabelText("Quick add a task");
    await userEvent.type(input, "Call the bank");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(input).toHaveValue("Call the bank");
  });

  it("does not submit an empty name", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    setup(onAdd);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Quick add a task"), "{Enter}");
    expect(onAdd).not.toHaveBeenCalled();
  });
});
