import type { KeyboardEvent } from "react";

/** Where an arrow (or Home/End) key moves in a radio group of `count` options, wrapping around; null for any other key. */
export function nextRadioIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Keyboard handling for a group of role="radio" buttons (the WAI-ARIA radio group pattern): the group is one tab stop, and
 * the arrow keys move to the next option and select it. Give each option `tabIndex={checked ? 0 : -1}` (the first one when
 * none is checked) and `onKeyDown={(e) => radioKeyDown(e, index, values, onSelect)}`.
 */
export function radioKeyDown<T>(event: KeyboardEvent<HTMLElement>, index: number, values: readonly T[], onSelect: (value: T) => void): void {
  const next = nextRadioIndex(event.key, index, values.length);
  if (next === null) return;
  event.preventDefault();
  onSelect(values[next]);
  const options = event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]');
  options?.[next]?.focus();
}
