import { useState } from "react";
import { Loader2, Sparkles, Flame, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { usePrioritize, useUpdateList } from "@/hooks/useApi";
import type { AiRankedTask, Priority } from "@/lib/api";
import { AiBadge } from "./SummaryCard";
import { useSlow } from "./useSlow";

/** "What should I do next?": ranked quests with reasons. Priority changes are suggestions the user accepts or rejects. */
export function PriorityPanel({ onOpen }: { onOpen?: (listId: number) => void }) {
  const { user } = useAuth();
  const { data, refetch, isFetching, error } = usePrioritize(5);
  const updateList = useUpdateList();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const slow = useSlow(isFetching);

  if (!user?.features?.ai) return null;

  const accept = async (task: AiRankedTask, priority: Priority) => {
    await updateList.mutateAsync({ listId: task.listId, data: { priority } });
    setDismissed((s) => new Set(s).add(task.id));
    refetch();
  };

  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary" />
          <h2 className="font-heading font-semibold">What should I do next?</h2>
          {data && !data.usedFallback && <AiBadge />}
        </div>
        <Button size="sm" variant={data ? "outline" : "glow"} onClick={() => refetch()} disabled={isFetching} className="gap-1">
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {data ? "Refresh" : "Prioritize my quests"}
        </Button>
      </div>

      {isFetching && slow && <p className="mt-3 text-xs text-foreground-muted">Waking up the AI… the first request can take a few seconds.</p>}
      {error && !isFetching && <p className="mt-3 text-sm text-destructive">{(error as Error).message}</p>}

      {data && (
        <div className="mt-4 space-y-3">
          {data.focusMessage && <p className="text-sm text-foreground-muted">{data.focusMessage}</p>}
          {data.usedFallback && (
            <p className="text-xs text-foreground-muted">The AI is resting, so this ranking uses deadlines and priorities only.</p>
          )}
          {data.ranked.length === 0 && <p className="text-sm text-foreground-muted">No open quests to rank.</p>}
          <ol className="space-y-2">
            {data.ranked.map((task) => (
              <li key={task.id} className="flex items-start gap-3 rounded-lg bg-background-secondary/60 p-3">
                <span className={cn("h-6 w-6 shrink-0 rounded-full text-xs font-bold flex items-center justify-center", task.rank === 1 ? "bg-primary text-primary-foreground" : "bg-card text-foreground-muted")}>{task.rank}</span>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpen?.(task.listId)} className="font-medium text-sm text-left hover:text-primary truncate max-w-full">
                    {task.name}
                  </button>
                  <p className="text-xs text-foreground-muted">{task.reason}</p>
                  {task.suggestedPriority && !dismissed.has(task.id) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span>Change priority to <b>{task.suggestedPriority}</b>?</span>
                      <Button size="sm" variant="outline" className="h-6 px-2" disabled={updateList.isPending} onClick={() => accept(task, task.suggestedPriority as Priority)}><Check className="h-3 w-3 mr-1" />Accept</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setDismissed((s) => new Set(s).add(task.id))}><X className="h-3 w-3 mr-1" />Reject</Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
