import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDailyClaim } from "@/hooks/useDailyClaim";
import { streakDeadline } from "@/lib/today";

/** A streak that ends unless today's reward is claimed, with the claim right here (Today and the Dashboard). */
export const StreakAtRisk = ({ live, expiresAt }: { live: number; expiresAt?: string | null }) => {
  const daily = useDailyClaim();
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" data-testid="streak-warning">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive-text" aria-hidden />
      <p className="min-w-0 flex-1">
        Your <strong>{live}-day streak</strong> ends {streakDeadline(expiresAt)} if you do not claim your daily reward.
      </p>
      <Button size="sm" variant="outline" className="shrink-0 gap-1" disabled={daily.pending || daily.claimed} onClick={() => void daily.claim()}>
        {daily.pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {daily.claimed ? "Claimed" : "Claim now"}
      </Button>
    </div>
  );
};
