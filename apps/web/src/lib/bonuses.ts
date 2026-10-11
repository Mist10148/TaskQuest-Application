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

/** Description for an unlocked achievement; mentions the XP it paid when the server says so. */
export function achievementDescription(ach: Pick<AchievementUnlock, "description" | "xp">): string {
  return ach.xp && ach.xp > 0 ? `${ach.description} · +${ach.xp} XP` : ach.description;
}
