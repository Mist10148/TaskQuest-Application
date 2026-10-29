import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListWithCounts } from "@/lib/api";

const hooks = vi.hoisted(() => ({ useLists: vi.fn(), useToday: vi.fn() }));
const daily = vi.hoisted(() => ({ claim: vi.fn(), pending: false, waitMs: 0, claimed: false, everClaimed: true }));
const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/hooks/useDailyClaim", () => ({ useDailyClaim: () => daily }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
// The cards below have their own tests and their own queries.
vi.mock("@/components/dashboard/OnboardingChecklist", () => ({ OnboardingChecklist: () => null }));
vi.mock("@/components/dashboard/QuestsCard", () => ({ QuestsCard: () => null }));
vi.mock("@/components/dashboard/NextUnlocks", () => ({ NextUnlocks: () => null }));
vi.mock("@/components/ai/BriefingCard", () => ({ BriefingCard: () => null }));
vi.mock("@/components/tasks/InvitesBanner", () => ({ InvitesBanner: () => null }));
vi.mock("@/components/dashboard/StreakStrip", () => ({ StreakStrip: () => <p>streak strip</p> }));

import Dashboard from "./Dashboard";

const signIn = (user: Record<string, unknown> = {}) => {
  auth.user = {
    discord: { discordId: "1", username: "mist", globalName: "Mist", avatar: null },
    user: { player_level: 4, player_xp: 250, lifetime_xp: 340, streak_count: 3, gamification_enabled: 1, ...user },
    items: { total: 10, completed: 4 },
    games: { played: 7 },
    achievements: 5,
  };
};
const quest = (id: number, name: string): ListWithCounts => ({ id, name, description: null, category: null, priority: null, deadline: null, itemsTotal: 2, itemsCompleted: 1 }) as ListWithCounts;
const lists = (over: Record<string, unknown>) => hooks.useLists.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false, ...over });
const show = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );

describe("Dashboard page", () => {
  beforeEach(() => {
    daily.claim.mockReset();
    Object.assign(daily, { claimed: false, pending: false });
    hooks.useToday.mockReturnValue({ data: undefined });
    signIn();
  });

  it("greets the player, shows the level card and the stats", () => {
    lists({ data: [] });
    show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome back, Mist");
    expect(screen.getByRole("heading", { name: "Level 4" })).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument(); // 340 % 100 = 40, so 60 to the next level
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("4/10 tasks")).toBeInTheDocument();
  });

  it("claims the daily reward, and with XP off offers neither the claim nor the level card", async () => {
    lists({ data: [] });
    const { unmount } = show();
    await userEvent.click(screen.getByRole("button", { name: /Claim Daily Reward/ }));
    expect(daily.claim).toHaveBeenCalledTimes(1);
    unmount();

    signIn({ gamification_enabled: 0 });
    show();
    expect(screen.queryByRole("button", { name: /Claim Daily Reward/ })).toBeNull();
    expect(screen.queryByText("XP to next level")).toBeNull();
  });

  it("links the first three quests, or offers to create one", () => {
    lists({ data: [quest(1, "Home"), quest(2, "Work"), quest(3, "Garden"), quest(4, "Taxes")] });
    const { unmount } = show();
    expect(screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/tasks?list="))).toHaveLength(3);
    unmount();

    lists({ data: [] });
    show();
    expect(screen.getByRole("link", { name: /Create Quest/ })).toHaveAttribute("href", "/tasks?new=quest");
  });

  it("shows an error card when the quests fail to load", () => {
    lists({ isError: true, error: new Error("down") });
    show();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("shows the streak strip once Today has loaded", () => {
    lists({ data: [] });
    hooks.useToday.mockReturnValue({ data: { day: "2030-01-10", streak: { live: 3, claimedToday: true, atRisk: false, expiresAt: null } } });
    show();
    expect(screen.getByText("streak strip")).toBeInTheDocument();
  });
});
