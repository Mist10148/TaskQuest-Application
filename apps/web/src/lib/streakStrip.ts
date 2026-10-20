/** The last seven days of the daily-reward streak, for the strip on the Today page. */

export type StreakDayState = "kept" | "today-open" | "missed";

export interface StreakDay {
  /** YYYY-MM-DD in the player's time zone. */
  day: string;
  /** Mon, Tue... */
  label: string;
  state: StreakDayState;
  isToday: boolean;
}

const LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar arithmetic on a YYYY-MM-DD string (UTC, so it has no daylight-saving surprises). */
function shift(day: string, delta: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta));
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * `live` is the streak as it stands today (it counts today only when claimed); `today` is the player's
 * current day. The streak covers the `live` days ending today if claimed, else ending yesterday.
 */
export function streakStrip(today: string, live: number, claimedToday: boolean, length = 7): StreakDay[] {
  const out: StreakDay[] = [];
  for (let back = length - 1; back >= 0; back--) {
    const date = shift(today, -back);
    const isToday = back === 0;
    // Days since the last kept day: 0 for today when claimed, otherwise yesterday is the last kept day.
    const age = claimedToday ? back : back - 1;
    const kept = live > 0 && age >= 0 && age < live;
    out.push({
      day: iso(date),
      label: LABELS[date.getUTCDay()],
      state: kept ? "kept" : isToday ? "today-open" : "missed",
      isToday,
    });
  }
  return out;
}
