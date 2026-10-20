import { Flame } from "lucide-react";
import { streakStrip } from "@/lib/streakStrip";
import { cn } from "@/lib/utils";

interface Props {
  /** Today in the player's time zone (YYYY-MM-DD). */
  day: string;
  /** The streak as it stands today. */
  live: number;
  claimedToday: boolean;
}

/** The last seven days of the daily-reward streak (Today page and dashboard). */
export const StreakStrip = ({ day, live, claimedToday }: Props) => {
  const days = streakStrip(day, live, claimedToday);
  return (
    <section aria-label="Your streak this week" className="rounded-xl border border-border bg-card p-3" data-testid="streak-strip">
      <div className="mb-2 flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-heading font-semibold"><Flame className="h-4 w-4 text-destructive-text" aria-hidden /> {live > 0 ? `${live}-day streak` : "No streak yet"}</span>
        <span className="text-xs text-foreground-muted">{claimedToday ? "Claimed today" : "Claim your daily reward to keep it"}</span>
      </div>
      <ol className="grid grid-cols-7 gap-1 text-center text-xs">
        {days.map((d) => (
          <li key={d.day} className={cn("rounded-lg border px-1 py-2", d.state === "kept" ? "border-destructive/40 bg-destructive/10" : "border-border", d.isToday && "ring-2 ring-ring")}>
            <div className="text-foreground-muted">{d.label}<span className="sr-only">{`: ${d.state === "kept" ? "streak day" : d.state === "today-open" ? "today, not claimed yet" : "no claim"}`}</span></div>
            <Flame className={cn("mx-auto mt-1 h-4 w-4", d.state === "kept" ? "text-destructive-text" : "text-foreground-muted/40")} aria-hidden />
          </li>
        ))}
      </ol>
    </section>
  );
};
