/**
 * Pure helpers for class counters, streak-freeze limits and the daily reward text.
 * The numbers mirror @taskquest/shared (CLASS_RULES, STREAK_FREEZE*); the server enforces them,
 * these only decide what to display.
 */

import type { DailyClaimResult, FreezeLimits, User, UserSkill } from "./api";

export interface ClassCounter {
  /** e.g. "Rhythm" */
  label: string;
  emoji: string;
  value: number;
  max: number;
  /** Extra hint, e.g. that the Monk rhythm has lapsed. */
  note?: string;
}

const DEFAULT_FREEZE = { cost: 150, max: 3 };

/** Freeze price and cap from the API (`freezeLimits`), falling back to the base values. */
export function freezeLimits(limits?: FreezeLimits | null): { cost: number; max: number } {
  if (!limits || !Number.isFinite(limits.COST) || !Number.isFinite(limits.MAX)) return { ...DEFAULT_FREEZE };
  return { cost: limits.COST, max: limits.MAX };
}

/** YYYY-MM-DD of `now` in the user's IANA zone (UTC when unset or unknown), like the server's per-user day. */
function dayInZone(now: number, zone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

/** The live counter of the equipped class (Monk rhythm, Artisan project, Necromancer souls) or null. */
export function classCounter(user: Partial<User>, skills: UserSkill[] = [], now: number = Date.now()): ClassCounter | null {
  const level = (id: string) => skills.find((s) => s.skill_id === id)?.skill_level ?? 0;
  switch (user.player_class) {
    case "MONK": {
      const max = 14 + (level("monk_discipline") > 0 ? 4 : 0);
      const value = Math.min(max, Number(user.monk_rhythm) || 0);
      const today = dayInZone(now, user.timezone);
      const gap = user.monk_day ? dayNumber(today) - dayNumber(String(user.monk_day)) : null;
      const lapsed = value > 0 && gap !== null && gap > (level("monk_serenity") > 0 ? 2 : 1);
      return { label: "Rhythm", emoji: "🧘", value, max, note: lapsed ? "Lapsed: restarts at 1 on your next action" : undefined };
    }
    case "ARTISAN": {
      const max = 10 + (level("artisan_blueprint") > 0 ? 3 : 0);
      return { label: "Project", emoji: "🛠️", value: Math.min(max, Number(user.artisan_progress) || 0), max };
    }
    case "NECROMANCER": {
      const max = 5 + (level("necro_jar") > 0 ? 3 : 0);
      return { label: "Souls", emoji: "💀", value: Math.min(max, Number(user.necro_souls) || 0), max };
    }
    default:
      return null;
  }
}

/** Text for a milestone chest in whatever shape the server sends it; "" when there is none. */
export function describeChest(chest: DailyClaimResult["chest"]): string {
  if (!chest) return "";
  if (typeof chest === "number") return `+${chest} XP`;
  if (typeof chest === "string") return chest;
  const xp = chest.xp ?? chest.bonusXP ?? chest.amount;
  const label = chest.label ?? chest.name ?? (chest.streak ? `${chest.streak}-day streak` : "");
  return [label, xp !== undefined ? `+${xp} XP` : ""].filter(Boolean).join(": ");
}

/** The toast description for a claimed daily reward. The server's own breakdown wins when present. */
export function dailyDescription(r: DailyClaimResult): string {
  const parts: string[] = [];
  if ((r.classBonus ?? 0) > 0) parts.push(`+${r.classBonus} class`);
  if ((r.streakBonus ?? 0) > 0) parts.push(`+${r.streakBonus} streak (${r.streak} days)`);
  if ((r.skillDailyBonus ?? 0) > 0) parts.push(`+${r.skillDailyBonus} skill`);
  let text = r.bonusInfo?.details || parts.join(", ");
  if ((r.surpriseBonus ?? 0) > 0) text = [text, `🎉 Daily Surprise +${r.surpriseBonus} XP`].filter(Boolean).join(" · ");
  return text;
}
