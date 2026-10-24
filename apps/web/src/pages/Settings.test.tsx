import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  useUpdateSettings: vi.fn(),
  useResetProgress: vi.fn(),
  usePushConfig: vi.fn(),
}));
const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/contexts/AuthContext", () => auth);
vi.mock("@/contexts/PreferencesContext", () => ({
  TEXT_SIZES: ["normal", "large", "larger"],
  usePreferences: () => ({ reduceMotion: false, setReduceMotion: vi.fn(), sound: true, setSound: vi.fn(), highContrast: false, setHighContrast: vi.fn(), textSize: "normal", setTextSize: vi.fn() }),
}));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/layout/ThemeToggle", () => ({ ThemeToggle: () => <div /> }));
vi.mock("@/components/settings/ReminderSettings", () => ({ ReminderSettings: () => <div /> }));
vi.mock("@/components/settings/PushSettings", () => ({ PushSettings: () => <div /> }));
vi.mock("@/components/settings/DataSettings", () => ({ CalendarFeed: () => <div />, DataSettings: () => <div /> }));
vi.mock("@/lib/tour", () => ({ resetTour: vi.fn(), startTour: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Settings from "./Settings";

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Settings />
    </QueryClientProvider>,
  );

describe("Settings page", () => {
  const save = vi.fn();
  const reset = vi.fn();
  const refresh = vi.fn();
  beforeEach(() => {
    save.mockReset().mockResolvedValue({});
    reset.mockReset().mockResolvedValue({});
    refresh.mockReset().mockResolvedValue(undefined);
    hooks.useUpdateSettings.mockReturnValue({ mutateAsync: save });
    hooks.useResetProgress.mockReturnValue({ mutateAsync: reset, isPending: false });
    hooks.usePushConfig.mockReturnValue({ data: { enabled: false } });
    auth.useAuth.mockReturnValue({ user: { user: { gamification_enabled: 1, accept_invites: 1 }, features: {} }, logout: vi.fn(), refresh });
  });

  it("saves a switch with its server field name", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("switch", { name: /enable gamification/i }));
    expect(save).toHaveBeenCalledWith({ gamification_enabled: false });
  });

  it("keeps Reset Everything disabled until RESET is typed exactly", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Reset Progress" }));
    const confirm = screen.getByRole("button", { name: /reset everything/i });
    const field = screen.getByLabelText(/to confirm/i);
    expect(confirm).toBeDisabled();
    await userEvent.type(field, "reset");
    expect(confirm).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, "RESET");
    expect(confirm).toBeEnabled();
  });

  it("resets when RESET is typed and Enter is pressed, then refreshes the session", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Reset Progress" }));
    await userEvent.type(screen.getByLabelText(/to confirm/i), "RESET{Enter}");
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("does not reset on Enter while the word is wrong", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Reset Progress" }));
    await userEvent.type(screen.getByLabelText(/to confirm/i), "nope{Enter}");
    expect(reset).not.toHaveBeenCalled();
  });
});
