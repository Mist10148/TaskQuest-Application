import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShortcutsDialog } from "@/components/tasks/ShortcutsDialog";
import { GO_TO_WINDOW_MS, goToPath } from "@/lib/goTo";

/** True while the user is typing somewhere a key should be a letter, not a command. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Shortcuts on every page: "?" shows the list of shortcuts, and "g" then a letter goes to a page (g t Today, g q the quest log ...).
 * They listen in the capture phase and mark the keys they use as handled, so a page's own single-key shortcut (d deletes inside a
 * quest) never also runs for the second key of "g d".
 */
export const GlobalShortcuts = ({ aiEnabled }: { aiEnabled: boolean }) => {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingSince = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (pendingSince.current && Date.now() - pendingSince.current < GO_TO_WINDOW_MS) {
        if (e.key === "Shift") return; // still waiting for the letter
        pendingSince.current = 0;
        const path = goToPath(e.key, aiEnabled);
        // The key after "g" is spent even when it goes nowhere, so "g x" never completes the highlighted task.
        if (path || e.key.length === 1) e.preventDefault();
        if (path) navigate(path);
        return;
      }
      pendingSince.current = 0;
      if (e.key === "g") {
        e.preventDefault();
        pendingSince.current = Date.now();
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [aiEnabled, navigate]);

  return <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} aiEnabled={aiEnabled} />;
};
