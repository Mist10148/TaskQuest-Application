import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskTemplate } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useTemplates: vi.fn(),
  useApplyTemplate: vi.fn(),
  useDeleteTemplate: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { TemplatesDialog } from "./TemplatesDialog";

const template = (id: number): TaskTemplate => ({ id, name: `Plan ${id}`, description: null, items: [{ name: "Step" }] as TaskTemplate["items"], itemCount: 1, created_at: "2030-01-01T00:00:00Z" });
const load = (data: TaskTemplate[]) => hooks.useTemplates.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() });
const show = () => render(<TemplatesDialog open onOpenChange={() => {}} onApplied={() => {}} />);

describe("TemplatesDialog", () => {
  const remove = vi.fn();
  beforeEach(() => {
    remove.mockReset();
    toast.success.mockReset();
    hooks.useApplyTemplate.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    hooks.useDeleteTemplate.mockReturnValue({ mutate: remove, isPending: false });
  });

  it("says how many of the 20 templates are used", () => {
    load([template(1), template(2)]);
    show();
    expect(screen.getByText("2 of 20 templates saved.")).toBeInTheDocument();
  });

  it("says to delete one once all 20 are used", () => {
    load(Array.from({ length: 20 }, (_, i) => template(i + 1)));
    show();
    expect(screen.getByText(/20 of 20 templates saved: delete one/)).toBeInTheDocument();
  });

  it("asks before deleting and confirms with a toast", async () => {
    load([template(1)]);
    remove.mockImplementation((_id: number, opts: { onSuccess?: () => void; onSettled?: () => void }) => { opts.onSuccess?.(); opts.onSettled?.(); });
    show();
    await userEvent.click(screen.getByRole("button", { name: "Delete template Plan 1" }));
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledWith(1, expect.anything());
    expect(toast.success).toHaveBeenCalledWith('Deleted the template "Plan 1"');
  });

  it("shows no count when there are no templates", () => {
    load([]);
    show();
    expect(screen.getByText(/No templates yet/)).toBeInTheDocument();
    expect(screen.queryByText(/templates saved/)).toBeNull();
  });
});
