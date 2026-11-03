import { useEffect, useRef } from "react";
import { shortcutBlocked } from "@/lib/shortcutGuard";

type Handler = (event: KeyboardEvent) => void;

/**
 * Single-key shortcuts ("n", "/", "?", ...). They are ignored while typing in a field,
 * while a dialog, menu or select list is open (its letters jump to an option), and when
 * a modifier key is held, so they never fight the browser or screen readers.
 */
export function useHotkeys(bindings: Record<string, Handler>, enabled = true) {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const handler = ref.current[e.key];
      if (!handler) return;
      if (shortcutBlocked(e)) return;
      handler(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
