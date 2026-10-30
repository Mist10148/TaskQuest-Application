import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameConfig, GameSession, HangmanActive } from "@/lib/api";

const hooks = vi.hoisted(() => ({
  useGameHistory: vi.fn(),
  useGameAllowance: vi.fn(),
  useGameConfig: vi.fn(),
  invalidateProgress: vi.fn(),
  showAchievementNotifications: vi.fn(),
  showError: vi.fn(),
}));
const games = vi.hoisted(() => ({
  getActive: vi.fn(),
  hangmanStart: vi.fn(),
  hangmanGuess: vi.fn(),
  blackjackStart: vi.fn(),
  quit: vi.fn(),
}));
const auth = vi.hoisted(() => ({ xp: 500 }));
vi.mock("@/hooks/useApi", () => hooks);
vi.mock("@/lib/api", () => ({ gamesApi: games }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { user: { player_xp: auth.xp } } }) }));
vi.mock("@/contexts/PreferencesContext", () => ({ usePreferences: () => ({ sound: false, setSound: vi.fn() }), useLocale: () => "en" }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/sound", () => ({ playSound: vi.fn(), setSoundEnabled: vi.fn() }));

import Games from "./Games";

const config: GameConfig = {
  blackjack: { MIN_BET: 10, MAX_BET_PERCENT: 0.25, HARD_CAP: 1000, BLACKJACK_MULTIPLIER: 1.5, WIN_MULTIPLIER: 1 },
  rewards: { rpsWin: 15, hangmanPerLife: 10, hangmanMin: 10 },
  arcade: {
    snake: { name: "Snake", xpPerPoint: 2, maxXP: 100, maxPointsPerSecond: 2 },
    dino: { name: "Dino Runner", xpPerPoint: 1, maxXP: 100, maxPointsPerSecond: 2 },
    invaders: { name: "Space Invaders", xpPerPoint: 3, maxXP: 150, maxPointsPerSecond: 3 },
  },
  limits: { freeGameXPPerDay: 500, cooldownMs: 3000 },
};

const round = (id: number, game_type: string, state: GameSession["state"], net: number): GameSession => ({
  id, game_type, state, net, bet_amount: 0, payout: 0, created_at: "2030-01-10T10:00:00Z", ended_at: "2030-01-10T10:05:00Z",
});

const hangman: HangmanActive = {
  sessionId: 1,
  view: { masked: [null, null, null, null, null], length: 5, guessed: [], wrong: [], lives: 6, maxLives: 6, potentialReward: 60, finished: false, outcome: null, word: null },
};

const at = (path: string) => {
  const client = new QueryClient();
  const ui = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><Games /></MemoryRouter>
    </QueryClientProvider>
  );
  return render(ui);
};

describe("Games page", () => {
  const refetchAllowance = vi.fn();
  beforeEach(() => {
    auth.xp = 500;
    refetchAllowance.mockReset();
    hooks.useGameHistory.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    hooks.useGameAllowance.mockReturnValue({ data: { cap: 500, usedXP: 100, remainingXP: 400, resetsAt: new Date(Date.now() + 3 * 3600e3).toISOString() }, isError: false, refetch: refetchAllowance });
    hooks.useGameConfig.mockReturnValue({ data: config });
    games.getActive.mockReset().mockResolvedValue({ blackjack: null, hangman: null });
    games.hangmanStart.mockReset().mockResolvedValue(hangman);
    games.hangmanGuess.mockReset().mockResolvedValue({ ...hangman, view: { ...hangman.view, guessed: ["E"] }, xpGained: 0, balance: 0, achievements: [] });
    games.quit.mockReset().mockResolvedValue({ success: true });
  });

  it("counts down to the free-game reset", () => {
    at("/games");
    expect(screen.getByText(/400 XP left to earn\. Resets in /)).toBeInTheDocument();
  });

  it("offers a retry when the allowance cannot be loaded", async () => {
    hooks.useGameAllowance.mockReturnValue({ data: undefined, isError: true, refetch: refetchAllowance });
    at("/games");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load today's allowance.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetchAllowance).toHaveBeenCalled();
  });

  it("takes the bet limits from the server's config", () => {
    hooks.useGameConfig.mockReturnValue({ data: { ...config, blackjack: { ...config.blackjack, MIN_BET: 20 } } });
    auth.xp = 60; // 25% is 15, under the minimum of 20
    at("/games");
    expect(screen.getByText(/Blackjack needs at least 80 XP/)).toBeInTheDocument();
  });

  it("sums up the recent rounds per game", () => {
    hooks.useGameHistory.mockReturnValue({
      data: [round(1, "blackjack", "won", 20), round(2, "blackjack", "lost", -10), round(3, "rps", "won", 15)],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    at("/games");
    const tally = screen.getByRole("list", { name: "Results over your last 3 games" });
    expect(tally).toHaveTextContent("Blackjack · 1 won, 1 lost · +10 XP");
    expect(tally).toHaveTextContent("Rock Paper Scissors · 1 won, 0 lost · +15 XP");
  });

  it("shows the rules from the config behind a disclosure button", async () => {
    at("/games?play=rps");
    const toggle = screen.getByRole("button", { name: /Show Rules/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: /Hide Rules/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Win = \+15 XP/)).toBeInTheDocument();
  });

  it("counts Hangman lives in words, and guesses typed letters only when no other shortcut took them", async () => {
    at("/games?play=hangman");
    expect(await screen.findByText("6 of 6 lives left")).toBeInTheDocument();

    // The letter after "g" was taken by the go-to shortcut (it called preventDefault): not a guess.
    const taken = new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true });
    taken.preventDefault();
    act(() => void window.dispatchEvent(taken));
    // A held key repeats: not a guess either.
    fireEvent.keyDown(window, { key: "r", repeat: true });
    expect(games.hangmanGuess).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(games.hangmanGuess).toHaveBeenCalledWith("E"));
  });

  it("keeps Blackjack open when a lost hand drops the balance under the minimum bet", () => {
    const view = at("/games?play=blackjack");
    expect(screen.getByRole("button", { name: /Deal Cards/ })).toBeInTheDocument();
    auth.xp = 20; // 25% of 20 is under the 10 XP minimum
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/games?play=blackjack"]}><Games /></MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByRole("button", { name: /Deal Cards/ })).toBeInTheDocument();
  });

  it("opens the menu instead when a link asks for Blackjack without enough XP", () => {
    auth.xp = 20;
    at("/games?play=blackjack");
    expect(screen.queryByRole("button", { name: /Deal Cards/ })).toBeNull();
    expect(screen.getByText("Game Center")).toBeInTheDocument();
  });
});
