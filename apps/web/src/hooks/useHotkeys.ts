import { useEffect, useRef } from "react";

type Handler = (event: KeyboardEvent) => void;

/** True while the user is typing somewhere a shortcut key should be a letter, not a command. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Single-key shortcuts ("n", "/", "?", ...). They are ignored while typing in a field,
 * while a dialog is open (Escape then closes the dialog), and when a modifier key is
 * held, so they never fight the browser or screen readers.
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
      if (isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return; // Escape then belongs to the dialog
      handler(e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
