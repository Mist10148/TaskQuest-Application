import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AiConfirmAction } from "@/lib/api";
import { ConfirmActionCard } from "./ConfirmActionCard";

const actions = [{ id: "a1", preview: 'Create quest "Trip"' }] as unknown as AiConfirmAction[];

describe("ConfirmActionCard", () => {
  it("lists the change, focuses Approve and reports the answer", async () => {
    const onRespond = vi.fn();
    render(<ConfirmActionCard actions={actions} onRespond={onRespond} />);
    expect(screen.getByText('Create quest "Trip"')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve/ })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onRespond.mock.calls).toEqual([[true], [false]]);
  });

  it("disables both answers while busy", () => {
    render(<ConfirmActionCard actions={actions} busy onRespond={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Approve/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeDisabled();
  });
});
