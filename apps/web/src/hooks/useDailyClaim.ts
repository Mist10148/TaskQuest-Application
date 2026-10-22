import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useClaimDaily } from "@/hooks/useApi";
import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown, nextClaimAt } from "@/lib/countdown";
import { dailyDescription } from "@/lib/classInfo";

/**
 * The daily reward, wherever it is offered (Dashboard, Today): claim it with the usual toasts, and know how long until the next one.
 * The reward has a rolling 24h cooldown from the last claim (from the server, so it is right after a reload too).
 */
export function useDailyClaim() {
  const { user } = useAuth();
  const claimDaily = useClaimDaily();
  // Earliest time the daily reward is claimable again, learned from this session's claim or the server's answer.
  const [claimedUntil, setClaimedUntil] = useState<number | null>(null);
  const lastClaimIso = user?.user?.last_daily_claim;
  const lastClaim = lastClaimIso ? new Date(lastClaimIso).getTime() : 0;
  const claimTarget = Math.max(nextClaimAt(lastClaim) ?? 0, claimedUntil ?? 0) || null;
  const waitMs = useCountdown(claimTarget);

  const claim = async () => {
    try {
      const result = await claimDaily.mutateAsync();
      if (result.success) {
        const description = dailyDescription(result);
        toast.success(`🎁 Daily reward claimed! +${result.totalXP} XP`, { description: description || undefined, duration: 4000 });
        setClaimedUntil(nextClaimAt(Date.now()));
      } else {
        const remaining = result.remaining ?? 0;
        toast.error("Daily reward not ready yet", { description: remaining > 0 ? `Come back in ${formatCountdown(remaining)}.` : undefined });
        if (remaining > 0) setClaimedUntil(Date.now() + remaining);
      }
    } catch {
      /* error toast shown by the mutation */
    }
  };

  return {
    claim,
    pending: claimDaily.isPending,
    /** Milliseconds until the next claim; 0 when it can be claimed now. */
    waitMs,
    claimed: waitMs > 0,
    /** Ever claimed (on record, or in this session). */
    everClaimed: lastClaim > 0 || claimedUntil !== null,
  };
}
