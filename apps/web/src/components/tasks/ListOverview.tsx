import { useState } from "react";
import { AlertCircle, Keyboard, Plus, Scroll } from "lucide-react";
import { motion } from "framer-motion";
import type { ListWithCounts } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { TaskListCard } from "@/components/game/TaskComponents";
import { PriorityPanel } from "@/components/ai/PriorityPanel";
import { ListFilters } from "./ListFilters";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { useHotkeys } from "@/hooks/useHotkeys";
import type { useListFilters } from "./useListFilters";

interface Props {
  lists: ListWithCounts[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  filters: ReturnType<typeof useListFilters>;
  onOpen: (listId: number) => void;
  onCreate: () => void;
}

/** The quest log: header, AI priorities, filters and the grid of quest cards. */
export const ListOverview = ({ lists, loading, error, onRetry, retrying, filters, onOpen, onCreate }: Props) => {
  const [showHelp, setShowHelp] = useState(false);
  useHotkeys({
    n: (e) => { e.preventDefault(); onCreate(); },
    "/": (e) => { e.preventDefault(); document.getElementById("quest-search")?.focus(); },
    "?": () => setShowHelp(true),
  });
  return (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-heading font-bold flex items-center gap-2">
          <Scroll className="h-7 w-7 text-primary-text" />
          Quest Log
        </h1>
        <p className="text-foreground-muted text-sm sm:text-base">Manage your quests and track progress</p>
      </div>
      <Button variant="glow" onClick={onCreate} className="gap-2">
        <Plus className="h-4 w-4" /> Create Quest
      </Button>
    </div>

    <PriorityPanel onOpen={onOpen} />
    <ListFilters filters={filters} />

    {error ? (
      <ErrorCard what="your quests" error={error} onRetry={onRetry} retrying={retrying} />
    ) : loading ? (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
        {[...Array(6)].map((_, i) => <div key={i} className="h-48 rounded-xl bg-card/50 animate-pulse" />)}
      </div>
    ) : filters.visible.length === 0 ? (
      <div className="text-center py-12">
        {lists.length === 0 ? (
          <>
            <AlertCircle className="h-12 w-12 mx-auto text-foreground-muted mb-4" />
            <h3 className="font-heading font-semibold mb-2">No quests yet</h3>
            <p className="text-foreground-muted mb-4 text-sm">Create your first quest to start your adventure!</p>
            <Button onClick={onCreate} className="gap-2"><Plus className="h-4 w-4" /> Create Quest</Button>
          </>
        ) : (
          <p className="text-foreground-muted">No quests match your filters</p>
        )}
      </div>
    ) : (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filters.visible.map((list, i) => (
          <motion.div key={list.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <TaskListCard
              name={list.name}
              description={list.description ?? undefined}
              itemsCompleted={list.itemsCompleted || 0}
              itemsTotal={list.itemsTotal || 0}
              category={list.category ?? undefined}
              priority={list.priority}
              deadline={list.deadline ?? undefined}
              onClick={() => onOpen(list.id)}
            />
          </motion.div>
        ))}
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border-2 border-dashed border-border p-6 flex flex-col items-center justify-center hover:border-primary/50 hover:bg-primary/5 min-h-[200px] transition-all group"
          onClick={onCreate}
        >
          <Plus className="h-8 w-8 text-foreground-muted mb-2 group-hover:scale-110 transition-transform" />
          <p className="text-foreground-muted text-sm">Create New Quest</p>
        </motion.button>
      </div>
    )}
    <p className="mt-6 text-center text-xs text-foreground-muted">
      <button type="button" onClick={() => setShowHelp(true)} className="inline-flex items-center gap-1 hover:text-foreground">
        <Keyboard className="h-3.5 w-3.5" aria-hidden /> Keyboard shortcuts (?)
      </button>
    </p>
    <ShortcutsDialog open={showHelp} onOpenChange={setShowHelp} />
  </motion.div>
  );
};
