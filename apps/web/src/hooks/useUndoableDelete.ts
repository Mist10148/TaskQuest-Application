import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  ids: number[];
}

/**
 * Delete with a way back. `request` hides the rows at once and shows an Undo toast;
 * only when the toast times out is `run` called for real. If the page is left while
 * deletions are pending they are carried out immediately, never silently dropped.
 */
export function useUndoableDelete(run: (id: number) => Promise<unknown>, delayMs = 6000) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const pending = useRef(new Map<string, Pending>());
  const runRef = useRef(run);
  runRef.current = run;

  const unhide = useCallback((ids: number[]) => {
    setHidden((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const request = useCallback(
    (ids: number[], label: string) => {
      if (!ids.length) return;
      const key = `${Date.now()}-${ids.join(",")}`;
      setHidden((prev) => new Set([...prev, ...ids]));

      const commit = async () => {
        pending.current.delete(key);
        const results = await Promise.allSettled(ids.map((id) => runRef.current(id)));
        // Whatever could not be deleted comes back instead of vanishing from view; deleted rows stay hidden
        // (they are gone from the server, and the list refetch drops them for good).
        unhide(ids.filter((_, i) => results[i].status === "rejected"));
      };

      const timer = setTimeout(commit, delayMs);
      pending.current.set(key, { timer, ids });
      toast(label, {
        duration: delayMs,
        action: {
          label: "Undo",
          onClick: () => {
            const entry = pending.current.get(key);
            if (!entry) return;
            clearTimeout(entry.timer);
            pending.current.delete(key);
            unhide(entry.ids);
          },
        },
      });
    },
    [delayMs, unhide]
  );

  // Leaving the page commits what is pending.
  useEffect(() => {
    const current = pending.current;
    return () => {
      current.forEach(({ timer, ids }) => {
        clearTimeout(timer);
        ids.forEach((id) => void runRef.current(id).catch(() => undefined));
      });
      current.clear();
    };
  }, []);

  return { hidden, request };
}
