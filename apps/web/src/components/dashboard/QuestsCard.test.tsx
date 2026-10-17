import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Quest } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useQuests: vi.fn(),
  useClaimQuest: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);

import { QuestsCard } from "./QuestsCard";

const quest = (over: Partial<Quest>): Quest => ({
  key: "daily_grind",
  name: "Daily Grind",
  emoji: "⚙️",
  description: "Finish 5 tasks",
  period: "daily",
  target: 5,
  reward: 30,
  progress: 2,
  claimed: false,
  claimable: false,
  periodStart: "2030-01-01",
  resetsAt: "2030-01-02T00:00:00.000Z",
  ...over,
});

const quests = (list: Quest[]) =>
  hooks.useQuests.mockReturnValue({ data: { quests: list }, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });

describe("QuestsCard", () => {
  const mutate = vi.fn();
  beforeEach(() => {
    mutate.mockReset();
    hooks.useClaimQuest.mockReturnValue({ mutate, isPending: false, variables: undefined });
  });

  it("groups quests by period and leaves out empty groups", () => {
    quests([quest({}), quest({ key: "weekly_a", name: "Weekly A", period: "weekly" })]);
    render(<QuestsCard />);
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "This week" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This month" })).not.toBeInTheDocument();
  });

  it("shows progress and the reward for an unfinished quest", () => {
    quests([quest({})]);
    render(<QuestsCard />);
    expect(screen.getByText("+30 XP")).toBeInTheDocument();
    expect(screen.getByText("2/5")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Daily Grind progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
  });

  it("offers a Claim button for a finished quest and claims it by key", async () => {
    quests([quest({ progress: 5, claimable: true })]);
    render(<QuestsCard />);
    await userEvent.click(screen.getByRole("button", { name: /claim/i }));
    expect(mutate).toHaveBeenCalledWith("daily_grind");
  });

  it("shows Claimed instead of a button once claimed", () => {
    quests([quest({ progress: 5, claimed: true })]);
    render(<QuestsCard />);
    expect(screen.getByText("Claimed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claim/i })).not.toBeInTheDocument();
  });

  it("marks this week's rotating pick", () => {
    quests([quest({ period: "weekly", rotating: true })]);
    render(<QuestsCard />);
    expect(screen.getByText("This week's pick")).toBeInTheDocument();
  });

  it("shows an error card with a retry when the quests fail to load", async () => {
    const refetch = vi.fn();
    hooks.useQuests.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("down"), refetch, isFetching: false });
    render(<QuestsCard />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your quests");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
