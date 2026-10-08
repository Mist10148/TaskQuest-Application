import { useEffect, useState } from "react";

/** True once `active` has been true for `ms` (free instances can take a while to wake up). */
export function useSlow(active: boolean, ms = 5000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return slow;
}
