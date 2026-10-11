/** Command palette: the command shape and the pure filter behind the search box. */

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra words that should find the command ("dark light" for the theme toggle). */
  keywords?: string;
  /** Section heading, e.g. "Go to" or "Actions". */
  group: string;
}

/** Fired on window to open the palette from anywhere (the sidebar button, the shortcuts dialog). */
export const OPEN_PALETTE_EVENT = "tq:open-palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

/**
 * Commands matching every word of `query`, best first: label starts with it, then label contains it,
 * then only the keywords contain it. An empty query keeps the original order.
 */
export function filterCommands<T extends PaletteCommand>(commands: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...commands];
  const scored: Array<{ command: T; score: number; index: number }> = [];
  commands.forEach((command, index) => {
    const label = command.label.toLowerCase();
    const haystack = `${label} ${(command.keywords ?? "").toLowerCase()}`;
    if (!words.every((w) => haystack.includes(w))) return;
    const score = words.every((w) => label.startsWith(w) || label.includes(` ${w}`)) ? 0 : words.every((w) => label.includes(w)) ? 1 : 2;
    scored.push({ command, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.command);
}

/** Move the highlighted row by `delta`, wrapping around; 0 when the list is empty. */
export function moveActive(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}
