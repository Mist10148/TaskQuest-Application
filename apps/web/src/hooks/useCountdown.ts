import { useEffect, useState } from "react";

/**
 * Milliseconds left until `targetMs` (0 once reached or when null). Re-evaluates on a
 * timer, so a button disabled "until tomorrow" comes back without a page reload.
 */
export function useCountdown(targetMs: number | null, tickMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (targetMs === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= targetMs) window.clearInterval(id);
    }, tickMs);
    return () => window.clearInterval(id);
  }, [targetMs, tickMs]);

  return targetMs === null ? 0 : Math.max(0, targetMs - now);
}
