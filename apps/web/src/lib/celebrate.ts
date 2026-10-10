/**
 * Tiny event bus for celebrations (level up, achievement, quest). Anything can
 * call celebrate(); the CelebrationHost mounted in App draws the burst. Kept
 * outside React so hooks and mutation callbacks can use it.
 */

export type CelebrationKind = "level" | "achievement" | "quest";

type Listener = (kind: CelebrationKind) => void;

const listeners = new Set<Listener>();

export function celebrate(kind: CelebrationKind): void {
  listeners.forEach((l) => l(kind));
}

/** Subscribe to celebrations; returns the unsubscribe function. */
export function onCelebrate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
