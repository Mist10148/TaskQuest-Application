import { PrestigeTag } from "@/components/game/PrestigeTag";
import { AvatarFrame, EquippedTitle } from "@/components/game/AvatarFrame";
import type { EquippedCosmetics, LeaderboardEntry } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Trophy, Sparkles, Flame, Target, Crown, Medal, Zap } from "lucide-react";
import { useClasses, useLeaderboard, useMyRank } from "@/hooks/useApi";
import { nextTabIndex } from "@/lib/tabs";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import type { LeaderboardBoard } from "@/lib/api";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const CLASS_EMOJIS: Record<string, string> = {
  DEFAULT: '⚪', HERO: '⚔️', GAMBLER: '🎲', ASSASSIN: '🗡️', WIZARD: '🔮', ARCHER: '🏹', TANK: '🛡️',
};

// Better Avatar component with multiple fallbacks
const PlayerAvatar = ({ avatarUrl, username, size = 'md', rank, frame }: {
  avatarUrl: string | null; username: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; rank?: number; frame?: EquippedCosmetics['frame']
}) => {
  return <AvatarFrame frame={frame}><PlayerAvatarImage avatarUrl={avatarUrl} username={username} size={size} rank={rank} /></AvatarFrame>;
};

const PlayerAvatarImage = ({ avatarUrl, username, size = 'md', rank }: {
  avatarUrl: string | null; username: string | null; size?: 'sm' | 'md' | 'lg' | 'xl'; rank?: number
}) => {
  // Remember which URL failed, so a different player in the same slot gets a fresh try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imgError = failedUrl !== null && failedUrl === avatarUrl;
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
        `bg-linear-to-br ${gradients[gradientIndex]}`,
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
      onError={() => setFailedUrl(avatarUrl)}
    />
  );
};

const BOARDS: Array<{ value: LeaderboardBoard; label: string; blurb: string; unit: string }> = [
  { value: "lifetime", label: "Lifetime XP", blurb: "Everyone's total XP ever earned. Spending never lowers it.", unit: "XP" },
  { value: "weekly", label: "This week", blurb: "XP earned since Monday 00:00 UTC.", unit: "XP this week" },
  { value: "streak", label: "Streaks", blurb: "Longest daily-reward streaks right now.", unit: "days" },
  { value: "xp", label: "Balance", blurb: "Current spendable XP.", unit: "XP" },
];

/** Shown until the classes API answers; the real list (including classes added later) comes from the server. */
const FALLBACK_CLASS_FILTERS = ["DEFAULT", "HERO", "GAMBLER", "ASSASSIN", "WIZARD", "ARCHER", "TANK"];

/** Three small tiles (2nd, 1st, 3rd) for phones, where the full podium does not fit. */
const CompactPodium = ({ entries, unit, nameOf, emojiOf }: { entries: LeaderboardEntry[]; unit: string; nameOf: (e: LeaderboardEntry) => string; emojiOf: (e: LeaderboardEntry) => string }) => (
  <div className="sm:hidden mb-6 grid grid-cols-3 gap-2" aria-label="Top three players">
    {[entries[1], entries[0], entries[2]].map((e) => (
      <div key={`${e.username}-${e.rank}`} className={cn("rounded-xl border p-2 text-center", e.rank === 1 ? "border-yellow-500/40 bg-yellow-500/10" : "border-border bg-card")}>
        {e.rank === 1 ? <Crown className="h-4 w-4 mx-auto text-yellow-500" aria-hidden /> : <Medal className={cn("h-4 w-4 mx-auto", e.rank === 2 ? "text-gray-400" : "text-amber-600")} aria-hidden />}
        <div className="flex justify-center my-1"><PlayerAvatar avatarUrl={e.avatarUrl ?? null} frame={e?.cosmetics?.frame} username={e.username} size={e.rank === 1 ? "lg" : "md"} rank={e.rank} /></div>
        <p className="text-xs font-semibold truncate">{nameOf(e)}</p>
        <div className="flex justify-center"><PrestigeTag prestige={e.prestige} title={e.prestigeTitle} /></div>
        <p className="text-xs font-bold text-xp truncate">{e.score.toLocaleString()} {unit}</p>
        <p className="text-[0.625rem] text-foreground-muted">Lv.{e.level} {emojiOf(e)}</p>
      </div>
    ))}
  </div>
);

/** Places 1 to 3 are a crown or a medal; the rank is said in words for screen readers. */
const RankMark = ({ rank, size }: { rank: number; size: string }) => {
  if (rank > 3) return <span className="font-heading font-bold text-foreground-muted">#{rank}</span>;
  const Icon = rank === 1 ? Crown : Medal;
  const colour = rank === 1 ? "text-yellow-500" : rank === 2 ? "text-gray-400" : "text-amber-600";
  return <><Icon className={cn(size, colour)} aria-hidden /><span className="sr-only">Rank {rank}</span></>;
};

const Leaderboard = () => {
  const { user } = useAuth();
  const xpOn = user?.user?.gamification_enabled !== 0 && user?.user?.gamification_enabled !== false;
  const [by, setBy] = useState<LeaderboardBoard>("lifetime");
  const [classFilter, setClassFilter] = useState("ALL");
  const board = BOARDS.find((b) => b.value === by) ?? BOARDS[0];
  const { data: leaderboard, isLoading, isError, error, refetch, isFetching } = useLeaderboard(by, classFilter);
  const { data: mine, isLoading: mineLoading, isError: mineFailed } = useMyRank(by, classFilter);
  const { data: classData } = useClasses();
  const classOptions: Array<{ key: string; emoji: string; name: string }> = classData?.classes?.length
    ? classData.classes.map((c) => ({ key: c.key, emoji: c.emoji, name: c.name }))
    : FALLBACK_CLASS_FILTERS.map((k) => ({ key: k, emoji: CLASS_EMOJIS[k] ?? "", name: k.charAt(0) + k.slice(1).toLowerCase() }));
  const emojiOf = (e: { playerClass: string }) => classOptions.find((c) => c.key === e.playerClass)?.emoji || CLASS_EMOJIS[e.playerClass] || '⚪';
  const entries = leaderboard || [];
  const showStreakColumn = by !== "streak"; // on the Streak board the score already is the streak
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabIndex(e.key, BOARDS.findIndex((b) => b.value === by), BOARDS.length);
    if (next === null) return;
    e.preventDefault();
    setBy(BOARDS[next].value);
    document.getElementById(`board-tab-${BOARDS[next].value}`)?.focus();
  };
  const scoreText = (entry: LeaderboardEntry | undefined) => (entry ? entry.score.toLocaleString() : "");
  const youInList = entries.some((e) => e.isYou);

  const getDisplayName = (entry: LeaderboardEntry | undefined, isCurrentUser: boolean) => {
    if (isCurrentUser) return 'You';
    return entry?.username || 'Adventurer';
  };

  return (
    <DashboardLayout>
      <div className="mb-6 sm:mb-8">
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

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Leaderboard" onKeyDown={onTabKeyDown} className="flex flex-wrap gap-1 rounded-lg bg-background-secondary p-1 w-fit max-w-full">
          {BOARDS.map((b) => (
            <button
              key={b.value}
              id={`board-tab-${b.value}`}
              type="button"
              role="tab"
              aria-selected={by === b.value}
              aria-controls="board-tabpanel"
              tabIndex={by === b.value ? 0 : -1}
              onClick={() => setBy(b.value)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", by === b.value ? "bg-card text-foreground shadow-xs" : "text-foreground-muted hover:text-foreground")}
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
            className="h-9 rounded-md border border-input bg-background px-3 text-base md:text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="ALL">All classes</option>
            {classOptions.map((c) => (
              <option key={c.key} value={c.key}>{`${c.emoji} ${c.name}`.trim()}</option>
            ))}
          </select>
        </div>
      </div>

      <div id="board-tabpanel" role="tabpanel" aria-labelledby={`board-tab-${by}`}>
      {mineLoading && <p className="mb-4 text-sm text-foreground-muted" aria-busy="true">Checking your rank…</p>}
      {mineFailed && <p className="mb-4 text-sm text-destructive-text" role="alert">Couldn't load your rank.</p>}
      {mine && (
        <p className="mb-4 text-sm text-foreground-muted" aria-live="polite">
          {mine.rank
            ? <>Your rank: <span className="font-heading font-bold text-primary-text">#{mine.rank}</span>{!youInList ? " (outside the top 10)" : ""}</>
            : !xpOn
              ? "Turn on gamification to appear on the leaderboard."
              : classFilter !== "ALL"
                ? "You're not in this class's ranking. Choose All classes to see your rank."
                : by === "weekly" || by === "streak"
                  ? "You're not on this board yet. Earn some XP or claim your daily reward!"
                  : "You're not on this board yet."}
        </p>
      )}

      {entries.length >= 3 && <CompactPodium entries={entries} unit={board.unit} nameOf={(e) => getDisplayName(e, e.isYou)} emojiOf={emojiOf} />}

      {/* Top 3 Podium */}
      {entries.length >= 3 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="hidden sm:grid grid-cols-3 gap-4 mb-8">
          {/* 2nd Place */}
          <div className="mt-8">
            <motion.div whileHover={{ y: -4 }} className="rounded-xl bg-linear-to-b from-gray-400/20 to-gray-400/5 border border-gray-400/30 p-5 text-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--tw-gradient-stops))] from-gray-400/10 via-transparent to-transparent" />
              <div className="relative">
                <Medal className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                <div className="flex justify-center mb-2">
                  <PlayerAvatar key={`${entries[1]?.username}-2`} avatarUrl={entries[1]?.avatarUrl ?? null} frame={entries[1]?.cosmetics?.frame} username={entries[1]?.username} size="lg" rank={2} />
                </div>
                <p className="font-heading font-semibold truncate">{getDisplayName(entries[1], Boolean(entries[1]?.isYou))}</p>
                <div className="flex justify-center"><PrestigeTag prestige={entries[1]?.prestige} title={entries[1]?.prestigeTitle} /></div>
                <p className="text-xp font-bold text-lg">{scoreText(entries[1])} {board.unit}</p>
                <p className="text-xs text-foreground-muted">Level {entries[1]?.level} • {emojiOf(entries[1])}</p>
              </div>
            </motion.div>
          </div>
          
          {/* 1st Place */}
          <div>
            <motion.div whileHover={{ y: -4 }} className="rounded-xl bg-linear-to-b from-yellow-500/20 to-yellow-500/5 border border-yellow-500/30 p-6 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--tw-gradient-stops))] from-yellow-500/20 via-transparent to-transparent" />
              <div className="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-yellow-500 via-amber-400 to-yellow-500" />
              <div className="relative">
                <Crown className="h-10 w-10 mx-auto text-yellow-500 mb-2" />
                <div className="flex justify-center mb-2">
                  <PlayerAvatar key={`${entries[0]?.username}-1`} avatarUrl={entries[0]?.avatarUrl ?? null} frame={entries[0]?.cosmetics?.frame} username={entries[0]?.username} size="xl" rank={1} />
                </div>
                <p className="font-heading font-bold text-lg truncate">{getDisplayName(entries[0], Boolean(entries[0]?.isYou))}</p>
                <div className="flex justify-center"><PrestigeTag prestige={entries[0]?.prestige} title={entries[0]?.prestigeTitle} /></div>
                <p className="text-xp font-bold text-2xl">{scoreText(entries[0])} {board.unit}</p>
                <p className="text-sm text-foreground-muted">Level {entries[0]?.level} • {emojiOf(entries[0])}</p>
              </div>
            </motion.div>
          </div>
          
          {/* 3rd Place */}
          <div className="mt-12">
            <motion.div whileHover={{ y: -4 }} className="rounded-xl bg-linear-to-b from-amber-600/20 to-amber-600/5 border border-amber-600/30 p-5 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,var(--tw-gradient-stops))] from-amber-600/10 via-transparent to-transparent" />
              <div className="relative">
                <Medal className="h-8 w-8 mx-auto text-amber-600 mb-2" />
                <div className="flex justify-center mb-2">
                  <PlayerAvatar key={`${entries[2]?.username}-3`} avatarUrl={entries[2]?.avatarUrl ?? null} frame={entries[2]?.cosmetics?.frame} username={entries[2]?.username} size="lg" rank={3} />
                </div>
                <p className="font-heading font-semibold truncate">{getDisplayName(entries[2], Boolean(entries[2]?.isYou))}</p>
                <div className="flex justify-center"><PrestigeTag prestige={entries[2]?.prestige} title={entries[2]?.prestigeTitle} /></div>
                <p className="text-xp font-bold text-lg">{scoreText(entries[2])} {board.unit}</p>
                <p className="text-xs text-foreground-muted">Level {entries[2]?.level} • {emojiOf(entries[2])}</p>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* Full Leaderboard */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="hidden sm:grid grid-cols-12 gap-4 p-4 border-b border-border text-sm font-medium text-foreground-muted bg-linear-to-r from-background-secondary/50 to-transparent">
          <div className="col-span-1">Rank</div>
          <div className="col-span-4">Player</div>
          <div className="col-span-2 text-center">Level</div>
          <div className={cn("text-center", showStreakColumn ? "col-span-2" : "col-span-3")}>{board.unit}</div>
          {showStreakColumn && <div className="col-span-1 text-center">Streak</div>}
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
                      <RankMark rank={entry.rank} size="h-5 w-5" />
                    </div>
                    <PlayerAvatar avatarUrl={entry.avatarUrl ?? null} frame={entry?.cosmetics?.frame} username={entry.username} size="sm" rank={entry.rank} />
                    <div className="flex-1 min-w-0">
                      <p className={cn("font-medium text-sm truncate flex items-center gap-1.5", isCurrentUser && "text-primary-text")}>
                        <span className="truncate">{getDisplayName(entry, isCurrentUser)}</span>
                        <PrestigeTag prestige={entry.prestige} title={entry.prestigeTitle} />
                        <EquippedTitle title={entry.cosmetics?.title} className="truncate" />
                      </p>
                      <p className="text-xs text-foreground-muted flex items-center gap-1">
                        <span>{emojiOf(entry)}</span>
                        <span>Lv.{entry.level}</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xp font-bold text-sm flex items-center gap-1"><Sparkles className="h-3 w-3" />{scoreText(entry)}</span>
                      <div className="flex items-center gap-2 text-xs text-foreground-muted mt-1">
                        {showStreakColumn && <span className="flex items-center gap-1 text-orange-700 dark:text-orange-400"><Flame className="h-3 w-3" />{entry.streak}</span>}
                        <span className="flex items-center gap-1"><Target className="h-3 w-3" />{entry.tasksCompleted}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Desktop */}
                <div className="hidden sm:grid grid-cols-12 gap-4 p-4 items-center">
                  <div className="col-span-1 flex justify-center">
                    <RankMark rank={entry.rank} size="h-6 w-6" />
                  </div>
                  <div className="col-span-4 flex items-center gap-3">
                    <PlayerAvatar avatarUrl={entry.avatarUrl ?? null} frame={entry?.cosmetics?.frame} username={entry.username} size="md" rank={entry.rank} />
                    <div className="min-w-0">
                      <p className={cn("font-medium truncate flex items-center gap-1.5", isCurrentUser && "text-primary-text")}>
                        <span className="truncate">{getDisplayName(entry, isCurrentUser)}</span>
                        <PrestigeTag prestige={entry.prestige} title={entry.prestigeTitle} />
                        <EquippedTitle title={entry.cosmetics?.title} className="truncate" />
                      </p>
                      <p className="text-xs text-foreground-muted flex items-center gap-1">
                        <span>{emojiOf(entry)}</span>
                        <span>{entry.playerClass || 'Default'}</span>
                      </p>
                    </div>
                  </div>
                  <div className="col-span-2 text-center">
                    <span className="px-3 py-1 rounded-full bg-background-secondary text-sm font-medium">Lv.{entry.level}</span>
                  </div>
                  <div className={cn("text-center", showStreakColumn ? "col-span-2" : "col-span-3")}>
                    <span className="text-xp font-bold flex items-center justify-center gap-1">
                      <Sparkles className="h-4 w-4" />{scoreText(entry)}
                    </span>
                  </div>
                  {showStreakColumn && (
                    <div className="col-span-1 text-center">
                      <span className="flex items-center justify-center gap-1 text-orange-700 dark:text-orange-400">
                        <Flame className="h-4 w-4" />{entry.streak}
                      </span>
                    </div>
                  )}
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
      </div>
    </DashboardLayout>
  );
};

export default Leaderboard;
