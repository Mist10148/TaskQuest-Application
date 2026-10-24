import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { goToPath } from "@/lib/goTo";
import { GlobalShortcuts } from "./GlobalShortcuts";

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const mount = (aiEnabled = false) =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <GlobalShortcuts aiEnabled={aiEnabled} />
      <Where />
      <input aria-label="Quick add" />
    </MemoryRouter>
  );

describe("goToPath", () => {
  it("maps the second key to a page, and AI Chat only with AI on", () => {
    expect(goToPath("t", false)).toBe("/today");
    expect(goToPath("Q", false)).toBe("/tasks");
    expect(goToPath("c", false)).toBeNull();
    expect(goToPath("c", true)).toBe("/chat");
    expect(goToPath("z", true)).toBeNull();
  });
});

describe("GlobalShortcuts", () => {
  it("g then t goes to Today", async () => {
    mount();
    await userEvent.keyboard("gt");
    expect(screen.getByTestId("where")).toHaveTextContent("/today");
  });

  it("marks the second key as handled, so a page's own shortcut for it does not also run", async () => {
    const pageShortcut = vi.fn();
    const onKey = (e: KeyboardEvent) => { if (!e.defaultPrevented && e.key === "d") pageShortcut(); };
    window.addEventListener("keydown", onKey);
    mount();
    await userEvent.keyboard("gd");
    window.removeEventListener("keydown", onKey);
    expect(screen.getByTestId("where")).toHaveTextContent("/dashboard");
    expect(pageShortcut).not.toHaveBeenCalled();
  });

  it("? opens the list of shortcuts on any page, with the go-to keys", async () => {
    mount(true);
    await userEvent.keyboard("?");
    const dialog = await screen.findByRole("dialog", { name: /keyboard shortcuts/i });
    expect(dialog).toHaveTextContent("g then a key");
    expect(dialog).toHaveTextContent("c AI Chat");
  });

  it("does nothing while typing", async () => {
    mount();
    await userEvent.click(screen.getByRole("textbox", { name: "Quick add" }));
    await userEvent.keyboard("gt?");
    expect(screen.getByTestId("where")).toHaveTextContent("/dashboard");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
