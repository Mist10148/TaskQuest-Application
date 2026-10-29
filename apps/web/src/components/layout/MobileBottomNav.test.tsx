import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { MobileBottomNav } from "./MobileBottomNav";

describe("MobileBottomNav", () => {
  it("links to the four main places and marks the current page", () => {
    render(<MemoryRouter initialEntries={["/tasks"]}><MobileBottomNav onMore={() => {}} /></MemoryRouter>);
    const nav = screen.getByRole("navigation", { name: "Quick navigation" });
    expect(nav.querySelectorAll("a")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Focus" })).toHaveAttribute("href", "/focus");
  });

  it("opens the full menu from More", async () => {
    const onMore = vi.fn();
    render(<MemoryRouter><MobileBottomNav onMore={onMore} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(onMore).toHaveBeenCalledOnce();
  });

  it("says that More opens a dialog, and whether it is open", () => {
    const { rerender } = render(<MemoryRouter><MobileBottomNav onMore={() => {}} /></MemoryRouter>);
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    expect(more).toHaveAttribute("aria-expanded", "false");
    rerender(<MemoryRouter><MobileBottomNav onMore={() => {}} menuOpen /></MemoryRouter>);
    expect(more).toHaveAttribute("aria-expanded", "true");
  });
});
