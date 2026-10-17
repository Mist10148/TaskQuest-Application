import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeeklyReview } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useReview: vi.fn(),
  useClaimReview: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

import Review from "./Review";

const review = (over: Partial<WeeklyReview> = {}): WeeklyReview => ({
  weekStart: "2030-01-07",
  resetsAt: "2030-01-14T00:00:00.000Z",
  completed: 4,
  xpEarned: 1234,
  claimed: false,
  claimable: true,
  streak: 6,
  reward: 40,
  ...over,
});

const load = (r: WeeklyReview) =>
  hooks.useReview.mockReturnValue({ data: r, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });

describe("Review page", () => {
  const mutate = vi.fn();
  beforeEach(() => {
    mutate.mockReset();
    hooks.useClaimReview.mockReturnValue({ mutate, isPending: false });
  });

  it("shows this week's numbers and the bonus", () => {
    load(review());
    render(<Review />);
    expect(screen.getByTestId("review-completed")).toHaveTextContent("4");
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("Weekly review bonus: +40 XP")).toBeInTheDocument();
  });

  it("claims the bonus when it is claimable", async () => {
    load(review());
    render(<Review />);
    await userEvent.click(screen.getByRole("button", { name: /claim review bonus/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("disables the button and explains why when no task was finished", () => {
    load(review({ completed: 0, claimable: false }));
    render(<Review />);
    expect(screen.getByRole("button", { name: /claim review bonus/i })).toBeDisabled();
    expect(screen.getByText(/finish at least one task this week/i)).toBeInTheDocument();
  });

  it("shows Claimed instead of the button after claiming", () => {
    load(review({ claimed: true, claimable: false }));
    render(<Review />);
    expect(screen.getByRole("status")).toHaveTextContent("Claimed");
    expect(screen.queryByRole("button", { name: /claim review bonus/i })).not.toBeInTheDocument();
  });

  it("says the week follows the player's own time zone", () => {
    load(review());
    render(<Review />);
    expect(screen.getByText(/Monday 00:00 in your time zone/)).toBeInTheDocument();
  });

  it("shows an error card when the review cannot be loaded", () => {
    hooks.useReview.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("x"), refetch: vi.fn(), isFetching: false });
    render(<Review />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your weekly review");
  });
});
