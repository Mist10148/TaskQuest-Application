/** Pure helpers for the Focus page: clock text, limits and the finish rule. */

export const FOCUS_PRESETS = [15, 25, 45] as const;

/** Milliseconds left until `endsAtMs`, never negative. */
export function remainingMs(endsAtMs: number, nowMs: number): number {
  return Math.max(0, endsAtMs - nowMs);
}

/** "24:59" under an hour, "1:05:00" from an hour on. Rounds up so the clock reads 00:00 only when time is really up. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Whole minutes that have passed since the session started. */
export function elapsedMinutes(startedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000));
}

/** The server pays only when at least `minMinutes` passed; finishing sooner cancels the session. */
export function canFinish(startedAtMs: number, nowMs: number, minMinutes: number): boolean {
  return nowMs - startedAtMs >= minMinutes * 60_000;
}

/** Minutes until finishing pays, rounded up ("3" means in up to 3 minutes); 0 once it does. */
export function minutesUntilPayable(startedAtMs: number, nowMs: number, minMinutes: number): number {
  return Math.max(0, Math.ceil((startedAtMs + minMinutes * 60_000 - nowMs) / 60_000));
}

/** A whole number of minutes within [min, max] from typed text, or null when it is not valid. */
export function parseMinutes(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= min && n <= max ? n : null;
}

/** Tab title while a session runs. */
export function focusTitle(ms: number, base: string): string {
  return `${formatClock(ms)} · Focus${base ? ` – ${base}` : ""}`;
}
