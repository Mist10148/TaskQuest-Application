import { useState } from "react";
import { Loader2, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { useBuyStreakFreeze } from "@/hooks/useApi";

interface Props {
  freezes: number;
  /** Price and cap for this player (Freeze Cache changes both); the server enforces them. */
  cost: number;
  max: number;
  balance: number;
  gamificationOn: boolean;
}

/** Buy streak freezes: each one saves the daily streak once if you miss a day. */
export const StreakFreezeCard = ({ freezes, cost: COST, max: MAX, balance, gamificationOn }: Props) => {
  const buy = useBuyStreakFreeze();
  // Spending XP asks first, as buying a class, a skill or a cosmetic does.
  const [confirming, setConfirming] = useState(false);
  const full = freezes >= MAX;
  const poor = balance < COST;
  const disabled = !gamificationOn || full || poor || buy.isPending;
  const hint = !gamificationOn ? "Turn on gamification to buy freezes." : full ? `You hold the maximum of ${MAX}.` : poor ? `You need ${COST} XP (you have ${balance.toLocaleString()}).` : "Used automatically when a missed day would break your streak.";

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 sm:mb-8 sm:p-5" aria-labelledby="freeze-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 sm:h-12 sm:w-12">
            <Snowflake className="h-5 w-5 text-cyan-700 dark:text-cyan-400 sm:h-6 sm:w-6" aria-hidden />
          </div>
          <div>
            <h2 id="freeze-heading" className="font-heading font-semibold">Streak freezes</h2>
            <p className="text-sm text-foreground-muted">
              <span className="font-medium text-foreground">{freezes}/{MAX}</span> held. {hint}
            </p>
          </div>
        </div>
        <Button variant="outline" className="gap-2" disabled={disabled} onClick={() => setConfirming(true)}>
          {buy.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Snowflake className="h-4 w-4" aria-hidden />}
          Buy one ({COST} XP)
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Buy a streak freeze?"
        description={(
          <p className="text-sm">
            It costs <span className="font-semibold text-xp">{COST} XP</span> ({balance.toLocaleString()} XP now) and saves your streak once
            if you miss a day. You will hold {Math.min(MAX, freezes + 1)} of {MAX}.
          </p>
        )}
        confirmLabel={`Buy for ${COST} XP`}
        onConfirm={() => buy.mutate()}
      />
    </section>
  );
};
