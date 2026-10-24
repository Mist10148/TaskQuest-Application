import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatsSummary, XPHistoryDay, XPTransaction } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useStatsSummary: vi.fn(),
  useXpHistory: vi.fn(),
  useXpLedger: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/stats/XPChart", () => ({ XPChart: () => <div data-testid="xp-chart" /> }));
vi.mock("@/components/stats/Heatmap", () => ({ Heatmap: () => <div data-testid="heatmap" /> }));

import Stats from "./Stats";

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });

const summary: StatsSummary = {
  streak: 5,
  tasksCompleted7d: 9,
  xpBySource30d: [{ source: "task_complete", label: "Finished tasks", xp: 120 }],
  busiestWeekday: { index: 2, name: "Wednesday", count: 4 },
};
const days = (xp: number, tasks: number): XPHistoryDay[] => [{ date: "2030-01-01", xp, tasksCompleted: tasks }];
const tx = (over: Partial<XPTransaction>): XPTransaction => ({ id: 1, amount: 10, source: "task_complete", balance_before: 0, balance_after: 10, created_at: "2030-01-01T10:00:00Z", ...over });

describe("Stats page", () => {
  beforeEach(() => {
    hooks.useStatsSummary.mockReturnValue(ok(summary));
    hooks.useXpHistory.mockReturnValue(ok(days(40, 3)));
    hooks.useXpLedger.mockReturnValue(ok([tx({ id: 1 }), tx({ id: 2, amount: -50, source: "class_purchase" })]));
  });

  it("shows the summary cards and the chart", () => {
    render(<Stats />);
    expect(within(screen.getByTestId("streak-card")).getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Wednesday")).toBeInTheDocument();
    expect(screen.getByTestId("xp-chart")).toBeInTheDocument();
  });

  it("says there is nothing to chart instead of drawing a flat line", () => {
    hooks.useXpHistory.mockReturnValue(ok(days(0, 0)));
    render(<Stats />);
    expect(screen.getByText(/nothing to chart/i)).toBeInTheDocument();
    expect(screen.queryByTestId("xp-chart")).not.toBeInTheDocument();
  });

  it("asks for the chosen range when a range button is pressed", async () => {
    render(<Stats />);
    await userEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(hooks.useXpHistory).toHaveBeenLastCalledWith(90); // the heatmap's own request
    expect(hooks.useXpHistory.mock.calls.some(([d]) => d === 7)).toBe(true);
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lists recent XP with a label from the summary, a readable fallback and signed amounts", () => {
    render(<Stats />);
    const list = screen.getByRole("list", { name: "Recent XP transactions" });
    expect(within(list).getByText("Finished tasks")).toBeInTheDocument(); // label from the summary
    expect(within(list).getByText("Class purchase")).toBeInTheDocument(); // humanized source
    expect(within(list).getByText("+10 XP")).toBeInTheDocument();
    expect(within(list).getByText("-50 XP")).toBeInTheDocument();
  });

  it("says so when there are no XP transactions yet", () => {
    hooks.useXpLedger.mockReturnValue(ok([]));
    render(<Stats />);
    expect(screen.getByText("No XP transactions yet.")).toBeInTheDocument();
  });

  it("shows an error card when the stats cannot be loaded", () => {
    hooks.useStatsSummary.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("x"), refetch: vi.fn(), isFetching: false });
    render(<Stats />);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });
});
