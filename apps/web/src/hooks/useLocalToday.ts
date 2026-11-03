import { useEffect, useState } from "react";
import { localToday, onUserZoneChange } from "@/lib/dates";

/**
 * Today's date in the player's time zone, kept current: checked every minute, when the tab comes back into view and when the
 * time zone setting changes, so a page left open overnight (or a zone just saved) moves "due today" and "overdue" at once.
 */
export function useLocalToday(checkMs = 60_000): string {
  const [today, setToday] = useState(() => localToday());

  useEffect(() => {
    const check = () => setToday(localToday());
    const id = window.setInterval(check, checkMs);
    document.addEventListener("visibilitychange", check);
    const unsubscribe = onUserZoneChange(check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", check);
      unsubscribe();
    };
  }, [checkMs]);

  return today;
}
