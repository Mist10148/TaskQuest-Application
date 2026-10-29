import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Achievement, AchievementsData } from "@/lib/api";

const hooks = vi.hoisted(() => ({ useAchievements: vi.fn() }));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

import Achievements from "./Achievements";

const ach = (key: string, unlocked: boolean, category = "lists"): Achievement => ({ key, name: key, description: `About ${key}`, emoji: "🏆", category, unlocked, unlockedAt: unlocked ? "2030-01-01T00:00:00Z" : null });
const query = (over: Record<string, unknown>) => hooks.useAchievements.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false, ...over });
const load = (achievements: Achievement[]) => {
  const data: AchievementsData = { achievements, unlockedCount: achievements.filter((a) => a.unlocked).length, totalCount: achievements.length };
  query({ data });
};

describe("Achievements page", () => {
  beforeEach(() => hooks.useAchievements.mockReset());

  it("shows overall progress and how many each filter would list", () => {
    load([ach("First List", true), ach("Ten Lists", false), ach("Streak 7", false, "streaks")]);
    render(<Achievements />);
    const bar = screen.getByRole("progressbar", { name: "Achievements unlocked" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(screen.getByRole("button", { name: /^All\s*\(3\)$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Unlocked\s*\(1\)$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Locked\s*\(2\)$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /First List\s*\(unlocked\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Streaks/ })).toBeInTheDocument();
  });

  it("filters to unlocked or locked achievements, with an empty state for each", async () => {
    load([ach("First List", true), ach("Ten Lists", false)]);
    const { unmount } = render(<Achievements />);
    await userEvent.click(screen.getByRole("button", { name: /^Locked\s*\(1\)$/ }));
    expect(screen.queryByRole("heading", { name: /First List/ })).toBeNull();
    expect(screen.getByRole("heading", { name: /Ten Lists\s*\(locked\)/ })).toBeInTheDocument();

    unmount();
    load([ach("Ten Lists", false)]);
    render(<Achievements />);
    await userEvent.click(screen.getByRole("button", { name: /^Unlocked/ }));
    expect(screen.getByRole("status")).toHaveTextContent(/Nothing unlocked yet/);
  });

  it("shows no 0/0 progress card while loading or after an error", () => {
    query({ isLoading: true });
    const { unmount } = render(<Achievements />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    unmount();

    query({ isError: true, error: new Error("boom") });
    render(<Achievements />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});
