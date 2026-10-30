import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusStatus } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useFocus: vi.fn(),
  useStartFocus: vi.fn(),
  useFinishFocus: vi.fn(),
  useParty: vi.fn(),
  useToday: vi.fn(),
  useToggleItem: vi.fn(),
}));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/sound", () => ({ playSound: vi.fn() }));

import Focus from "./Focus";

const config = { minMinutes: 10, maxMinutes: 90, xpPerMinute: 1, xpPerDay: 120, sessionsPerDay: 6 };
const status = (over: Partial<FocusStatus> = {}): FocusStatus => ({
  active: null,
  today: { sessions: 0, xp: 0, remainingSessions: 6, remainingXP: 120 },
  config,
  ...over,
});
const load = (data: FocusStatus) => hooks.useFocus.mockReturnValue({ data, isLoading: false, isError: false, error: null, refetch: vi.fn(), isFetching: false });
const show = (path = "/focus") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Focus />
    </MemoryRouter>
  );

describe("Focus page", () => {
  const start = vi.fn();
  beforeEach(() => {
    start.mockReset();
    hooks.useStartFocus.mockReturnValue({ mutate: start, isPending: false, variables: undefined });
    hooks.useFinishFocus.mockReturnValue({ mutate: vi.fn(), isPending: false });
    hooks.useToday.mockReturnValue({ data: undefined });
    hooks.useToggleItem.mockReturnValue({ mutate: vi.fn(), isPending: false, isSuccess: false });
    hooks.useParty.mockReturnValue({ data: { party: null, invites: [] } });
  });
  afterEach(() => {
    document.title = "";
  });

  it("starts a preset session and checks a custom length", async () => {
    load(status());
    show();
    await userEvent.click(screen.getByRole("button", { name: "25 min" }));
    expect(start).toHaveBeenCalledWith(25);
    await userEvent.type(screen.getByLabelText(/Custom minutes/), "5");
    expect(screen.getByText(/Enter a whole number from 10 to 90/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("says before a session starts that today's focus XP is used up", () => {
    load(status({ today: { sessions: 2, xp: 120, remainingSessions: 4, remainingXP: 0 } }));
    show();
    expect(screen.getByText(/You have earned today's 120 focus XP/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "25 min" })).toBeEnabled();
  });

  it("turns the presets off once every session of the day is used", () => {
    load(status({ today: { sessions: 6, xp: 120, remainingSessions: 0, remainingXP: 0 } }));
    show();
    expect(screen.getByRole("button", { name: "25 min" })).toBeDisabled();
    expect(screen.getByText(/You finished all 6 sessions for today/)).toBeInTheDocument();
    expect(screen.queryByText(/You have earned today's/)).toBeNull();
  });

  it("puts the countdown in the tab title once, without repeating Focus", () => {
    document.title = "Focus · TaskQuest";
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    const endsAt = new Date(Date.now() + 24 * 60_000).toISOString();
    load(status({ active: { sessionId: 3, startedAt, minutes: 25, endsAt } }));
    show();
    expect(document.title).toMatch(/^\d\d:\d\d · Focus – TaskQuest$/);
  });

  it("links to the party's focus quest when there is one", () => {
    load(status());
    hooks.useParty.mockReturnValue({ data: { party: { focusQuest: { progress: 30, target: 120 } }, invites: [] } });
    show();
    expect(screen.getByRole("link", { name: "Open the party" })).toHaveAttribute("href", "/party");
  });

  it("names the task from ?task= and ticks it off", async () => {
    load(status());
    const toggle = vi.fn();
    hooks.useToggleItem.mockReturnValue({ mutate: toggle, isPending: false, isSuccess: false });
    hooks.useToday.mockReturnValue({ data: { tasks: [{ id: 7, name: "Write report", listId: 3, listName: "Work", dueDate: null, priority: null, estimateMinutes: null, overdueDays: 0 }] } });
    show("/focus?task=7");
    expect(screen.getByRole("link", { name: "Write report" })).toHaveAttribute("href", "/tasks?list=3&task=7");
    await userEvent.click(screen.getByRole("button", { name: 'Mark "Write report" done' }));
    expect(toggle).toHaveBeenCalledWith({ itemId: 7, completed: true });
  });

  it("shows no task for an unknown or missing id", () => {
    load(status());
    hooks.useToday.mockReturnValue({ data: { tasks: [] } });
    show("/focus?task=7");
    expect(screen.queryByText("Focusing on")).toBeNull();
  });
});
