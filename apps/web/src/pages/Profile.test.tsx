import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ useClasses: vi.fn(), useXpLedger: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null as unknown, error: null as string | null, refresh: vi.fn() }));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth, getAvatarUrl: () => "/avatar.png" }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
// Both cards have their own queries and mutations; the page only passes them numbers.
vi.mock("@/components/game/PrestigeCard", () => ({ PrestigeCard: () => null }));
vi.mock("@/components/game/StreakFreezeCard", () => ({
  StreakFreezeCard: ({ freezes, max, balance }: { freezes: number; max: number; balance: number }) => <p>freezes {freezes}/{max} with {balance} XP</p>,
}));

import Profile from "./Profile";

const signIn = (user: Record<string, unknown> = {}) => {
  auth.user = {
    discord: { discordId: "1", username: "mist", globalName: "Mist", avatar: null },
    user: { player_level: 4, player_xp: 1250, lifetime_xp: 340, streak_count: 3, player_class: "HERO", streak_freezes: 1, gamification_enabled: 1, ...user },
    items: { total: 10, completed: 4 },
    lists: { total: 2 },
    games: { played: 8, won: 2 },
    achievements: 5,
    skills: [],
  };
};
const show = () =>
  render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

describe("Profile page", () => {
  beforeEach(() => {
    hooks.useClasses.mockReturnValue({ data: undefined });
    hooks.useXpLedger.mockReturnValue({ data: undefined });
    auth.error = null;
    signIn();
  });

  it("shows the name, class, balance and stats", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Mist");
    expect(screen.getByText("@mist")).toBeInTheDocument();
    expect(screen.getByText(/Hero/)).toBeInTheDocument();
    expect(screen.getByText("1,250")).toBeInTheDocument();
    expect(screen.getByText("25% win rate")).toBeInTheDocument();
    expect(screen.getByText("4/10 tasks")).toBeInTheDocument();
    expect(screen.getByText("freezes 1/3 with 1250 XP")).toBeInTheDocument();
  });

  it("names a class the page does not know from the classes API", () => {
    signIn({ player_class: "STARGAZER" });
    hooks.useClasses.mockReturnValue({ data: { classes: [{ key: "STARGAZER", name: "Stargazer", emoji: "🔭" }] } });
    show();
    expect(screen.getByText(/🔭 Stargazer/)).toBeInTheDocument();
  });

  it("lists the last five XP entries with a link to Stats, and nothing while there are none", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, amount: i === 0 ? -150 : 10, source: "task_complete", balance_before: 0, balance_after: 0, reference_id: null, created_at: "2030-01-01T00:00:00Z" }));
    hooks.useXpLedger.mockReturnValue({ data: rows });
    const { unmount } = show();
    const recent = screen.getByRole("region", { name: "Recent XP" });
    expect(within(recent).getAllByRole("listitem")).toHaveLength(5);
    expect(within(recent).getByText("-150 XP")).toBeInTheDocument();
    expect(within(recent).getByRole("link", { name: "All on Stats" })).toHaveAttribute("href", "/stats");
    unmount();

    hooks.useXpLedger.mockReturnValue({ data: [] });
    show();
    expect(screen.queryByRole("region", { name: "Recent XP" })).toBeNull();
  });

  it("shows an error card with a retry when the profile did not load", () => {
    auth.user = null;
    auth.error = "Session expired";
    show();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});
