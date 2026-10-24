import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderboardEntry } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useClasses: vi.fn(),
  useLeaderboard: vi.fn(),
  useMyRank: vi.fn(),
}));
const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/contexts/AuthContext", () => auth);
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

import Leaderboard from "./Leaderboard";

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });
const entry = (rank: number, over: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  rank,
  username: `player${rank}`,
  avatarUrl: null,
  xp: 100,
  lifetimeXp: 1000 - rank,
  score: 1000 - rank,
  level: 10,
  playerClass: "HERO",
  streak: 3,
  gamesPlayed: 0,
  tasksCompleted: 7,
  isYou: false,
  ...over,
});

const setUser = (over: Record<string, unknown> = {}) =>
  auth.useAuth.mockReturnValue({ user: { user: { gamification_enabled: 1, player_class: "WIZARD", ...over } } });

describe("Leaderboard page", () => {
  beforeEach(() => {
    setUser();
    hooks.useClasses.mockReturnValue(ok({ classes: [{ key: "HERO", emoji: "⚔️", name: "Hero" }, { key: "WIZARD", emoji: "🔮", name: "Wizard" }] }));
    hooks.useLeaderboard.mockReturnValue(ok([entry(1), entry(2), entry(3), entry(4, { isYou: true })]));
    hooks.useMyRank.mockReturnValue(ok({ rank: 4 }));
  });

  it("lists every ranked player as a list item, once", () => {
    render(<Leaderboard />);
    const list = screen.getByRole("list", { name: "Rankings" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
  });

  it("marks the current player's row and states their rank", () => {
    render(<Leaderboard />);
    expect(document.querySelector('[aria-current="true"]')).not.toBeNull();
    expect(screen.getByText(/Your rank/)).toHaveTextContent("#4");
  });

  it("says the player is outside the top ten when they are not in the list", () => {
    hooks.useLeaderboard.mockReturnValue(ok([entry(1), entry(2), entry(3)]));
    hooks.useMyRank.mockReturnValue(ok({ rank: 57 }));
    render(<Leaderboard />);
    expect(screen.getByText(/Your rank/)).toHaveTextContent("#57 (outside the top 10)");
  });

  it("explains an unranked player by board and class filter", async () => {
    hooks.useMyRank.mockReturnValue(ok({ rank: null }));
    render(<Leaderboard />);
    expect(screen.getByText("You're not on this board yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "This week" }));
    expect(screen.getByText(/Earn some XP or claim your daily reward/)).toBeInTheDocument();
  });

  it("tells a player with gamification off how to appear", () => {
    setUser({ gamification_enabled: 0 });
    hooks.useMyRank.mockReturnValue(ok({ rank: null }));
    render(<Leaderboard />);
    expect(screen.getByText("Turn on gamification to appear on the leaderboard.")).toBeInTheDocument();
  });

  it("asks for the chosen board", async () => {
    render(<Leaderboard />);
    await userEvent.click(screen.getByRole("tab", { name: "This week" }));
    expect(hooks.useLeaderboard).toHaveBeenLastCalledWith("weekly", "ALL");
    expect(screen.getByRole("tab", { name: "This week" })).toHaveAttribute("aria-selected", "true");
  });

  it("filters to the player's own class with one click, and the shortcut then goes away", async () => {
    render(<Leaderboard />);
    await userEvent.click(screen.getByRole("button", { name: "My class" }));
    expect(hooks.useLeaderboard).toHaveBeenLastCalledWith("lifetime", "WIZARD");
    expect(screen.queryByRole("button", { name: "My class" })).not.toBeInTheDocument();
  });

  it("offers no My class shortcut to a player without a class", () => {
    setUser({ player_class: "DEFAULT" });
    render(<Leaderboard />);
    expect(screen.queryByRole("button", { name: "My class" })).not.toBeInTheDocument();
  });

  it("shows an error card when the board cannot be loaded", () => {
    hooks.useLeaderboard.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("x"), refetch: vi.fn(), isFetching: false });
    render(<Leaderboard />);
    expect(screen.getByRole("alert")).toHaveTextContent(/leaderboard/i);
  });
});
