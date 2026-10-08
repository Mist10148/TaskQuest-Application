import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { XPProgressBar } from "@/components/game/XPProgressBar";
import { StatCard } from "@/components/game/StatCard";
import { TaskListCard } from "@/components/game/TaskComponents";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useState } from "react";
import { Sparkles, Flame, Target, ListTodo, Trophy, Gamepad2, Plus, Calendar, Zap } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLists, useClaimDaily } from "@/hooks/useApi";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const Dashboard = () => {
  const { user, useMock } = useAuth();
  const { data: apiLists } = useLists();
  const claimDaily = useClaimDaily();
  const [dailyClaimed, setDailyClaimed] = useState(false);

  const lists = apiLists || [];
  const discord = user?.discord || { username: 'Adventurer', globalName: 'Adventurer' };
  const dbUser = user?.user || {};
  
  const level = dbUser.player_level || 1;
  const totalXP = dbUser.player_xp || 0;
  const currentXP = totalXP % 100;
  const streak = dbUser.streak_count || 0;
  
  const totalTasks = parseInt(String(user?.items?.total)) || 0;
  const completedTasks = parseInt(String(user?.items?.completed)) || 0;
  const focusRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  
  const gamesPlayed = user?.games?.played || 0;
  const achievementCount = user?.achievements || 0;

  const handleClaimDaily = async () => {
    if (useMock) {
      toast.success('🎁 Daily reward claimed! +100 XP');
      setDailyClaimed(true);
      return;
    }
    try {
      const result = await claimDaily.mutateAsync();
      if (result.success) {
        // Build description with bonus breakdown
        let description = '';
        const bonusParts = [];
        if (result.classBonus > 0) bonusParts.push(`+${result.classBonus} class`);
        if (result.streakBonus > 0) bonusParts.push(`+${result.streakBonus} streak (${result.streak} days)`);
        if (result.skillDailyBonus > 0) bonusParts.push(`+${result.skillDailyBonus} skill`);
        if (bonusParts.length > 0) description = bonusParts.join(', ');
        if (result.bonusInfo?.details) description = result.bonusInfo.details;
        
        toast.success(`🎁 Daily reward claimed! +${result.totalXP} XP`, {
          description: description || undefined,
          duration: 4000,
        });
        setDailyClaimed(true);
      } else {
        toast.error(result.error || 'Already claimed today');
      }
    } catch {
      toast.error('Failed to claim daily reward');
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 sm:space-y-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold flex items-center gap-2">
              Welcome back, <span className="bg-gradient-to-r from-primary via-cyan-400 to-primary bg-clip-text text-transparent">{discord.globalName || discord.username}</span>
              <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ repeat: Infinity, duration: 2, repeatDelay: 3 }}>
                <Zap className="h-6 w-6 text-xp drop-shadow-[0_0_8px_rgba(234,179,8,0.6)]" />
              </motion.div>
            </h1>
            <p className="text-foreground-muted text-sm sm:text-base">Here's your adventure progress</p>
            {useMock && <p className="text-xs text-yellow-500 mt-1">⚠️ Demo mode - Connect API for real data</p>}
          </div>
          <Button variant="outline" onClick={handleClaimDaily} disabled={dailyClaimed || claimDaily.isPending} className="shrink-0 border-xp/50 text-xp hover:bg-xp/10 hover:border-xp hover:shadow-[0_0_15px_rgba(234,179,8,0.3)] transition-all">
            <Calendar className="h-4 w-4 mr-2" />
            {dailyClaimed ? 'Claimed!' : 'Claim Daily Reward'}
          </Button>
        </motion.div>

        {/* XP Progress with neon effects */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-2xl bg-card border border-border p-4 sm:p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-xp/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-br from-xp/5 via-transparent to-transparent" />
          <div className="relative">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-xp/20 flex items-center justify-center flex-shrink-0 shadow-[0_0_20px_rgba(234,179,8,0.3)]">
                  <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-xp drop-shadow-[0_0_5px_rgba(234,179,8,0.8)]" />
                </div>
                <div>
                  <h2 className="font-heading font-semibold text-sm sm:text-base">Level {level}</h2>
                  <p className="text-xs sm:text-sm text-foreground-muted">{totalXP.toLocaleString()} Total XP</p>
                </div>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xl sm:text-2xl font-heading font-bold text-xp drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]">{100 - currentXP}</p>
                <p className="text-[10px] sm:text-xs text-foreground-muted">XP to next level</p>
              </div>
            </div>
            <XPProgressBar currentXP={currentXP} xpToNextLevel={100} level={level} />
          </div>
        </motion.div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <StatCard label="Day Streak" value={streak} icon={<Flame className="h-4 w-4 sm:h-5 sm:w-5" />} colorScheme="destructive" subValue={streak > 0 ? "Keep it going!" : "Start your streak!"} />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <StatCard label="Focus Rate" value={`${focusRate}%`} icon={<Target className="h-4 w-4 sm:h-5 sm:w-5" />} colorScheme="success" subValue={`${completedTasks}/${totalTasks} tasks`} />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <StatCard label="Games Played" value={gamesPlayed} icon={<Gamepad2 className="h-4 w-4 sm:h-5 sm:w-5" />} colorScheme="primary" subValue="Try your luck!" />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <StatCard label="Achievements" value={achievementCount} icon={<Trophy className="h-4 w-4 sm:h-5 sm:w-5" />} colorScheme="xp" subValue="Unlock more!" />
          </motion.div>
        </div>

        {/* Recent Quests */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg sm:text-xl font-heading font-semibold flex items-center gap-2">
              <ListTodo className="h-4 w-4 sm:h-5 sm:w-5 text-primary" /> Recent Quests
            </h2>
            <Link to="/tasks"><Button variant="ghost" size="sm" className="text-xs sm:text-sm hover:text-primary">View All</Button></Link>
          </div>

          {lists.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-border p-8 sm:p-12 text-center">
              <ListTodo className="h-10 w-10 sm:h-12 sm:w-12 mx-auto text-foreground-muted mb-4" />
              <h3 className="font-heading font-semibold mb-2 text-sm sm:text-base">No quests yet</h3>
              <p className="text-foreground-muted mb-4 text-xs sm:text-sm">Create your first quest to get started!</p>
              <Link to="/tasks"><Button variant="glow" size="sm"><Plus className="h-4 w-4 mr-2" />Create Quest</Button></Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {lists.slice(0, 3).map((list: any, index: number) => (
                <motion.div key={list.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 + index * 0.05 }}>
                  <Link to="/tasks">
                    <TaskListCard name={list.name} description={list.description} itemsCompleted={list.itemsCompleted || 0} itemsTotal={list.itemsTotal || 0} category={list.category} priority={list.priority} />
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
