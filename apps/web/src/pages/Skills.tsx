import type { Skill, SkillTree } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Lock, Check, Sparkles, Loader2, ShieldX, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSkills, useSkillPreview, useUnlockSkill, useRespecSkills } from "@/hooks/useApi";
import { MIX_LABELS } from "@/lib/classInfo";
import { skillTiers } from "@/lib/skillTree";
import { toast } from "sonner";
import { classColor } from "@/lib/classColors";
import { nextTabIndex } from "@/lib/tabs";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";



const Skills = () => {
  const { refresh, user } = useAuth();
  const { data, isLoading, isError, error, refetch, isFetching } = useSkills();
  const unlockSkill = useUnlockSkill();
  const preview = useSkillPreview().data;
  const respec = useRespecSkills();
  const [confirmRespec, setConfirmRespec] = useState(false);
  const equippedKey: string = user?.user?.player_class || 'DEFAULT';
  // Until the player picks a tab, show the tree of the class they have equipped.
  const [pickedTreeKey, setPickedTreeKey] = useState<string | null>(null);
  const [confirmSkill, setConfirmSkill] = useState<Skill | null>(null);
  const unlockingId = unlockSkill.isPending ? unlockSkill.variables?.skillId : undefined;

  const skillTrees = data?.skillTrees || [];
  const userXP = data?.userXP || 0;
  const wantedKey = pickedTreeKey ?? equippedKey;
  const selectedTree = skillTrees.find((t: SkillTree) => t.classKey === wantedKey) || skillTrees[0];
  const selectedTreeKey = selectedTree?.classKey ?? wantedKey;
  
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

  const color = classColor(selectedTreeKey);
  const spentOnTree = (selectedTree?.skills ?? []).reduce((sum: number, s: Skill) => sum + s.cost * s.currentLevel, 0);
  const refundPreview = Math.floor(spentOnTree * 0.75);

  const handleRespec = async () => {
    try {
      const r = await respec.mutateAsync(selectedTreeKey);
      toast.success(`🔄 ${selectedTree?.name ?? "Tree"} reset`, { description: `${r.refund.toLocaleString()} XP came back (${r.percent}% of ${r.spent.toLocaleString()}).` });
      refresh();
    } catch {
      /* error toast shown by the mutation hook */
    }
  };

  // With 12 trees the tab list scrolls; keep the selected tab in view.
  useEffect(() => {
    document.getElementById(`skill-tab-${selectedTreeKey}`)?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [selectedTreeKey, skillTrees.length]);

  const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys: string[] = skillTrees.map((t: SkillTree) => t.classKey);
    if (keys.length === 0) return;
    const next = nextTabIndex(e.key, keys.indexOf(selectedTreeKey), keys.length);
    if (next === null) return;
    e.preventDefault();
    setPickedTreeKey(keys[next]);
    document.getElementById(`skill-tab-${keys[next]}`)?.focus();
  };

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
        <span className="font-heading font-bold text-lg sm:text-xl text-xp">{isLoading ? "…" : userXP.toLocaleString()}</span>
      </motion.div>

      {/* Class Tabs - Scrollable on mobile */}
      <div role="tablist" aria-label="Class skill trees" onKeyDown={onTabKeyDown} className="flex gap-1.5 sm:gap-2 mb-6 sm:mb-8 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        {skillTrees.map((tree: SkillTree) => {
          const owned = tree.classOwned ?? (tree.classKey === 'DEFAULT');
          return (
            <button
              key={tree.classKey}
              id={`skill-tab-${tree.classKey}`}
              type="button"
              role="tab"
              aria-selected={selectedTreeKey === tree.classKey}
              aria-controls="skill-tabpanel"
              tabIndex={selectedTreeKey === tree.classKey ? 0 : -1}
              onClick={() => setPickedTreeKey(tree.classKey)}
              className={cn(
                "flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all duration-200 whitespace-nowrap text-xs sm:text-sm shrink-0 relative",
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
          <ShieldX className="h-5 w-5 text-destructive-text shrink-0" />
          <div>
            <p className="font-medium text-destructive-text">Class Not Owned</p>
            <p className="text-sm text-foreground-muted">
              Purchase the <span className="font-semibold">{selectedTree.name}</span> class from the Classes page to unlock these skills.
            </p>
          </div>
        </motion.div>
      )}

      {/* Skill Tree */}
      {isError ? (
        <ErrorCard what="the skill trees" error={error} onRetry={() => void refetch()} retrying={isFetching} />
      ) : isLoading ? (
        <div className="h-[400px] sm:h-[500px] rounded-2xl bg-card/50 animate-pulse" />
      ) : selectedTree && (
        <motion.div key={selectedTreeKey} id="skill-tabpanel" role="tabpanel" aria-labelledby={`skill-tab-${selectedTreeKey}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl bg-card border border-border p-4 sm:p-8">
          <div className="text-center mb-6 sm:mb-8">
            <span className="text-3xl sm:text-4xl">{selectedTree.emoji}</span>
            <h2 className="text-xl sm:text-2xl font-heading font-bold mt-2" style={{ color }}>{selectedTree.name} Tree</h2>
            <p className="text-foreground-muted text-xs sm:text-sm mt-1">{selectedTree.description}</p>
            {!isClassOwned && (
              <p className="text-destructive-text text-xs mt-2 flex items-center justify-center gap-1">
                <Lock className="h-3 w-3" /> Requires owning this class
              </p>
            )}
            {isClassOwned && spentOnTree > 0 && (
              <Button type="button" variant="outline" size="sm" className="mt-3 gap-2" onClick={() => setConfirmRespec(true)} disabled={respec.isPending}>
                {respec.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reset this tree
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-2" data-testid="skill-tiers">
            {skillTiers(selectedTree.skills).map((tier, tierIndex) => (
              <div key={tierIndex} className="flex flex-1 flex-col gap-3 sm:gap-4 lg:min-w-0">
                {tierIndex > 0 && <div className="text-center text-foreground-muted lg:hidden" aria-hidden>↓</div>}
                <div className="hidden text-center text-[0.625rem] uppercase tracking-wide text-foreground-muted lg:block">{tierIndex === 0 ? "Start" : `Tier ${tierIndex + 1}`}</div>
            {tier.map((skill: Skill) => {
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
                  <p className="text-[0.625rem] sm:text-xs text-foreground-muted mb-2 sm:mb-3">{skill.description}</p>
                  {preview && skill.currentLevel < skill.maxLevel && preview.gains[skill.id] !== undefined && (
                    <p className="text-[0.625rem] sm:text-xs mb-2 sm:mb-3" data-testid={`skill-gain-${skill.id}`}>
                      {preview.gains[skill.id] > 0 ? (
                        <span className="text-xp font-medium">≈ +{preview.gains[skill.id]} XP per task</span>
                      ) : (
                        <span className="text-foreground-muted">Adds nothing to {MIX_LABELS[preview.mix] ?? "a task"} right now</span>
                      )}
                    </p>
                  )}
                  
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <div className="flex gap-1">
                      {Array.from({ length: skill.maxLevel }).map((_, i) => (
                        <div key={i} className={cn("h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full", i < skill.currentLevel ? "bg-current" : "bg-background-secondary")} 
                          style={i < skill.currentLevel ? { backgroundColor: color } : undefined} />
                      ))}
                    </div>
                    <span className="text-[0.625rem] sm:text-xs text-foreground-muted">{skill.currentLevel}/{skill.maxLevel}</span>
                  </div>

                  {isClassLocked && (
                    <div className="text-center text-[0.625rem] sm:text-xs text-destructive-text font-medium flex items-center justify-center gap-1">
                      <Lock className="h-3 w-3" /> Buy {selectedTree.name} class first
                    </div>
                  )}
                  {status === 'available' && (
                    <Button size="sm" variant={canAfford ? "xp" : "secondary"} className="w-full text-xs sm:text-sm" disabled={!canAfford || unlockingId === skill.id} onClick={() => setConfirmSkill(skill)}>
                      {unlockingId === skill.id ? <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" /> : canAfford ? `Unlock (${skill.cost} XP)` : `Need ${skill.cost - userXP} XP`}
                    </Button>
                  )}
                  {status === 'unlocked' && skill.currentLevel < skill.maxLevel && (
                    <Button size="sm" variant={canAfford ? "glow" : "secondary"} className="w-full text-xs sm:text-sm" disabled={!canAfford || unlockingId === skill.id} onClick={() => setConfirmSkill(skill)}>
                      {unlockingId === skill.id ? <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" /> : canAfford ? `Upgrade (${skill.cost} XP)` : `Need ${skill.cost - userXP} XP`}
                    </Button>
                  )}
                  {status === 'maxed' && <div className="text-center text-[0.625rem] sm:text-xs text-success font-medium">MAX LEVEL</div>}
                  {status === 'locked' && !isClassLocked && skill.requires && (
                    <div className="text-center text-[0.625rem] sm:text-xs text-foreground-muted">Requires: {selectedTree.skills.find((s: Skill) => s.id === skill.requires)?.name}</div>
                  )}
                </motion.div>
              );
            })}
              </div>
            ))}
          </div>
        </motion.div>
      )}
      <ConfirmDialog
        open={confirmRespec}
        onOpenChange={setConfirmRespec}
        title={`Reset the ${selectedTree?.name ?? ""} tree?`}
        description={(
          <div className="space-y-1 text-sm">
            <p>Every {selectedTree?.name} skill is unlearned and <span className="font-semibold text-xp">{refundPreview.toLocaleString()} XP</span> comes back (75% of the {spentOnTree.toLocaleString()} XP you spent).</p>
            <p>You can reset one tree a day. The refund never counts as lifetime XP.</p>
          </div>
        )}
        confirmLabel="Reset the tree"
        onConfirm={() => { setConfirmRespec(false); void handleRespec(); }}
      />
      <ConfirmDialog
        open={confirmSkill !== null}
        onOpenChange={(open) => { if (!open) setConfirmSkill(null); }}
        title={confirmSkill && confirmSkill.currentLevel > 0 ? `Upgrade ${confirmSkill.name}?` : `Unlock ${confirmSkill?.name ?? "skill"}?`}
        description={confirmSkill && (
          <div className="space-y-1 text-sm">
            <p>Price: <span className="font-semibold text-xp">{confirmSkill.cost.toLocaleString()} XP</span></p>
            <p>Balance after: <span className="font-semibold">{Math.max(0, userXP - confirmSkill.cost).toLocaleString()} XP</span></p>
            {preview && preview.gains[confirmSkill.id] !== undefined && (
              <p>
                For your {preview.classKey.toLowerCase()} at level {preview.level}:{" "}
                <span className="font-semibold">{preview.gains[confirmSkill.id] > 0 ? `≈ +${preview.gains[confirmSkill.id]} XP` : "no change"}</span> per 10 XP task ({MIX_LABELS[preview.mix] ?? "a task"}).
              </p>
            )}
          </div>
        )}
        confirmLabel={`Spend ${confirmSkill?.cost.toLocaleString() ?? ""} XP`}
        onConfirm={() => { if (confirmSkill) void handleUnlock(confirmSkill.id); setConfirmSkill(null); }}
      />
    </DashboardLayout>
  );
};

export default Skills;
