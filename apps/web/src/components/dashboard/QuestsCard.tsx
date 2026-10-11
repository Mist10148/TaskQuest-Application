import { Gift, Loader2, ScrollText } from "lucide-react";
import { motion } from "framer-motion";
import type { Quest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { useClaimQuest, useQuests } from "@/hooks/useApi";
import { cn } from "@/lib/utils";

const QuestRow = ({ quest, onClaim, claiming }: { quest: Quest; onClaim: (key: string) => void; claiming: boolean }) => {
  const percent = Math.min(100, Math.round((quest.progress / quest.target) * 100));
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="text-2xl" aria-hidden>{quest.emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn("truncate text-sm font-medium", quest.claimed && "text-foreground-muted line-through")}>{quest.name}</p>
          {quest.rotating && (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-text">This week's pick</span>
          )}
          <span className="shrink-0 text-xs font-medium text-xp">+{quest.reward} XP</span>
        </div>
        <p className="truncate text-xs text-foreground-muted">{quest.description}</p>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background-tertiary"
          role="progressbar"
          aria-label={`${quest.name} progress`}
          aria-valuemin={0}
          aria-valuemax={quest.target}
          aria-valuenow={quest.progress}
        >
          <div className={cn("h-full rounded-full transition-all", quest.claimed ? "bg-success" : "bg-primary")} style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="w-20 shrink-0 text-right">
        {quest.claimed ? (
          <span className="text-xs font-medium text-success">Claimed</span>
        ) : quest.claimable ? (
          <Button size="sm" className="gap-1" disabled={claiming} onClick={() => onClaim(quest.key)}>
            {claiming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5" aria-hidden />} Claim
          </Button>
        ) : (
          <span className="text-xs text-foreground-muted">{quest.progress}/{quest.target}</span>
        )}
      </div>
    </li>
  );
};

/** Daily, weekly and monthly quests with progress and claim buttons. */
export const QuestsCard = () => {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuests();
  const claim = useClaimQuest();
  const quests = data?.quests ?? [];
  const daily = quests.filter((q) => q.period === "daily");
  const weekly = quests.filter((q) => q.period === "weekly");
  const monthly = quests.filter((q) => q.period === "monthly");

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} aria-labelledby="quests-heading">
      <h2 id="quests-heading" className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold sm:text-xl">
        <ScrollText className="h-4 w-4 text-primary-text sm:h-5 sm:w-5" aria-hidden /> Daily, weekly &amp; monthly quests
      </h2>
      {isError ? (
        <ErrorCard what="your quests" error={error} onRetry={() => void refetch()} retrying={isFetching} />
      ) : isLoading ? (
        <div className="h-48 animate-pulse rounded-xl bg-card/50" aria-busy="true" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[
            ["Today", daily, "Resets at your midnight"] as const,
            ["This week", weekly, "Resets Monday at your midnight"] as const,
            ["This month", monthly, "Resets on the 1st at your midnight"] as const,
          ].filter(([, list]) => list.length > 0).map(([title, list, resets]) => (
            <div key={title} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-baseline justify-between">
                <h3 className="font-heading font-semibold">{title}</h3>
                <p className="text-xs text-foreground-muted">{resets}</p>
              </div>
              <ul className="divide-y divide-border">
                {list.map((q) => (
                  <QuestRow key={q.key} quest={q} claiming={claim.isPending && claim.variables === q.key} onClaim={(key) => claim.mutate(key)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </motion.section>
  );
};
