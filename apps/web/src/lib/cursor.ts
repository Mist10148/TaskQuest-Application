/**
 * The keyboard cursor over a list of task ids (j moves down, k up). Pure so it can be tested without a page.
 * `current` may be null or an id that is no longer in `order` (it was deleted): the cursor then starts at the
 * first row going down, or the last going up. It stops at the ends instead of wrapping.
 */
export function stepCursor(order: number[], current: number | null, direction: 1 | -1): number | null {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at === -1) return direction === 1 ? order[0] : order[order.length - 1];
  const next = Math.min(order.length - 1, Math.max(0, at + direction));
  return order[next];
}
