import type { Achievement } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Lock, Trophy, Sparkles, Star, Medal } from "lucide-react";
import { useState } from "react";
import { useAchievements } from "@/hooks/useApi";
import { useAuth } from "@/contexts/AuthContext";
import { achievementProgress, cappedDelay, type AchievementStats } from "@/lib/achievementProgress";
import { lifetimeTotal } from "@/lib/prestige";
import { ErrorCard } from "@/components/feedback/ErrorCard";

const CATEGORY_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  lists: { label: 'Lists', emoji: '📋', color: 'from-blue-500/20 to-blue-500/5' },
  productivity: { label: 'Productivity', emoji: '📝', color: 'from-purple-500/20 to-purple-500/5' },
  completions: { label: 'Completion', emoji: '✅', color: 'from-emerald-500/20 to-emerald-500/5' },
  xp: { label: 'Experience', emoji: '✨', color: 'from-yellow-500/20 to-yellow-500/5' },
  streaks: { label: 'Streaks', emoji: '🔥', color: 'from-orange-500/20 to-orange-500/5' },
  levels: { label: 'Levels', emoji: '⬆️', color: 'from-violet-500/20 to-violet-500/5' },
  classes: { label: 'Classes', emoji: '⚔️', color: 'from-red-500/20 to-red-500/5' },
  games: { label: 'Games', emoji: '🎮', color: 'from-pink-500/20 to-pink-500/5' },
  economy: { label: 'Economy', emoji: '🛍️', color: 'from-cyan-500/20 to-cyan-500/5' },
};

const CATEGORY_ORDER = ['lists', 'productivity', 'completions', 'xp', 'streaks', 'levels', 'classes', 'games', 'economy'];

type Filter = "all" | "unlocked" | "locked";
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unlocked", label: "Unlocked" },
  { value: "locked", label: "Locked" },
];

const Achievements = () => {
  const { data, isLoading, isError, error, refetch, isFetching } = useAchievements();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");

  // Numbers the page already has, for the "3/5 lists" hints on locked achievements.
  const stats: AchievementStats = {
    lists: Number(user?.lists?.total) || 0,
    items: Number(user?.items?.total) || 0,
    completed: Number(user?.items?.completed) || 0,
    lifetimeXP: user?.user ? lifetimeTotal(user.user) : 0, // the never-reset total, as the server unlocks on
    level: Number(user?.user?.player_level) || 1,
    streak: Number(user?.user?.streak_count) || 0,
    gamesWon: Number(user?.games?.won) || 0,
  };

  const achievements = data?.achievements || [];
  const unlockedCount = data?.unlockedCount || 0;
  const totalCount = data?.totalCount || achievements.length;

  const shown = achievements.filter((a: Achievement) => filter === "all" || (filter === "unlocked" ? a.unlocked : !a.unlocked));
  const grouped = shown.reduce((acc: Record<string, Achievement[]>, ach: Achievement) => {
    const cat = ach.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(ach);
    return acc;
  }, {} as Record<string, Achievement[]>);

  // Known categories first, then any the server adds later, so no achievement is ever hidden.
  const sortedCategories = [...CATEGORY_ORDER.filter(cat => grouped[cat]), ...Object.keys(grouped).filter(cat => !CATEGORY_ORDER.includes(cat))];
  const progressPercent = totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0;

  return (
    <DashboardLayout>
      <div className="mb-6 sm:mb-8">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold mb-2 flex items-center gap-3">
            <div className="relative">
              <Medal className="h-8 w-8 text-xp" />
              <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ repeat: Infinity, duration: 2, repeatDelay: 3 }} className="absolute -top-1 -right-1">
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
              </motion.div>
            </div>
            Achievements
          </h1>
          <p className="text-foreground-muted text-sm sm:text-base">Track your accomplishments and milestones</p>
        </motion.div>
      </div>

      {/* Progress Card */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-6 sm:mb-8 p-4 sm:p-6 rounded-xl bg-linear-to-br from-card to-card/50 border border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-xp/5 via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-xl bg-xp/20 flex items-center justify-center">
                <Trophy className="h-5 w-5 text-xp" />
              </div>
              <div>
                <span className="font-heading font-semibold text-sm sm:text-base">Overall Progress</span>
                <p className="text-xs text-foreground-muted">Keep earning achievements!</p>
              </div>
            </div>
            <div className="text-right">
              <span className="font-heading font-bold text-xp text-xl sm:text-2xl">{unlockedCount}</span>
              <span className="text-foreground-muted text-sm">/{totalCount}</span>
            </div>
          </div>
          <div className="h-3 sm:h-4 rounded-full bg-background-secondary overflow-hidden">
            <motion.div 
              initial={{ width: 0 }} 
              animate={{ width: `${progressPercent}%` }} 
              transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }} 
              className="h-full rounded-full bg-linear-to-r from-xp via-yellow-400 to-xp relative"
            >
              <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
            </motion.div>
          </div>
          {progressPercent === 100 && (
            <p className="text-xs text-xp mt-2 font-medium flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> All achievements unlocked! You're a legend!
            </p>
          )}
        </div>
      </motion.div>

      <div role="group" aria-label="Filter achievements" className="mb-6 flex w-fit gap-1 rounded-lg bg-background-secondary p-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", filter === f.value ? "bg-card text-foreground shadow-xs" : "text-foreground-muted hover:text-foreground")}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div>
        {isError ? (
          <ErrorCard what="your achievements" error={error} onRetry={() => void refetch()} retrying={isFetching} />
        ) : isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {[...Array(9)].map((_, i) => <div key={i} className="h-24 sm:h-32 rounded-xl bg-card/50 animate-pulse" />)}
          </div>
        ) : sortedCategories.length === 0 ? (
          <p className="py-12 text-center text-foreground-muted" role="status">
            {filter === "unlocked" ? "Nothing unlocked yet. Finish a task to get started!" : filter === "locked" ? "Everything is unlocked. Legend!" : "No achievements to show."}
          </p>
        ) : (
          sortedCategories.map((category, catIndex) => {
            const categoryInfo = CATEGORY_LABELS[category] || { label: category, emoji: '🏆', color: 'from-gray-500/20 to-gray-500/5' };
            const categoryAchievements = grouped[category];
            const unlockedInCategory = categoryAchievements.filter((a: Achievement) => a.unlocked).length;

            return (
              <motion.div key={category} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: cappedDelay(0.15, catIndex, 0.05, 0.4) }} className="mb-6 sm:mb-8">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <h2 className="text-lg sm:text-xl font-heading font-semibold flex items-center gap-2">
                    <span className="text-xl">{categoryInfo.emoji}</span>
                    <span>{categoryInfo.label}</span>
                  </h2>
                  <span className={cn("text-xs sm:text-sm font-medium px-2 py-1 rounded-full", unlockedInCategory === categoryAchievements.length ? "bg-success/20 text-success" : "bg-background-secondary text-foreground-muted")}>
                    {unlockedInCategory}/{categoryAchievements.length}
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {categoryAchievements.map((ach: Achievement, index: number) => (
                    <motion.div
                      key={ach.key}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: cappedDelay(0.2, index, 0.03, 0.5) }}
                      whileHover={ach.unlocked ? { y: -2, scale: 1.02 } : {}}
                      className={cn(
                        "relative rounded-xl border p-3 sm:p-4 transition-all overflow-hidden group",
                        ach.unlocked 
                          ? "border-xp/50 bg-linear-to-br " + categoryInfo.color 
                          : "border-border bg-card/30"
                      )}
                    >
                      {/* Glow effect for unlocked */}
                      {ach.unlocked && (
                        <div className="absolute inset-0 bg-linear-to-br from-xp/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                      
                      <div className="relative flex items-start gap-2 sm:gap-3">
                        <div className={cn(
                          "h-10 w-10 sm:h-12 sm:w-12 rounded-xl flex items-center justify-center text-xl sm:text-2xl shrink-0 transition-transform",
                          ach.unlocked ? "bg-xp/20 group-hover:scale-110" : "bg-background-secondary opacity-70"
                        )}>
                          {ach.unlocked ? ach.emoji : <Lock className="h-4 w-4 sm:h-5 sm:w-5 text-foreground-muted" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className={cn("font-heading font-semibold text-sm sm:text-base truncate", !ach.unlocked && "text-foreground-muted")}>{ach.name}</h3>
                          <p className="text-xs sm:text-sm text-foreground-muted line-clamp-2">{ach.description}</p>
                          {!ach.unlocked && (() => {
                            const p = achievementProgress(ach.key, stats);
                            return p && (
                              <div className="mt-1.5">
                                <div className="h-1.5 overflow-hidden rounded-full bg-background-tertiary" role="progressbar" aria-label={`${ach.name} progress`} aria-valuemin={0} aria-valuemax={p.goal} aria-valuenow={p.current}>
                                  <div className="h-full rounded-full bg-primary" style={{ width: `${p.percent}%` }} />
                                </div>
                                <p className="mt-0.5 text-[10px] sm:text-xs text-foreground-muted">{p.current.toLocaleString()}/{p.goal.toLocaleString()} {p.unit}</p>
                              </div>
                            );
                          })()}
                          {ach.unlocked && ach.unlockedAt && (
                            <p className="text-[10px] sm:text-xs text-xp mt-1 flex items-center gap-1">
                              <Sparkles className="h-3 w-3" />
                              {new Date(ach.unlockedAt).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      {/* Unlocked badge */}
                      {ach.unlocked && (
                        <div className="absolute top-2 right-2">
                          <motion.div 
                            initial={{ scale: 0, rotate: -180 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: "spring", stiffness: 200 }}
                            className="h-6 w-6 sm:h-7 sm:w-7 rounded-full bg-linear-to-br from-xp to-yellow-400 flex items-center justify-center shadow-lg shadow-xp/30"
                          >
                            <Trophy className="h-3 w-3 sm:h-4 sm:w-4 text-white" />
                          </motion.div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </DashboardLayout>
  );
};

export default Achievements;
