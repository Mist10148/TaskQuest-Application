import type { LeaderboardEntry } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Trophy, Sparkles, Flame, Target, Crown, Medal, Zap } from "lucide-react";
import { useLeaderboard, useMyRank } from "@/hooks/useApi";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import type { LeaderboardBoard } from "@/lib/api";
import { useState } from "react";

const CLASS_EMOJIS: Record<string, string> = {
  DEFAULT: '⚪', HERO: '⚔️', GAMBLER: '🎲', ASSASSIN: '🗡️', WIZARD: '🔮', ARCHER: '🏹', TANK: '🛡️',
};

const CLASS_COLORS: Record<string, string> = {
  DEFAULT: 'bg-gray-500', HERO: 'bg-yellow-500', GAMBLER: 'bg-purple-500', ASSASSIN: 'bg-slate-700', WIZARD: 'bg-blue-500', ARCHER: 'bg-green-500', TANK: 'bg-red-500',
};

// Better Avatar component with multiple fallbacks
const PlayerAvatar = ({ avatarUrl, username, size = 'md', rank }: {
  avatarUrl: string | null; username: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; rank?: number
}) => {
  const [imgError, setImgError] = useState(false);
  const sizeClasses = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base', xl: 'w-16 h-16 text-xl' };
  const ringColors: Record<number, string> = { 1: 'ring-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.5)]', 2: 'ring-gray-400 shadow-[0_0_10px_rgba(156,163,175,0.4)]', 3: 'ring-amber-600 shadow-[0_0_10px_rgba(217,119,6,0.4)]' };
  
  const initials = username ? username.slice(0, 2).toUpperCase() : '??';
  
  // Generate consistent gradient from discordId
  const gradients = [
    'from-violet-500 to-purple-600',
    'from-blue-500 to-cyan-500', 
    'from-emerald-500 to-green-600',
    'from-amber-500 to-orange-600',
    'from-rose-500 to-pink-600',
    'from-cyan-500 to-teal-600',
    'from-fuchsia-500 to-pink-600',
    'from-indigo-500 to-blue-600'
  ];
  const gradientIndex = (rank ?? (username ? username.charCodeAt(0) : 0)) % gradients.length;
  
  const ringColor = rank && rank <= 3 ? ringColors[rank] : 'ring-border';
  
  if (imgError || !avatarUrl) {
    return (
      <div className={cn(
        sizeClasses[size], 
        `bg-gradient-to-br ${gradients[gradientIndex]}`,
        "rounded-full flex items-center justify-center text-white font-bold ring-2",
        ringColor
      )}>
        {initials}
      </div>
    );
  }
  
  return (
    <img 
      src={avatarUrl} 
      alt={username || 'Player'} 
      className={cn(sizeClasses[size], "rounded-full object-cover ring-2", ringColor)}
      onError={() => setImgError(true)}
    />
  );
};

const BOARDS: Array<{ value: LeaderboardBoard; label: string; blurb: string; unit: string }> = [
  { value: "lifetime", label: "Lifetime XP", blurb: "Everyone's total XP ever earned. Spending never lowers it.", unit: "XP" },
  { value: "weekly", label: "This week", blurb: "XP earned since Monday 00:00 UTC.", unit: "XP this week" },
  { value: "streak", label: "Streaks", blurb: "Longest daily-reward streaks right now.", unit: "days" },
  { value: "xp", label: "Balance", blurb: "Current spendable XP.", unit: "XP" },
];

const CLASS_FILTERS = ["ALL", "DEFAULT", "HERO", "GAMBLER", "ASSASSIN", "WIZARD", "ARCHER", "TANK"];

const Leaderboard = () => {
  const [by, setBy] = useState<LeaderboardBoard>("lifetime");
  const [classFilter, setClassFilter] = useState("ALL");
  const board = BOARDS.find((b) => b.value === by) ?? BOARDS[0];
  const { data: leaderboard, isLoading, isError, error, refetch, isFetching } = useLeaderboard(by, classFilter);
  const { data: mine, isLoading: mineLoading, isError: mineFailed } = useMyRank(by, classFilter);
  const entries = leaderboard || [];
  const scoreText = (entry: LeaderboardEntry | undefined) => (entry ? entry.score.toLocaleString() : "");
  const youInList = entries.some((e) => e.isYou);

  const getDisplayName = (entry: LeaderboardEntry | undefined, isCurrentUser: boolean) => {
    if (isCurrentUser) return 'You';
    return entry?.username || 'Adventurer';
  };

  return (
    <DashboardLayout>
      <div className="mb-6 sm:mb-8 px-4 sm:px-0">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold mb-2 flex items-center gap-3">
            <div className="relative">
              <Trophy className="h-8 w-8 text-xp" />
              <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-primary" />
            </div>
            Leaderboard
          </h1>
          <p className="text-foreground-muted text-sm sm:text-base">{board.blurb}</p>
        </motion.div>
      </div>

      <div className="mb-6 flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-0">
        <div role="tablist" aria-label="Leaderboard" className="flex flex-wrap gap-1 rounded-lg bg-background-secondary p-1 w-fit max-w-full">
          {BOARDS.map((b) => (
            <button
              key={b.value}
              role="tab"
              aria-selected={by === b.value}
              onClick={() => setBy(b.value)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", by === b.value ? "bg-card text-foreground shadow-sm" : "text-foreground-muted hover:text-foreground")}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="class-filter" className="text-sm text-foreground-muted">Class</label>
          <select
            id="class-filter"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {CLASS_FILTERS.map((c) => (
              <option key={c} value={c}>{c === "ALL" ? "All classes" : `${CLASS_EMOJIS[c] ?? ""} ${c.charAt(0)}${c.slice(1).toLowerCase()}`}</option>
            ))}
          </select>
        </div>
      </div>

      {mineLoading && <p className="mb-4 px-4 text-sm text-foreground-muted sm:px-0" aria-busy="true">Checking your rank…</p>}
      {mineFailed && <p className="mb-4 px-4 text-sm text-destructive sm:px-0" role="alert">Couldn't load your rank.</p>}
      {mine && (
        <p className="mb-4 px-4 text-sm text-foreground-muted sm:px-0" aria-live="polite">
          {mine.rank
            ? <>Your rank: <span className="font-heading font-bold text-primary">#{mine.rank}</span>{!youInList ? " (outside the top 10)" : ""}</>
            : by === "weekly" || by === "streak"
              ? "You're not on this board yet. Earn some XP or claim your daily reward!"
              : "Turn on gamification to appear on the leaderboard."}
        </p>
      )}

      {/* Top 3 Podium */}
      {entries.length >= 3 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="hidden sm:grid grid-cols-3 gap-4 mb-8 px-4 sm:px-0">
          {/* 2nd Place */}
          <div className="mt-8">
            <motion.div whileHover={{ y: -4 }} className="rounded-xl bg-gradient-to-b from-gray-400/20 to-gray-400/5 border border-gray-400/30 p-5 text-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-gray-400/10 via-transparent to-transparent" />
              <div className="relative">
                <Medal className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                <div className="flex justify-center mb-2">
                  <PlayerAvatar avatarUrl={entries[1]?.avatarUrl ?? null} username={entries[1]?.username} size="lg" rank={2} />
                </div>
                <p className="font-heading font-semibold truncate">{getDisplayName(entries[1], Boolean(entries[1]?.isYou))}</p>
                <p className="text-xp font-bold text-lg">{scoreText(entries[1])} {board.unit}</p>
                <p className="text-xs text-foreground-muted">Level {entries[1]?.level} • {CLASS_EMOJIS[entries[1]?.playerClass] || '⚪'}</p>
              </div>
            </motion.div>
          </div>
          
          {/* 1st Place */}
          <div>
            <motion.div whileHover={{ y: -4 }} className="rounded-xl bg-gradient-to-b from-yellow-500/20 to-yellow-500/5 border border-yellow-500/30 p-6 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-yellow-500/20 via-transparent to-transparent" />
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-500" />
              <div className="relative">
                <Crown className="h-10 w-10 mx-auto text-yellow-500 mb-2" />
                <div className="flex justify-center mb-2">
                  <PlayerAvatar avatarUrl={entries[0]?.avatarUrl ?? null} username={entries[0]?.username} size="xl" rank={1} />
                </div>
                <p className="font-heading font-bold text-lg truncate">{getDisplayName(entries[0], Boolean(entries[0]?.isYou))}</p>
                <p className="text-xp font-bold text-2xl">{scoreText(entries[0])} {board.unit}</p>
                <p className="text-sm text-foreground-muted">Level {entries[0]?.level} • {CLASS_EMOJIS[entries[0]?.playerClass] || '⚪'}</p>
              </div>
            </motion.div>
          </div>
          
          {/* 3rd Place */}
          <div className="mt-12">
            <motion.div whileHover={{ y: -4 }} className="rounded-xl bg-gradient-to-b from-amber-600/20 to-amber-600/5 border border-amber-600/30 p-5 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-amber-600/10 via-transparent to-transparent" />
              <div className="relative">
                <Medal className="h-8 w-8 mx-auto text-amber-600 mb-2" />
                <div className="flex justify-center mb-2">
                  <PlayerAvatar avatarUrl={entries[2]?.avatarUrl ?? null} username={entries[2]?.username} size="lg" rank={3} />
                </div>
                <p className="font-heading font-semibold truncate">{getDisplayName(entries[2], Boolean(entries[2]?.isYou))}</p>
                <p className="text-xp font-bold text-lg">{scoreText(entries[2])} {board.unit}</p>
                <p className="text-xs text-foreground-muted">Level {entries[2]?.level} • {CLASS_EMOJIS[entries[2]?.playerClass] || '⚪'}</p>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* Full Leaderboard */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border bg-card overflow-hidden mx-4 sm:mx-0">
        <div className="hidden sm:grid grid-cols-12 gap-4 p-4 border-b border-border text-sm font-medium text-foreground-muted bg-gradient-to-r from-background-secondary/50 to-transparent">
          <div className="col-span-1">Rank</div>
          <div className="col-span-4">Player</div>
          <div className="col-span-2 text-center">Level</div>
          <div className="col-span-2 text-center">{board.unit}</div>
          <div className="col-span-1 text-center">Streak</div>
          <div className="col-span-2 text-center">Tasks</div>
        </div>

        {isError ? (
          <div className="p-4"><ErrorCard what="the leaderboard" error={error} onRetry={() => void refetch()} retrying={isFetching} /></div>
        ) : isLoading ? (
          [...Array(5)].map((_, i) => <div key={i} className="h-16 border-b border-border animate-pulse bg-card/50" />)
        ) : entries.length === 0 ? (
          <div className="p-8 sm:p-12 text-center text-foreground-muted">
            <Trophy className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{classFilter === "ALL" ? "No rankings yet. Be the first!" : "Nobody in this class has a score on this board yet."}</p>
          </div>
        ) : (
          entries.map((entry: LeaderboardEntry, index: number) => {
            const isCurrentUser = Boolean(entry.isYou);
            const rankBg = entry.rank === 1 ? 'bg-yellow-500/10' : entry.rank === 2 ? 'bg-gray-400/10' : entry.rank === 3 ? 'bg-amber-600/10' : '';

            return (
              <motion.div
                key={`${by}-${classFilter}-${entry.rank}`}
                aria-current={isCurrentUser ? "true" : undefined}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + index * 0.05 }}
                className={cn("border-b border-border last:border-0 transition-all hover:bg-background-secondary/50", isCurrentUser && "bg-primary/10 hover:bg-primary/15", rankBg)}
              >
                {/* Mobile */}
                <div className="sm:hidden p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 flex justify-center">
                      {entry.rank === 1 ? <Crown className="h-5 w-5 text-yellow-500" /> : 
                       entry.rank === 2 ? <Medal className="h-5 w-5 text-gray-400" /> : 
                       entry.rank === 3 ? <Medal className="h-5 w-5 text-amber-600" /> : 
                       <span className="font-heading font-bold text-foreground-muted">#{entry.rank}</span>}
                    </div>
                    <PlayerAvatar avatarUrl={entry.avatarUrl ?? null} username={entry.username} size="sm" rank={entry.rank} />
                    <div className="flex-1 min-w-0">
                      <p className={cn("font-medium text-sm truncate", isCurrentUser && "text-primary")}>
                        {getDisplayName(entry, isCurrentUser)}
                      </p>
                      <p className="text-xs text-foreground-muted flex items-center gap-1">
                        <span>{CLASS_EMOJIS[entry.playerClass] || '⚪'}</span>
                        <span>Lv.{entry.level}</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xp font-bold text-sm flex items-center gap-1"><Sparkles className="h-3 w-3" />{scoreText(entry)}</span>
                      <div className="flex items-center gap-2 text-xs text-foreground-muted mt-1">
                        <span className="flex items-center gap-1 text-orange-700 dark:text-orange-400"><Flame className="h-3 w-3" />{entry.streak}</span>
                        <span className="flex items-center gap-1"><Target className="h-3 w-3" />{entry.tasksCompleted}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Desktop */}
                <div className="hidden sm:grid grid-cols-12 gap-4 p-4 items-center">
                  <div className="col-span-1 flex justify-center">
                    {entry.rank === 1 ? <Crown className="h-6 w-6 text-yellow-500" /> : 
                     entry.rank === 2 ? <Medal className="h-6 w-6 text-gray-400" /> : 
                     entry.rank === 3 ? <Medal className="h-6 w-6 text-amber-600" /> : 
                     <span className="font-heading font-bold text-foreground-muted">#{entry.rank}</span>}
                  </div>
                  <div className="col-span-4 flex items-center gap-3">
                    <PlayerAvatar avatarUrl={entry.avatarUrl ?? null} username={entry.username} size="md" rank={entry.rank} />
                    <div className="min-w-0">
                      <p className={cn("font-medium truncate", isCurrentUser && "text-primary")}>
                        {getDisplayName(entry, isCurrentUser)}
                      </p>
                      <p className="text-xs text-foreground-muted flex items-center gap-1">
                        <span>{CLASS_EMOJIS[entry.playerClass] || '⚪'}</span>
                        <span>{entry.playerClass || 'Default'}</span>
                      </p>
                    </div>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="px-3 py-1 rounded-full bg-background-secondary text-sm font-medium">Lv.{entry.level}</span>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="text-xp font-bold flex items-center justify-center gap-1">
                      <Sparkles className="h-4 w-4" />{scoreText(entry)}
                    </span>
                  </div>
                  <div className="col-span-1 text-center">
                    <span className="flex items-center justify-center gap-1 text-orange-700 dark:text-orange-400">
                      <Flame className="h-4 w-4" />{entry.streak}
                    </span>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="flex items-center justify-center gap-1 text-foreground-muted">
                      <Target className="h-4 w-4" />{entry.tasksCompleted}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </motion.div>
    </DashboardLayout>
  );
};

export default Leaderboard;
