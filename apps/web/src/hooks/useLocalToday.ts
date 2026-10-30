import { useEffect, useState } from "react";
import { localToday } from "@/lib/dates";

/**
 * Today's date in the player's time zone, kept current: checked every minute and when the tab comes back into view, so a
 * page left open overnight moves its "due today" and "overdue" markers on without a reload.
 */
export function useLocalToday(checkMs = 60_000): string {
  const [today, setToday] = useState(() => localToday());

  useEffect(() => {
    const check = () => setToday(localToday());
    const id = window.setInterval(check, checkMs);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, [checkMs]);

  return today;
}
