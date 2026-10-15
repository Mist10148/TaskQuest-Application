/** Touch gesture logic for a task row: a deliberate swipe to the right completes the task. */

export const SWIPE_DISTANCE = 80;
/** A swipe has to be mostly sideways, so scrolling the page never completes a task. */
export const SWIPE_RATIO = 1.8;

export type SwipeAction = "complete" | null;

/** What a finished touch (dx, dy in pixels from where it began) means. */
export function swipeAction(dx: number, dy: number, distance = SWIPE_DISTANCE): SwipeAction {
  if (dx < distance) return null;
  return Math.abs(dx) >= Math.abs(dy) * SWIPE_RATIO ? "complete" : null;
}

/** How far the row follows the finger (it stops a little past the trigger so it feels springy). */
export function swipeOffset(dx: number, dy: number, distance = SWIPE_DISTANCE): number {
  if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return 0;
  return Math.min(dx, distance * 1.4);
}
