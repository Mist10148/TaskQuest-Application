/** Pure helpers for prestige: labels, the confirmation phrase and the never-reset XP total. */

export const PRESTIGE_CONFIRM = "PRESTIGE";

/** True only for the exact confirmation word (after trimming), so a stray click never prestiges. */
export function isPrestigeConfirmation(text: string): boolean {
  return text.trim() === PRESTIGE_CONFIRM;
}

/**
 * The never-reset XP total shown as "Lifetime XP". `lifetime_xp` restarts with each prestige, so the larger of the
 * two columns is used (the server ranks the leaderboard the same way); old servers send only `lifetime_xp`.
 */
export function lifetimeTotal(user: { lifetime_xp?: number | string | null; lifetime_xp_total?: number | string | null; player_xp?: number | string | null }): number {
  const total = Number(user.lifetime_xp_total) || 0;
  const level = Number(user.lifetime_xp ?? user.player_xp) || 0;
  return Math.max(total, level);
}
