import type { Skill, SkillTree } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Lock, Check, Sparkles, Loader2, ShieldX } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSkills, useUnlockSkill } from "@/hooks/useApi";
import { toast } from "sonner";

const CLASS_COLORS: Record<string, string> = {
  DEFAULT: '#95A5A6', HERO: '#FFD700', GAMBLER: '#9B59B6',
  ASSASSIN: '#2C3E50', WIZARD: '#3498DB', ARCHER: '#27AE60', TANK: '#E74C3C',
};

const Skills = () => {
  const { refresh } = useAuth();
  const { data, isLoading } = useSkills();
  const unlockSkill = useUnlockSkill();
  const [selectedTreeKey, setSelectedTreeKey] = useState<string>('DEFAULT');

  const skillTrees = data?.skillTrees || [];
  const userXP = data?.userXP || 0;
  const selectedTree = skillTrees.find((t: SkillTree) => t.classKey === selectedTreeKey) || skillTrees[0];
  
  // Check if selected class is owned (DEFAULT is always owned)
  const isClassOwned = selectedTree?.classOwned ?? (selectedTreeKey === 'DEFAULT');

  const getSkillStatus = (skill: Skill): 'locked' | 'available' | 'unlocked' | 'maxed' | 'class_locked' => {
    // If class not owned, all skills are class-locked (except DEFAULT)
    if (!isClassOwned) return 'class_locked';
    
    if (skill.currentLevel >= skill.maxLevel) return 'maxed';
    if (skill.currentLevel > 0) return 'unlocked';
    if (skill.requires) {
      const prereq = selectedTree?.skills.find((s: Skill) => s.id === skill.requires);
      if (!prereq || prereq.currentLevel === 0) return 'locked';
    }
    return 'available';
  };

  const handleUnlock = async (skillId: string) => {
    if (!isClassOwned) {
      toast.error(`You must own the ${selectedTreeKey} class first!`);
      return;
    }
    try {
      await unlockSkill.mutateAsync({ skillId, classKey: selectedTreeKey });
      toast.success('✨ Skill upgraded!');
      refresh();
    } catch {
      /* error toast shown by the mutation hook */
    }
  };

  const color = CLASS_COLORS[selectedTreeKey] || '#888';

  return (
    <DashboardLayout>
      <div className="mb-6 sm:mb-8">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold mb-2">Skill Trees</h1>
          <p className="text-foreground-muted text-sm sm:text-base">Invest XP to unlock powerful abilities</p>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="mb-6 sm:mb-8 p-3 sm:p-4 rounded-xl bg-card border border-border inline-flex items-center gap-2 sm:gap-3">
        <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-xp" />
        <span className="text-foreground-muted text-sm">Available XP:</span>
        <span className="font-heading font-bold text-lg sm:text-xl text-xp">{userXP.toLocaleString()}</span>
      </motion.div>

      {/* Class Tabs - Scrollable on mobile */}
      <div className="flex gap-1.5 sm:gap-2 mb-6 sm:mb-8 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        {skillTrees.map((tree: SkillTree) => {
          const owned = tree.classOwned ?? (tree.classKey === 'DEFAULT');
          return (
            <button
              key={tree.classKey}
              onClick={() => setSelectedTreeKey(tree.classKey)}
              className={cn(
                "flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all duration-200 whitespace-nowrap text-xs sm:text-sm flex-shrink-0 relative",
                selectedTreeKey === tree.classKey ? "bg-primary text-primary-foreground shadow-lg" : "bg-card border border-border hover:border-primary/50",
                !owned && "opacity-60"
              )}
            >
              <span className="text-base sm:text-lg">{tree.emoji}</span>
              <span>{tree.name}</span>
              {!owned && <Lock className="h-3 w-3 ml-1 opacity-70" />}
            </button>
          );
        })}
      </div>

      {/* Class Not Owned Warning */}
      {!isClassOwned && selectedTree && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/30 flex items-center gap-3"
        >
          <ShieldX className="h-5 w-5 text-destructive flex-shrink-0" />
          <div>
            <p className="font-medium text-destructive">Class Not Owned</p>
            <p className="text-sm text-foreground-muted">
              Purchase the <span className="font-semibold">{selectedTree.name}</span> class from the Classes page to unlock these skills.
            </p>
          </div>
        </motion.div>
      )}

      {/* Skill Tree */}
      {isLoading ? (
        <div className="h-[400px] sm:h-[500px] rounded-2xl bg-card/50 animate-pulse" />
      ) : selectedTree && (
        <motion.div key={selectedTreeKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl bg-card border border-border p-4 sm:p-8">
          <div className="text-center mb-6 sm:mb-8">
            <span className="text-3xl sm:text-4xl">{selectedTree.emoji}</span>
            <h2 className="text-xl sm:text-2xl font-heading font-bold mt-2" style={{ color }}>{selectedTree.name} Tree</h2>
            <p className="text-foreground-muted text-xs sm:text-sm mt-1">{selectedTree.description}</p>
            {!isClassOwned && (
              <p className="text-destructive text-xs mt-2 flex items-center justify-center gap-1">
                <Lock className="h-3 w-3" /> Requires owning this class
              </p>
            )}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {selectedTree.skills.map((skill: Skill) => {
              const status = getSkillStatus(skill);
              const canAfford = userXP >= skill.cost;
              const isClassLocked = status === 'class_locked';
              
              return (
                <motion.div
                  key={skill.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    "relative rounded-xl p-3 sm:p-4 border-2 transition-all",
                    status === 'maxed' && "border-success bg-success/10",
                    status === 'unlocked' && "border-primary bg-primary/10",
                    status === 'available' && "border-xp bg-xp/10",
                    (status === 'locked' || isClassLocked) && "border-border bg-card/50 opacity-60"
                  )}
                  style={status === 'unlocked' || status === 'maxed' ? { borderColor: color } : undefined}
                >
                  <div className="absolute -top-2 -right-2">
                    {status === 'maxed' && <div className="h-5 w-5 sm:h-6 sm:w-6 rounded-full bg-success flex items-center justify-center"><Check className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-white" /></div>}
                    {(status === 'locked' || isClassLocked) && <div className="h-5 w-5 sm:h-6 sm:w-6 rounded-full bg-background-tertiary flex items-center justify-center"><Lock className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-foreground-muted" /></div>}
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg sm:text-xl">{skill.emoji}</span>
                    <h4 className="font-heading font-semibold text-sm sm:text-base">{skill.name}</h4>
                  </div>
                  <p className="text-[10px] sm:text-xs text-foreground-muted mb-2 sm:mb-3">{skill.description}</p>
                  
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <div className="flex gap-1">
                      {Array.from({ length: skill.maxLevel }).map((_, i) => (
                        <div key={i} className={cn("h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full", i < skill.currentLevel ? "bg-current" : "bg-background-secondary")} 
                          style={i < skill.currentLevel ? { backgroundColor: color } : undefined} />
                      ))}
                    </div>
                    <span className="text-[10px] sm:text-xs text-foreground-muted">{skill.currentLevel}/{skill.maxLevel}</span>
                  </div>

                  {isClassLocked && (
                    <div className="text-center text-[10px] sm:text-xs text-destructive font-medium flex items-center justify-center gap-1">
                      <Lock className="h-3 w-3" /> Buy {selectedTree.name} class first
                    </div>
                  )}
                  {status === 'available' && (
                    <Button size="sm" variant={canAfford ? "xp" : "secondary"} className="w-full text-xs sm:text-sm" disabled={!canAfford || unlockSkill.isPending} onClick={() => handleUnlock(skill.id)}>
                      {unlockSkill.isPending ? <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" /> : canAfford ? `Unlock (${skill.cost} XP)` : `Need ${skill.cost - userXP} XP`}
                    </Button>
                  )}
                  {status === 'unlocked' && skill.currentLevel < skill.maxLevel && (
                    <Button size="sm" variant={canAfford ? "glow" : "secondary"} className="w-full text-xs sm:text-sm" disabled={!canAfford || unlockSkill.isPending} onClick={() => handleUnlock(skill.id)}>
                      {unlockSkill.isPending ? <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" /> : canAfford ? `Upgrade (${skill.cost} XP)` : `Need ${skill.cost - userXP} XP`}
                    </Button>
                  )}
                  {status === 'maxed' && <div className="text-center text-[10px] sm:text-xs text-success font-medium">MAX LEVEL</div>}
                  {status === 'locked' && !isClassLocked && skill.requires && (
                    <div className="text-center text-[10px] sm:text-xs text-foreground-muted">Requires: {selectedTree.skills.find((s: Skill) => s.id === skill.requires)?.name}</div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}
    </DashboardLayout>
  );
};

export default Skills;
