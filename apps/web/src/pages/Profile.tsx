import { useState } from "react";
import { Link } from "react-router-dom";
import type { User, UserData } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { XPProgressBar } from "@/components/game/XPProgressBar";
import { motion } from "framer-motion";
import { Sparkles, Flame, Target, ListTodo, Trophy, Gamepad2, TrendingUp } from "lucide-react";
import { useAuth, getAvatarUrl } from "@/contexts/AuthContext";
import { classColor } from "@/lib/classColors";
import { StreakFreezeCard } from "@/components/game/StreakFreezeCard";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { Button } from "@/components/ui/button";
import { useClasses } from "@/hooks/useApi";
import { classCounter, freezeLimits } from "@/lib/classInfo";

const CLASS_INFO: Record<string, { name: string; emoji: string }> = {
  DEFAULT: { name: 'Default', emoji: '⚪' },
  HERO: { name: 'Hero', emoji: '⚔️' },
  GAMBLER: { name: 'Gambler', emoji: '🎲' },
  ASSASSIN: { name: 'Assassin', emoji: '🗡️' },
  WIZARD: { name: 'Wizard', emoji: '🔮' },
  ARCHER: { name: 'Archer', emoji: '🏹' },
  TANK: { name: 'Tank', emoji: '🛡️' },
  MONK: { name: 'Monk', emoji: '🧘' },
  ARTISAN: { name: 'Artisan', emoji: '🛠️' },
  RANGER: { name: 'Ranger', emoji: '🧭' },
  NECROMANCER: { name: 'Necromancer', emoji: '💀' },
  PALADIN: { name: 'Paladin', emoji: '⚜️' },
};

// Full class names, so Tailwind's scanner keeps them (it cannot see `bg-${color}-500/20`).
const STAT_TONES: Record<string, { bg: string; icon: string }> = {
  orange: { bg: "bg-orange-500/20", icon: "text-orange-700 dark:text-orange-400" },
  green: { bg: "bg-green-500/20", icon: "text-green-700 dark:text-green-400" },
  blue: { bg: "bg-blue-500/20", icon: "text-blue-700 dark:text-blue-400" },
  purple: { bg: "bg-purple-500/20", icon: "text-purple-700 dark:text-purple-400" },
  yellow: { bg: "bg-yellow-500/20", icon: "text-yellow-700 dark:text-yellow-400" },
  cyan: { bg: "bg-cyan-500/20", icon: "text-cyan-700 dark:text-cyan-400" },
};

const Profile = () => {
  const { user, error: authError, refresh } = useAuth();
  const classesQuery = useClasses();
  const [avatarFailed, setAvatarFailed] = useState(false);

  const discord = user?.discord || { username: 'Adventurer', globalName: 'Adventurer', discordId: '0', avatar: null };
  const dbUser: Partial<User> = user?.user ?? {};
  const stats: Partial<UserData> = user ?? {};

  // A class the page does not list (added on the server) takes its name and emoji from the classes API.
  const classKey: string = dbUser.player_class || 'DEFAULT';
  const apiClass = classesQuery.data?.classes.find((c) => c.key === classKey);
  const playerClass = CLASS_INFO[classKey] ?? (apiClass ? { name: apiClass.name, emoji: apiClass.emoji } : { name: classKey.charAt(0) + classKey.slice(1).toLowerCase(), emoji: '⚪' });
  const counter = classCounter(dbUser, user?.skills ?? []);
  const freeze = freezeLimits(user?.freezeLimits);
  const level = dbUser.player_level || 1;
  const totalXP = Number(dbUser.player_xp) || 0;
  const lifetimeXP = Number(dbUser.lifetime_xp ?? totalXP) || 0;
  const currentXP = lifetimeXP % 100;
  const streak = dbUser.streak_count || 0;
  
  const totalTasks = parseInt(String(stats.items?.total)) || 0;
  const completedTasks = parseInt(String(stats.items?.completed)) || 0;
  const focusRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  
  const gamesPlayed = stats.games?.played || 0;
  const gamesWon = stats.games?.won || 0;
  const winRate = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0;

  const avatarUrl = getAvatarUrl(discord.discordId || '0', discord.avatar || null, 256);

  if (!user) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto">
          <ErrorCard what="your profile" error={authError ? new Error(authError) : undefined} onRetry={() => void refresh()} />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        {/* Profile Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-card border border-border overflow-hidden mb-6 sm:mb-8"
        >
          {/* Banner */}
          <div 
            className="h-24 sm:h-32 relative"
            style={{ background: `linear-gradient(135deg, ${classColor(classKey, 0.25)}, ${classColor(classKey, 0.12)})` }}
          >
            <div className="absolute inset-0 bg-linear-to-b from-transparent to-card" />
          </div>

          <div className="px-4 sm:px-6 pb-4 sm:pb-6 -mt-10 sm:-mt-12 relative">
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-3 sm:gap-4">
              {/* Avatar */}
              <div className="relative">
                {avatarFailed ? (
                  <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full border-4 border-card bg-background-tertiary flex items-center justify-center text-2xl font-bold" role="img" aria-label="Avatar">
                    {(discord.globalName || discord.username || '?').slice(0, 2).toUpperCase()}
                  </div>
                ) : (
                  <img src={avatarUrl} alt="Avatar" onError={() => setAvatarFailed(true)} className="h-20 w-20 sm:h-24 sm:w-24 rounded-full border-4 border-card" />
                )}
                <div 
                  className="absolute -bottom-1 -right-1 h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center text-base sm:text-lg border-2 border-card"
                  style={{ backgroundColor: classColor(classKey) }}
                >
                  {playerClass.emoji}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 text-center sm:text-left">
                <h1 className="text-xl sm:text-2xl font-heading font-bold">{discord.globalName || discord.username}</h1>
                <p className="text-foreground-muted text-sm">@{discord.username}</p>
                <div className="flex items-center gap-2 mt-1 justify-center sm:justify-start">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: classColor(classKey, 0.19), color: classColor(classKey) }}>
                    {playerClass.emoji} {playerClass.name}
                  </span>
                  <span className="text-xs text-foreground-muted">Level {level}</span>
                </div>
                {counter && (
                  <p className="mt-1.5 text-xs text-foreground-muted" data-testid="class-counter">
                    <span aria-hidden>{counter.emoji} </span>
                    {counter.label}: <span className="font-semibold text-foreground">{counter.value}/{counter.max}</span>
                    {counter.note && <span> · {counter.note}</span>}
                  </p>
                )}
              </div>

              {/* XP Display */}
              <div className="text-center sm:text-right">
                <div className="flex items-center gap-2 justify-center sm:justify-end">
                  <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-xp" />
                  <span className="text-xl sm:text-2xl font-heading font-bold text-xp">{totalXP.toLocaleString()}</span>
                </div>
                <p className="text-xs text-foreground-muted">XP Balance</p>
                <p className="text-[10px] sm:text-xs text-foreground-muted">{lifetimeXP.toLocaleString()} Lifetime XP</p>
              </div>
            </div>

            {/* XP Progress */}
            <div className="mt-4 sm:mt-6">
              <XPProgressBar currentXP={currentXP} xpToNextLevel={100} level={level} size="lg" />
              <p className="text-xs sm:text-sm text-foreground-muted mt-2">{100 - currentXP} XP to Level {level + 1}</p>
            </div>
          </div>
        </motion.div>

        <div className="mb-6 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/classes">Change class</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/skills">Skill trees</Link></Button>
        </div>

        <StreakFreezeCard freezes={Number(dbUser.streak_freezes) || 0} cost={freeze.cost} max={freeze.max} balance={totalXP} gamificationOn={Boolean(dbUser.gamification_enabled ?? true)} />

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[
            { icon: Flame, label: 'Day Streak', value: streak, color: 'orange', sub: streak > 0 ? 'Keep it going!' : 'Start today!' },
            { icon: Target, label: 'Focus Rate', value: `${focusRate}%`, color: 'green', sub: `${completedTasks}/${totalTasks} tasks` },
            { icon: ListTodo, label: 'Total Lists', value: stats.lists?.total || 0, color: 'blue', sub: 'Quest logs created' },
            { icon: Gamepad2, label: 'Games Played', value: gamesPlayed, color: 'purple', sub: `${winRate}% win rate` },
            { icon: Trophy, label: 'Achievements', value: stats.achievements || 0, color: 'yellow', sub: 'Badges earned' },
            { icon: TrendingUp, label: 'Current Level', value: `Lv.${level}`, color: 'cyan', sub: `${lifetimeXP.toLocaleString()} lifetime XP` },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className="rounded-xl bg-card border border-border p-3 sm:p-4"
            >
              <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                <div className={`h-8 w-8 sm:h-10 sm:w-10 rounded-lg ${STAT_TONES[stat.color].bg} flex items-center justify-center shrink-0`}>
                  <stat.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${STAT_TONES[stat.color].icon}`} aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-lg sm:text-2xl font-heading font-bold truncate">{stat.value}</p>
                  <p className="text-[10px] sm:text-xs text-foreground-muted truncate">{stat.label}</p>
                </div>
              </div>
              <p className="text-[10px] sm:text-xs text-foreground-muted truncate">{stat.sub}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Profile;
