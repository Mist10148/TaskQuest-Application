import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CosmeticItem, CosmeticsData } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useCosmetics: vi.fn(),
  useBuyCosmetic: vi.fn(),
  useEquipCosmetic: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { discord: { discordId: "1", username: "mist", globalName: null, avatar: null } } }),
  getAvatarUrl: () => "/avatar.png",
}));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Shop from "./Shop";

const item = (over: Partial<CosmeticItem>): CosmeticItem => ({
  id: "t1",
  kind: "title",
  name: "Early Bird",
  cost: 200,
  owned: false,
  equipped: false,
  locked: false,
  lockedReason: null,
  affordable: true,
  ...over,
});
const shop = (items: CosmeticItem[], over: Partial<CosmeticsData> = {}): CosmeticsData => ({ balance: 500, items, equipped: { title: null, frame: null, accent: null }, gamificationEnabled: true, ...over });
const load = (data: CosmeticsData) => hooks.useCosmetics.mockReturnValue({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });

describe("Shop page", () => {
  const buy = vi.fn();
  const equip = vi.fn();
  beforeEach(() => {
    buy.mockReset().mockResolvedValue({});
    equip.mockReset().mockResolvedValue({});
    hooks.useBuyCosmetic.mockReturnValue({ mutateAsync: buy, isPending: false, variables: undefined });
    hooks.useEquipCosmetic.mockReturnValue({ mutateAsync: equip, isPending: false, variables: undefined });
  });

  it("shows the balance, and not 0 XP while the shop is still loading", () => {
    hooks.useCosmetics.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn(), isFetching: true });
    const { unmount } = render(<Shop />);
    expect(screen.getByText("…")).toBeInTheDocument();
    unmount();
    load(shop([item({})]));
    render(<Shop />);
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("buys only after the confirmation dialog", async () => {
    load(shop([item({})]));
    render(<Shop />);
    await userEvent.click(screen.getByRole("button", { name: "Buy for 200 XP" }));
    expect(buy).not.toHaveBeenCalled();
    expect(screen.getByText("Buy Early Bird?")).toBeInTheDocument();
    expect(screen.getByText("300 XP")).toBeInTheDocument(); // balance after
    await userEvent.click(screen.getByRole("button", { name: "Spend 200 XP" }));
    expect(buy).toHaveBeenCalledWith("t1");
  });

  it("offers Equip for an owned item and Unequip for the equipped one", async () => {
    load(shop([item({ id: "a", name: "Owned", owned: true }), item({ id: "b", name: "Worn", owned: true, equipped: true })]));
    render(<Shop />);
    await userEvent.click(screen.getByRole("button", { name: "Equip" }));
    expect(equip).toHaveBeenCalledWith({ kind: "title", id: "a" });
    await userEvent.click(screen.getByRole("button", { name: "Unequip" }));
    expect(equip).toHaveBeenCalledWith({ kind: "title", id: null });
  });

  it("disables buying when the player cannot afford it, the item is locked, or XP is off", () => {
    load(shop([item({ id: "a", name: "Dear", cost: 900, affordable: false }), item({ id: "b", name: "Hidden", locked: true, lockedReason: "reach level 5" })]));
    const { unmount } = render(<Shop />);
    expect(screen.getByRole("button", { name: "Need 400 more XP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Locked" })).toBeDisabled();
    expect(screen.getByText(/reach level 5/)).toBeInTheDocument();
    unmount();
    load(shop([item({})], { gamificationEnabled: false }));
    render(<Shop />);
    expect(screen.getByRole("button", { name: "Buy for 200 XP" })).toBeDisabled();
    expect(screen.getByText(/XP is turned off/)).toBeInTheDocument();
  });

  it("switches sections with the tabs and with the arrow keys", async () => {
    load(shop([item({ id: "t", name: "A title" }), item({ id: "f", kind: "frame", name: "A frame" })]));
    render(<Shop />);
    expect(screen.getByRole("heading", { name: "A title" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "A frame" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Frames" }));
    expect(screen.getByRole("heading", { name: "A frame" })).toBeInTheDocument();
    screen.getByRole("tab", { name: "Frames" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Titles" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows an error card when the shop cannot be loaded", () => {
    hooks.useCosmetics.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("x"), refetch: vi.fn(), isFetching: false });
    render(<Shop />);
    expect(screen.getByRole("alert")).toHaveTextContent(/shop/i);
  });
});
