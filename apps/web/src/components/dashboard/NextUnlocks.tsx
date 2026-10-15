import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAchievements } from "@/hooks/useApi";
import { nextUnlocks, type AchievementStats } from "@/lib/achievementProgress";
import { lifetimeTotal } from "@/lib/prestige";

/** The achievements you are closest to: a few progress bars that say what to do next. */
export function NextUnlocks() {
  const { user } = useAuth();
  const { data } = useAchievements();
  if (!data) return null;
  const stats: AchievementStats = {
    lists: Number(user?.lists?.total) || 0,
    items: Number(user?.items?.total) || 0,
    completed: Number(user?.items?.completed) || 0,
    lifetimeXP: user?.user ? lifetimeTotal(user.user) : 0,
    level: Number(user?.user?.player_level) || 1,
    streak: Number(user?.user?.streak_count) || 0,
    gamesWon: Number(user?.games?.won) || 0,
  };
  const names = new Map(data.achievements.map((a) => [a.key, a]));
  const next = nextUnlocks(data.achievements.filter((a) => !a.unlocked).map((a) => a.key), stats, 3);
  if (next.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="next-unlocks-title" data-testid="next-unlocks">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="next-unlocks-title" className="flex items-center gap-2 font-heading font-semibold"><Trophy className="h-5 w-5 text-xp" aria-hidden /> Next unlocks</h2>
        <Link to="/achievements" className="text-xs text-primary-text hover:underline">All achievements</Link>
      </div>
      <ul className="space-y-3">
        {next.map(({ key, progress, remaining }) => (
          <li key={key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{names.get(key)?.emoji} {names.get(key)?.name}</span>
              <span className="shrink-0 text-xs text-foreground-muted">{remaining} {progress.unit} to go</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-background-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={progress.goal} aria-valuenow={progress.current} aria-label={`${names.get(key)?.name} progress`}>
              <div className="h-full rounded-full bg-xp" style={{ width: `${progress.percent}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
