import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Check, Lock, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useClasses, useBuyClass, useEquipClass } from "@/hooks/useApi";
import { toast } from "sonner";

const CLASS_COLORS: Record<string, string> = {
  DEFAULT: '#95A5A6', HERO: '#FFD700', GAMBLER: '#9B59B6',
  ASSASSIN: '#2C3E50', WIZARD: '#3498DB', ARCHER: '#27AE60', TANK: '#E74C3C',
};

const Classes = () => {
  const { refresh } = useAuth();
  const { data, isLoading } = useClasses();
  const buyClass = useBuyClass();
  const equipClass = useEquipClass();

  const handleBuy = async (classKey: string) => {
    try {
      await buyClass.mutateAsync(classKey);
      toast.success(`🎉 Purchased ${classKey}!`);
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to purchase');
    }
  };

  const handleEquip = async (classKey: string) => {
    try {
      await equipClass.mutateAsync(classKey);
      toast.success(`⚔️ Equipped ${classKey}!`);
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to equip');
    }
  };

  const classes = data?.classes || [];
  const playerXP = data?.playerXP || 0;

  return (
    <DashboardLayout>
      <div className="mb-6 sm:mb-8 px-4 sm:px-0">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold mb-2">Choose Your Path</h1>
          <p className="text-foreground-muted text-sm sm:text-base">Select a class to customize your XP bonuses and playstyle</p>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="mb-6 sm:mb-8 p-3 sm:p-4 rounded-xl bg-card border border-border inline-flex items-center gap-2 sm:gap-3 mx-4 sm:mx-0">
        <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-xp" />
        <span className="text-foreground-muted text-sm">Available XP:</span>
        <span className="font-heading font-bold text-lg sm:text-xl text-xp">{playerXP.toLocaleString()}</span>
      </motion.div>

      <div className="px-4 sm:px-0">
        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {[...Array(7)].map((_, i) => <div key={i} className="h-64 sm:h-72 rounded-2xl bg-card/50 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {classes.map((classInfo: any, index: number) => {
              const color = CLASS_COLORS[classInfo.key] || '#888';
              const canAfford = playerXP >= classInfo.cost;

              return (
                <motion.div
                  key={classInfo.key}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + index * 0.05 }}
                  whileHover={{ scale: 1.02 }}
                  className={cn(
                    "relative rounded-2xl border-2 p-4 sm:p-6 transition-all duration-300",
                    classInfo.equipped 
                      ? "border-primary bg-primary/5 shadow-lg shadow-primary/20"
                      : classInfo.owned
                        ? "border-border bg-card hover:border-primary/50"
                        : "border-border bg-card/50 opacity-80 hover:opacity-100"
                  )}
                  style={{ borderColor: classInfo.equipped ? undefined : classInfo.owned ? `${color}80` : undefined }}
                >
                  {classInfo.equipped && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 sm:px-3 py-1 bg-primary text-primary-foreground rounded-full text-[10px] sm:text-xs font-semibold flex items-center gap-1">
                      <Check className="h-3 w-3" /> EQUIPPED
                    </div>
                  )}

                  <div className="text-center mb-3 sm:mb-4">
                    <span className="text-4xl sm:text-5xl block mb-2">{classInfo.emoji}</span>
                    <h3 className="text-lg sm:text-xl font-heading font-bold" style={{ color }}>{classInfo.name}</h3>
                  </div>

                  <div className="flex justify-center mb-3 sm:mb-4">
                    {classInfo.owned ? (
                      <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-full bg-success/10 text-success text-xs sm:text-sm">
                        <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Owned
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-full bg-background-secondary text-foreground-muted text-xs sm:text-sm">
                        <Lock className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> {classInfo.cost.toLocaleString()} XP
                      </div>
                    )}
                  </div>

                  <div className="text-center mb-4 sm:mb-6">
                    <p className="text-xs sm:text-sm text-foreground-muted mb-1 sm:mb-2 line-clamp-2">{classInfo.playstyle}</p>
                    <p className="text-xs sm:text-sm font-medium line-clamp-2" style={{ color }}>{classInfo.description}</p>
                  </div>

                  <div className="mt-auto">
                    {classInfo.equipped ? (
                      <Button variant="secondary" className="w-full text-xs sm:text-sm" size="sm" disabled>Currently Active</Button>
                    ) : classInfo.owned ? (
                      <Button variant="glow" className="w-full text-xs sm:text-sm" size="sm" onClick={() => handleEquip(classInfo.key)} disabled={equipClass.isPending}>
                        {equipClass.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Equip Class'}
                      </Button>
                    ) : (
                      <Button variant={canAfford ? "xp" : "secondary"} className="w-full text-xs sm:text-sm" size="sm" disabled={!canAfford || buyClass.isPending} onClick={() => handleBuy(classInfo.key)}>
                        {buyClass.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : canAfford ? `Purchase for ${classInfo.cost} XP` : `Need ${classInfo.cost - playerXP} more XP`}
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Classes;
