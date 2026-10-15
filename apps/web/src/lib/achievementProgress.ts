/** Progress toward a locked achievement, from the stats the page already has. */

export interface AchievementStats {
  lists: number;
  items: number;
  completed: number;
  lifetimeXP: number;
  level: number;
  streak: number;
  gamesWon: number;
}

type Metric = keyof AchievementStats;

/**
 * Goals for the achievements whose number is visible to the client. Achievements missing
 * here (spending, natural blackjack, class collections...) simply show no hint.
 */
const GOALS: Record<string, [Metric, number, string]> = {
  FIVE_LISTS: ["lists", 5, "lists"],
  TEN_LISTS: ["lists", 10, "lists"],
  TEN_ITEMS: ["items", 10, "tasks"],
  FIFTY_ITEMS: ["items", 50, "tasks"],
  HUNDRED_ITEMS: ["items", 100, "tasks"],
  TEN_COMPLETE: ["completed", 10, "tasks done"],
  FIFTY_COMPLETE: ["completed", 50, "tasks done"],
  HUNDRED_COMPLETE: ["completed", 100, "tasks done"],
  XP_100: ["lifetimeXP", 100, "XP"],
  XP_500: ["lifetimeXP", 500, "XP"],
  XP_1000: ["lifetimeXP", 1000, "XP"],
  XP_5000: ["lifetimeXP", 5000, "XP"],
  XP_10000: ["lifetimeXP", 10000, "XP"],
  LEVEL_5: ["level", 5, "level"],
  LEVEL_10: ["level", 10, "level"],
  LEVEL_25: ["level", 25, "level"],
  LEVEL_50: ["level", 50, "level"],
  STREAK_3: ["streak", 3, "days"],
  STREAK_7: ["streak", 7, "days"],
  STREAK_14: ["streak", 14, "days"],
  STREAK_30: ["streak", 30, "days"],
  GAME_WIN_10: ["gamesWon", 10, "wins"],
};

export interface Progress {
  current: number;
  goal: number;
  unit: string;
  /** 0-100 */
  percent: number;
}

/** Progress toward `key`, or null when the client has no number for it. */
export function achievementProgress(key: string, stats: AchievementStats): Progress | null {
  const entry = GOALS[key];
  if (!entry) return null;
  const [metric, goal, unit] = entry;
  const current = Math.max(0, Math.min(goal, Math.floor(Number(stats[metric]) || 0)));
  return { current, goal, unit, percent: Math.round((current / goal) * 100) };
}

/** Animation delay that grows with position but never makes late items wait: capped at `max` seconds. */
export function cappedDelay(base: number, index: number, step: number, max = 0.6): number {
  return Math.min(base + index * step, max);
}

export interface NextUnlock {
  key: string;
  progress: Progress;
  /** How much is left, in the same unit. */
  remaining: number;
}

/**
 * The locked achievements closest to unlocking (most progress first, then the smallest goal), for the "next unlocks" hint.
 * Only achievements the client can count are considered, and ones that have not been started are left out.
 */
export function nextUnlocks(lockedKeys: readonly string[], stats: AchievementStats, limit = 3): NextUnlock[] {
  const out: NextUnlock[] = [];
  for (const key of lockedKeys) {
    const progress = achievementProgress(key, stats);
    if (!progress || progress.current <= 0 || progress.current >= progress.goal) continue;
    out.push({ key, progress, remaining: progress.goal - progress.current });
  }
  out.sort((a, b) => b.progress.percent - a.progress.percent || a.progress.goal - b.progress.goal);
  return out.slice(0, limit);
}
