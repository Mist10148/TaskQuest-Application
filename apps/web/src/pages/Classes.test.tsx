import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassInfo } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useClasses: vi.fn(),
  useBuyClass: vi.fn(),
  useEquipClass: vi.fn(),
  useClassPreview: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ refresh: vi.fn().mockResolvedValue(undefined) }) }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: toasts }));

import Classes from "./Classes";

const cls = (over: Partial<ClassInfo>): ClassInfo =>
  ({ key: "HERO", name: "Hero", emoji: "⚔️", cost: 300, owned: false, equipped: false, playstyle: "Steady", description: "More XP for big tasks", ...over }) as ClassInfo;
const load = (classes: ClassInfo[], playerXP = 500) =>
  hooks.useClasses.mockReturnValue({ data: { classes, playerXP }, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });

describe("Classes page", () => {
  const buy = vi.fn();
  const equip = vi.fn();
  beforeEach(() => {
    buy.mockReset().mockResolvedValue({});
    equip.mockReset().mockResolvedValue({});
    toasts.success.mockReset();
    hooks.useBuyClass.mockReturnValue({ mutateAsync: buy, isPending: false, variables: undefined });
    hooks.useEquipClass.mockReturnValue({ mutateAsync: equip, isPending: false, variables: undefined });
    hooks.useClassPreview.mockReturnValue({ data: undefined });
  });

  it("shows … instead of 0 XP while the classes load", () => {
    hooks.useClasses.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn(), isFetching: true });
    render(<Classes />);
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("buys after the confirmation and names the class in the toast", async () => {
    load([cls({})]);
    render(<Classes />);
    await userEvent.click(screen.getByRole("button", { name: "Purchase for 300 XP" }));
    expect(buy).not.toHaveBeenCalled();
    expect(screen.getByText("Buy Hero?")).toBeInTheDocument();
    expect(screen.getByText("200 XP")).toBeInTheDocument(); // balance after
    await userEvent.click(screen.getByRole("button", { name: "Spend 300 XP" }));
    expect(buy).toHaveBeenCalledWith("HERO");
    expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining("Hero"));
    expect(toasts.success).not.toHaveBeenCalledWith(expect.stringContaining("HERO"));
  });

  it("shows the XP preview in the confirmation when the server has one for that class", async () => {
    load([cls({})]);
    hooks.useClassPreview.mockReturnValue({ data: { classKey: "HERO", level: 4, mix: "plain", noSkills: 11, fullTree: 15 } });
    render(<Classes />);
    await userEvent.click(screen.getByRole("button", { name: "Purchase for 300 XP" }));
    expect(screen.getByTestId("class-preview")).toHaveTextContent("11 XP");
  });

  it("disables purchase with the missing amount when the player cannot afford it", () => {
    load([cls({ cost: 900 })], 500);
    render(<Classes />);
    expect(screen.getByRole("button", { name: "Need 400 more XP" })).toBeDisabled();
  });

  it("equips an owned class, and marks the equipped one as active", async () => {
    load([cls({ key: "WIZARD", name: "Wizard", owned: true }), cls({ key: "HERO", name: "Hero", owned: true, equipped: true })]);
    render(<Classes />);
    expect(screen.getByRole("button", { name: "Currently Active" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Equip Class" }));
    expect(equip).toHaveBeenCalledWith("WIZARD");
  });

  it("shows an error card when the classes cannot be loaded", () => {
    hooks.useClasses.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("x"), refetch: vi.fn(), isFetching: false });
    render(<Classes />);
    expect(screen.getByRole("alert")).toHaveTextContent(/class/i);
  });
});
