import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodayData, TodayTask } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  TOGGLE_ITEM_KEY: ["toggle-item"],
  useToday: vi.fn(),
  useToggleItem: vi.fn(),
  useWriteReflection: vi.fn(),
  useSetGoal: vi.fn(),
  useClaimGoal: vi.fn(),
  useUpdateItem: vi.fn(),
}));
const daily = vi.hoisted(() => ({ claim: vi.fn(), pending: false, waitMs: 0, claimed: false, everClaimed: true }));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/hooks/useDailyClaim", () => ({ useDailyClaim: () => daily }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ai/PriorityPanel", () => ({ PriorityPanel: () => null }));

import Today from "./Today";

const task = (id: number, name: string, dueDate: string | null, over: Partial<TodayTask> = {}): TodayTask => ({
  id,
  name,
  listId: 1,
  listName: "Home",
  dueDate,
  priority: null,
  estimateMinutes: null,
  overdueDays: 0,
  ...over,
});

const day = (over: Partial<TodayData> = {}): TodayData => ({
  day: "2030-01-10",
  season: { key: "spring", name: "Spring", blurb: "", doubles: "", enabled: false },
  streak: { count: 0, live: 0, claimedToday: false, daysLeft: null, atRisk: false },
  counts: { dueToday: 1, overdue: 0, doneToday: 0 },
  tasks: [task(1, "Pay rent", "2030-01-10")],
  upcoming: [],
  reflection: { day: "2030-01-10", reflection: null, reward: 10, maxLength: 200 },
  goal: { weekStart: "2030-01-07", resetsAt: "2030-01-14T00:00:00.000Z", target: null, progress: 0, claimed: false, claimable: false, reward: null, min: 3, max: 60 },
  xpEnabled: true,
  ...over,
});

const load = (data: TodayData) => hooks.useToday.mockReturnValue({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><Today /></MemoryRouter>
    </QueryClientProvider>
  );

describe("Today page", () => {
  beforeEach(() => {
    const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    hooks.useToggleItem.mockReturnValue(idle);
    hooks.useWriteReflection.mockReturnValue(idle);
    hooks.useSetGoal.mockReturnValue(idle);
    hooks.useClaimGoal.mockReturnValue(idle);
    hooks.useUpdateItem.mockReturnValue({ ...idle, mutate: vi.fn() });
    daily.claim.mockReset();
  });

  it("lists the week ahead under its own heading, with relative due dates", () => {
    load(day({ upcoming: [task(2, "Dentist", "2030-01-11"), task(3, "Book club", "2030-01-14")] }));
    show();
    const upcoming = screen.getByRole("region", { name: "Coming up this week" });
    const items = within(upcoming).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining("Dentist"), expect.stringContaining("Book club")]);
    expect(items[0]).toHaveTextContent("Tomorrow");
    expect(items[1]).toHaveTextContent("in 4 days");
    expect(screen.getByRole("region", { name: "What needs doing" })).toHaveTextContent("Today");
  });

  it("leaves the section out when nothing is coming up, or the server does not send it", () => {
    load(day());
    const { unmount } = show();
    expect(screen.queryByRole("region", { name: "Coming up this week" })).toBeNull();
    unmount();
    load(day({ upcoming: undefined }));
    show();
    expect(screen.queryByRole("region", { name: "Coming up this week" })).toBeNull();
  });

  it("claims the daily reward from the streak warning itself", async () => {
    load(day({ streak: { count: 5, live: 5, claimedToday: false, daysLeft: 0, atRisk: true, expiresAt: null } }));
    show();
    const warning = screen.getByTestId("streak-warning");
    expect(warning).toHaveTextContent("5-day streak");
    await userEvent.click(within(warning).getByRole("button", { name: "Claim now" }));
    expect(daily.claim).toHaveBeenCalled();
  });

  it("opens a task in its quest, and snoozes a task due today to tomorrow", async () => {
    load(day());
    show();
    expect(screen.getByRole("link", { name: "Pay rent" })).toHaveAttribute("href", "/tasks?list=1&task=1");
    await userEvent.click(screen.getByRole("button", { name: 'Snooze "Pay rent" to tomorrow' }));
    const mutate = hooks.useUpdateItem.mock.results[0].value.mutate;
    expect(mutate).toHaveBeenCalledWith({ itemId: 1, data: { due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } }, expect.anything());
  });

  it("offers no snooze for a task that is only HIGH priority, with no date", () => {
    load(day({ tasks: [task(4, "Big thing", null, { priority: "HIGH" })] }));
    show();
    expect(screen.queryByRole("button", { name: /Snooze/ })).toBeNull();
  });

  it("sets a weekly goal only in range, and says why the button is off", async () => {
    load(day());
    show();
    const box = screen.getByLabelText(/Tasks to finish this week/);
    await userEvent.clear(box);
    await userEvent.type(box, "100");
    expect(screen.getByText("Enter a whole number from 3 to 60.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set goal" })).toBeDisabled();
    await userEvent.clear(box);
    await userEvent.type(box, "12");
    await userEvent.click(screen.getByRole("button", { name: "Set goal" }));
    expect(hooks.useSetGoal.mock.results[0].value.mutate).toHaveBeenCalledWith(12, expect.anything());
  });

  it("wants a weekly goal above this week's progress, and the suggestion follows it", async () => {
    const goal = { ...day().goal, progress: 8 };
    load(day({ goal }));
    show();
    const box = screen.getByLabelText(/Tasks to finish this week \(9 to 60\)/);
    expect(box).toHaveValue(13);
    await userEvent.clear(box);
    await userEvent.type(box, "8");
    expect(screen.getByText("Enter a whole number from 9 to 60.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set goal" })).toBeDisabled();
  });

  it("changes a goal that is set but not claimed", async () => {
    load(day({ goal: { ...day().goal, target: 10, progress: 4, reward: 100 } }));
    show();
    await userEvent.click(screen.getByRole("button", { name: "Change goal" }));
    const box = screen.getByLabelText(/Tasks to finish this week/);
    expect(box).toHaveValue(10);
    await userEvent.clear(box);
    await userEvent.type(box, "7");
    await userEvent.click(screen.getByRole("button", { name: "Set goal" }));
    expect(hooks.useSetGoal.mock.results.at(-1)?.value.mutate).toHaveBeenCalledWith(7, expect.anything());
  });

  it("offers no change once the goal is claimed", () => {
    load(day({ goal: { ...day().goal, target: 10, progress: 12, claimed: true, reward: 100 } }));
    show();
    expect(screen.queryByRole("button", { name: "Change goal" })).toBeNull();
  });

  it("says when this week is already past the largest goal", () => {
    load(day({ goal: { ...day().goal, progress: 60 } }));
    show();
    expect(screen.getByText(/more than the largest goal/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set goal" })).toBeDisabled();
  });

  it("links each task to a focus session", () => {
    load(day());
    show();
    expect(screen.getByRole("link", { name: 'Focus on "Pay rent"' })).toHaveAttribute("href", "/focus?task=1");
  });
});
