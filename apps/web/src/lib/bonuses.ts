/** Text for the extra XP a task completion can pay, and for achievement rewards. */

import type { AchievementUnlock, BonusEntry } from "@/lib/api";

/** "+10 First of the day". */
export function formatBonus(bonus: BonusEntry): string {
  return `+${bonus.xp} ${bonus.label}`;
}

/** The lines under a "Task done" toast: level-up first, otherwise the class/skill breakdown, then each flat bonus. */
export function rewardDescription(opts: { leveledUp?: boolean; newLevel?: number; details?: string | null; bonuses?: readonly BonusEntry[] | null }): string | undefined {
  const lines: string[] = [];
  if (opts.leveledUp) lines.push(`🎉 Level up! You are now level ${opts.newLevel}.`);
  else if (opts.details) lines.push(opts.details);
  for (const b of opts.bonuses ?? []) if (b.xp > 0) lines.push(formatBonus(b));
  return lines.length ? lines.join(" · ") : undefined;
}

/**
 * The same reward as separate lines for the toast: the level-up (or the class and skill breakdown, split on its " | " parts:
 * "Base: 10", "🎯 Hit x4 +10", "📚 Skill +10"), then one line per flat bonus.
 */
export function breakdownLines(opts: { leveledUp?: boolean; newLevel?: number; details?: string | null; bonuses?: readonly BonusEntry[] | null }): string[] {
  const lines: string[] = [];
  if (opts.leveledUp) lines.push(`🎉 Level up! You are now level ${opts.newLevel}.`);
  if (opts.details) lines.push(...opts.details.split(" | ").map((p) => p.trim()).filter(Boolean));
  for (const b of opts.bonuses ?? []) if (b.xp > 0) lines.push(formatBonus(b));
  return lines;
}

/** Description for an unlocked achievement; mentions the XP it paid when the server says so. */
export function achievementDescription(ach: Pick<AchievementUnlock, "description" | "xp">): string {
  return ach.xp && ach.xp > 0 ? `${ach.description} · +${ach.xp} XP` : ach.description;
}
