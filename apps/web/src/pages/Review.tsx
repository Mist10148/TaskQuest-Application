import { CheckCircle2, ClipboardCheck, Flame, Gift, Loader2, Sparkles } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { QueryState } from "@/components/feedback/QueryState";
import { Button } from "@/components/ui/button";
import { useClaimReview, useReview } from "@/hooks/useApi";
import { useCountdown } from "@/hooks/useCountdown";
import { formatLongCountdown } from "@/lib/countdown";
import { shortDate } from "@/lib/stats";
import type { WeeklyReview } from "@/lib/api";

const ReviewCard = ({ review }: { review: WeeklyReview }) => {
  const claim = useClaimReview();
  const left = useCountdown(Date.parse(review.resetsAt), 60_000);
  const hint = review.claimed
    ? "You claimed this week's review. A new one opens on Monday."
    : review.completed === 0
      ? "Finish at least one task this week to unlock the bonus."
      : "Nice week so far. Claim your bonus before the week resets.";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <CheckCircle2 className="mb-1 h-5 w-5 text-success" aria-hidden />
          <p className="font-heading text-2xl font-bold" data-testid="review-completed">{review.completed}</p>
          <p className="text-xs text-foreground-muted">tasks completed</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <Sparkles className="mb-1 h-5 w-5 text-xp" aria-hidden />
          <p className="font-heading text-2xl font-bold">{review.xpEarned.toLocaleString()}</p>
          <p className="text-xs text-foreground-muted">XP earned</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
          <Flame className="mb-1 h-5 w-5 text-destructive-text" aria-hidden />
          <p className="font-heading text-2xl font-bold">{review.streak}</p>
          <p className="text-xs text-foreground-muted">day streak</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 text-center sm:p-6">
        <Gift className="mx-auto mb-2 h-8 w-8 text-primary-text" aria-hidden />
        <p className="font-heading text-lg font-semibold">Weekly review bonus: +{review.reward} XP</p>
        <p className="mt-1 text-sm text-foreground-muted">{hint}</p>
        {review.claimed ? (
          <p className="mt-4 inline-flex items-center gap-2 font-medium text-success" role="status">
            <CheckCircle2 className="h-5 w-5" aria-hidden /> Claimed
          </p>
        ) : (
          <Button className="mt-4 gap-2" disabled={!review.claimable || claim.isPending} onClick={() => claim.mutate()}>
            {claim.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Gift className="h-4 w-4" aria-hidden />}
            Claim review bonus
          </Button>
        )}
        <p className="mt-4 text-xs text-foreground-muted">
          Week of {shortDate(review.weekStart)} · resets in {formatLongCountdown(left)} (Monday 00:00 UTC)
        </p>
      </div>
    </div>
  );
};

const Review = () => {
  const review = useReview();
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-4 sm:space-y-6">
        <header>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-bold sm:text-3xl">
            <ClipboardCheck className="h-6 w-6 text-primary-text sm:h-7 sm:w-7" aria-hidden /> Weekly review
          </h1>
          <p className="text-sm text-foreground-muted">Look back at this week and collect a once-a-week bonus.</p>
        </header>
        <QueryState query={review} what="your weekly review" skeleton={<div className="h-64 animate-pulse rounded-xl bg-card/50" aria-busy="true" />}>
          {(r) => <ReviewCard review={r} />}
        </QueryState>
      </div>
    </DashboardLayout>
  );
};

export default Review;
