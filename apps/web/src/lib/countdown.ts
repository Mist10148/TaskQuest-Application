/** Pure helpers for the "next daily reward" countdown. */

export const DAILY_COOLDOWN_MS = 24 * 3600 * 1000;

/** When the daily reward can next be claimed (rolling 24h from the last claim), or null if never claimed. */
export function nextClaimAt(lastClaimMs: number | null | undefined): number | null {
  return lastClaimMs && lastClaimMs > 0 ? lastClaimMs + DAILY_COOLDOWN_MS : null;
}

/** "5h 12m", "12m" or "<1m"; rounds up so the label never claims the wait is shorter than it is. */
export function formatCountdown(ms: number): string {
  if (!(ms > 0)) return "now";
  const totalMinutes = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Like formatCountdown but with days for long waits: "3d 4h", "5h 12m", "12m". */
export function formatLongCountdown(ms: number): string {
  if (!(ms > 0)) return "now";
  const totalMinutes = Math.ceil(ms / 60_000);
  const d = Math.floor(totalMinutes / 1440);
  if (d === 0) return formatCountdown(ms);
  const h = Math.floor((totalMinutes % 1440) / 60);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}
