/** First-run tour: which step each page of the overlay shows, and the "seen" flag in localStorage. */

export interface TourStep {
  title: string;
  body: string;
  /** Route the step is about; the tour links there. */
  to?: string;
  toLabel?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { title: "Quests hold your tasks", body: "Make a quest, add tasks (try quick add: \"Pay rent tomorrow !high #home\") and tick them off to earn XP.", to: "/tasks", toLabel: "Open Tasks" },
  { title: "Earn XP and level up", body: "Finishing tasks, daily rewards and games pay XP. Claim your daily reward on the dashboard to build a streak.", to: "/dashboard", toLabel: "Open Dashboard" },
  { title: "Spend XP on classes and skills", body: "Classes change how you earn; skills add permanent bonuses. You always see the price before you buy.", to: "/classes", toLabel: "See Classes" },
  { title: "Jump anywhere with Ctrl+K", body: "Press Ctrl+K (Cmd+K on Mac) to open the command palette: go to any page, add a quest or switch theme. Press ? on the Tasks page for more shortcuts." },
];

const KEY = "tq.tourSeen";

/** The slice of Storage the tour needs (so tests can pass a fake). */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): TourStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // storage blocked
  }
}

/** True once the tour was finished or skipped. If storage is unavailable the tour counts as seen, so it never nags. */
export function hasSeenTour(storage: TourStorage | null = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function markTourSeen(storage: TourStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, "1");
  } catch {
    /* storage blocked: the tour may show again next visit */
  }
}

export function resetTour(storage: TourStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* nothing to reset */
  }
}

const STEP_KEY = "tq.tourStep";

function sessionStore(): TourStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The step the tour was on, kept for the tab so it resumes on the next page instead of restarting (each page mounts its own tour). */
export function readTourStep(storage: TourStorage | null = sessionStore()): number {
  try {
    const n = Number(storage?.getItem(STEP_KEY));
    return Number.isInteger(n) ? clampStep(n) : 0;
  } catch {
    return 0;
  }
}

export function saveTourStep(step: number, storage: TourStorage | null = sessionStore()): void {
  try {
    if (step <= 0) storage?.removeItem(STEP_KEY);
    else storage?.setItem(STEP_KEY, String(clampStep(step)));
  } catch {
    /* the step just is not remembered */
  }
}

/** Fired on window to start the tour on demand (Settings > Replay tour). */
export const START_TOUR_EVENT = "tq:start-tour";

export function startTour(): void {
  window.dispatchEvent(new Event(START_TOUR_EVENT));
}

/** Clamp a step index into the valid range. */
export function clampStep(index: number, count: number = TOUR_STEPS.length): number {
  return Math.max(0, Math.min(count - 1, index));
}
