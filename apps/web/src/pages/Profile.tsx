import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { XPProgressBar } from "@/components/game/XPProgressBar";
import { motion } from "framer-motion";
import { Sparkles, Flame, Target, ListTodo, Trophy, Gamepad2, TrendingUp } from "lucide-react";
import { useAuth, getAvatarUrl } from "@/contexts/AuthContext";

const CLASS_INFO: Record<string, { name: string; emoji: string; color: string }> = {
  DEFAULT: { name: 'Default', emoji: '⚪', color: '#95A5A6' },
  HERO: { name: 'Hero', emoji: '⚔️', color: '#FFD700' },
  GAMBLER: { name: 'Gambler', emoji: '🎲', color: '#9B59B6' },
  ASSASSIN: { name: 'Assassin', emoji: '🗡️', color: '#2C3E50' },
  WIZARD: { name: 'Wizard', emoji: '🔮', color: '#3498DB' },
  ARCHER: { name: 'Archer', emoji: '🏹', color: '#27AE60' },
  TANK: { name: 'Tank', emoji: '🛡️', color: '#E74C3C' },
};

const Profile = () => {
  const { user } = useAuth();

  const discord = user?.discord || { username: 'Adventurer', globalName: 'Adventurer', discordId: '0', avatar: null };
  const dbUser = user?.user || {};
  const stats = user || {};

  const playerClass = CLASS_INFO[dbUser.player_class || 'DEFAULT'] || CLASS_INFO.DEFAULT;
  const level = dbUser.player_level || 1;
  const totalXP = dbUser.player_xp || 0;
  const currentXP = totalXP % 100;
  const streak = dbUser.streak_count || 0;
  
  const totalTasks = parseInt(String(stats.items?.total)) || 0;
  const completedTasks = parseInt(String(stats.items?.completed)) || 0;
  const focusRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  
  const gamesPlayed = stats.games?.played || 0;
  const gamesWon = stats.games?.won || 0;
  const winRate = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0;

  const avatarUrl = getAvatarUrl(discord.discordId || '0', discord.avatar || null, 256);

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-0">
        {/* Profile Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-card border border-border overflow-hidden mb-6 sm:mb-8"
        >
          {/* Banner */}
          <div 
            className="h-24 sm:h-32 relative"
            style={{ background: `linear-gradient(135deg, ${playerClass.color}40, ${playerClass.color}20)` }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-card" />
          </div>

          <div className="px-4 sm:px-6 pb-4 sm:pb-6 -mt-10 sm:-mt-12 relative">
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-3 sm:gap-4">
              {/* Avatar */}
              <div className="relative">
                <img src={avatarUrl} alt="Avatar" className="h-20 w-20 sm:h-24 sm:w-24 rounded-full border-4 border-card" />
                <div 
                  className="absolute -bottom-1 -right-1 h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center text-base sm:text-lg border-2 border-card"
                  style={{ backgroundColor: playerClass.color }}
                >
                  {playerClass.emoji}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 text-center sm:text-left">
                <h1 className="text-xl sm:text-2xl font-heading font-bold">{discord.globalName || discord.username}</h1>
                <p className="text-foreground-muted text-sm">@{discord.username}</p>
                <div className="flex items-center gap-2 mt-1 justify-center sm:justify-start">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: `${playerClass.color}30`, color: playerClass.color }}>
                    {playerClass.emoji} {playerClass.name}
                  </span>
                  <span className="text-xs text-foreground-muted">Level {level}</span>
                </div>
              </div>

              {/* XP Display */}
              <div className="text-center sm:text-right">
                <div className="flex items-center gap-2 justify-center sm:justify-end">
                  <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-xp" />
                  <span className="text-xl sm:text-2xl font-heading font-bold text-xp">{totalXP.toLocaleString()}</span>
                </div>
                <p className="text-xs text-foreground-muted">Total XP</p>
              </div>
            </div>

            {/* XP Progress */}
            <div className="mt-4 sm:mt-6">
              <XPProgressBar currentXP={currentXP} xpToNextLevel={100} level={level} size="lg" />
              <p className="text-xs sm:text-sm text-foreground-muted mt-2">{100 - currentXP} XP to Level {level + 1}</p>
            </div>
          </div>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[
            { icon: Flame, label: 'Day Streak', value: streak, color: 'orange', sub: streak > 0 ? 'Keep it going!' : 'Start today!' },
            { icon: Target, label: 'Focus Rate', value: `${focusRate}%`, color: 'green', sub: `${completedTasks}/${totalTasks} tasks` },
            { icon: ListTodo, label: 'Total Lists', value: stats.lists?.total || 0, color: 'blue', sub: 'Quest logs created' },
            { icon: Gamepad2, label: 'Games Played', value: gamesPlayed, color: 'purple', sub: `${winRate}% win rate` },
            { icon: Trophy, label: 'Achievements', value: stats.achievements || 0, color: 'yellow', sub: 'Badges earned' },
            { icon: TrendingUp, label: 'Current Level', value: `Lv.${level}`, color: 'cyan', sub: `${totalXP.toLocaleString()} total XP` },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className="rounded-xl bg-card border border-border p-3 sm:p-4"
            >
              <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                <div className={`h-8 w-8 sm:h-10 sm:w-10 rounded-lg bg-${stat.color}-500/20 flex items-center justify-center flex-shrink-0`}>
                  <stat.icon className={`h-4 w-4 sm:h-5 sm:w-5 text-${stat.color}-400`} />
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
