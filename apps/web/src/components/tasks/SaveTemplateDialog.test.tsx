import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ useSaveAsTemplate: vi.fn() }));
vi.mock("@/hooks/useApi", () => hooks);

import { SaveTemplateDialog } from "./SaveTemplateDialog";

describe("SaveTemplateDialog", () => {
  const save = vi.fn();
  const onOpenChange = vi.fn();
  beforeEach(() => {
    save.mockReset().mockResolvedValue({});
    onOpenChange.mockReset();
    hooks.useSaveAsTemplate.mockReturnValue({ mutateAsync: save, isPending: false });
  });
  const show = () => render(<SaveTemplateDialog open onOpenChange={onOpenChange} listId={4} listName="Move house" />);

  it("starts from the quest's name and saves it", async () => {
    show();
    const input = screen.getByLabelText("Template name");
    expect((input as HTMLInputElement).value).toContain("Move house");
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(save).toHaveBeenCalledWith({ listId: 4, name: (input as HTMLInputElement).value.trim() });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says why a blank name is not saved, instead of a silent disabled button", async () => {
    show();
    const input = screen.getByLabelText("Template name");
    await userEvent.clear(input);
    await userEvent.type(input, "{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Give your template a name.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(save).not.toHaveBeenCalled();
    await userEvent.type(input, "Moving");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
