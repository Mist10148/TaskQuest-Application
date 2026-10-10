import { ArrowLeft, Calendar, Pencil, Plus, Scroll, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import type { Item, ListWithItems } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { TaskItem } from "@/components/game/TaskComponents";
import { SummarizeButton } from "@/components/ai/SummarizeButton";
import { formatDeadline } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { CATEGORIES } from "./constants";
import { useItemDragReorder } from "./useItemDragReorder";

interface Props {
  list: ListWithItems;
  onBack: () => void;
  onAddItem: () => void;
  onEditList: () => void;
  onDeleteList: () => void;
  onToggleItem: (itemId: number) => void;
  onEditItem: (itemId: number) => void;
  onDeleteItem: (itemId: number) => void;
  onReorder: (itemIds: number[]) => Promise<unknown>;
}

const PRIORITY_BADGE: Record<string, string> = {
  HIGH: "bg-red-500/20 text-red-400 border border-red-500/30",
  MEDIUM: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
  LOW: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
};

/** One quest: header, progress bar and its tasks. */
export const ListDetail = ({ list, onBack, onAddItem, onEditList, onDeleteList, onToggleItem, onEditItem, onDeleteItem, onReorder }: Props) => {
  const items = list.items || [];
  const completed = items.filter((i: Item) => i.completed).length;
  const progress = items.length > 0 ? (completed / items.length) * 100 : 0;
  const drag = useItemDragReorder(items, onReorder);

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="px-4 sm:px-0">
      <div className="mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-foreground-muted hover:text-foreground mb-4 text-sm group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" /> Back to Quests
        </button>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-heading font-bold">{list.name}</h1>
              {list.priority && <span className={cn("text-xs px-2 py-1 rounded-full font-medium", PRIORITY_BADGE[list.priority])}>{list.priority}</span>}
            </div>
            {list.description && <p className="text-foreground-muted mt-1 text-sm sm:text-base">{list.description}</p>}
            <div className="flex gap-4 mt-2 text-sm text-foreground-muted flex-wrap">
              {list.category && <span className="flex items-center gap-1">{CATEGORIES.find((c) => c.value === list.category)?.emoji} {list.category}</span>}
              {list.deadline && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Due: {formatDeadline(list.deadline)}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <SummarizeButton body={{ mode: "list", listId: list.id }} title={`Summary: ${list.name}`} />
            <Button variant="outline" size="sm" onClick={onAddItem} className="gap-1">
              <Plus className="h-4 w-4" /> Add Task
            </Button>
            <Button variant="outline" size="sm" onClick={onEditList} className="gap-1">
              <Pencil className="h-4 w-4" /><span className="hidden sm:inline">Edit</span>
            </Button>
            <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={onDeleteList} aria-label="Delete quest">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-card to-card/50 border border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />
        <div className="relative">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-foreground-muted">Quest Progress</span>
            <span className="font-medium font-heading">{completed}/{items.length} Tasks</span>
          </div>
          <div className="h-3 rounded-full bg-background-secondary overflow-hidden" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Quest progress">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={cn("h-full rounded-full", progress === 100 ? "bg-gradient-to-r from-success to-emerald-400" : "bg-gradient-to-r from-primary to-violet-500")}
            />
          </div>
          {progress === 100 && <p className="text-xs text-success mt-2 font-medium">🎉 Quest Complete!</p>}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
          <Scroll className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No tasks yet. Add one above!</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-foreground-muted mb-3 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Drag tasks to reorder • Hover to edit or delete
          </p>
          <div className="space-y-2">
            {items.map((item: Item) => (
              <TaskItem
                key={item.id}
                id={item.id}
                name={item.name}
                description={item.description ?? undefined}
                completed={Boolean(item.completed)}
                onToggle={onToggleItem}
                onEdit={onEditItem}
                onDelete={onDeleteItem}
                draggable
                {...drag.handlers}
                isDragOver={drag.dragOverItemId === item.id}
                isDragging={drag.draggedItemId === item.id}
              />
            ))}
          </div>
        </div>
      )}

      <button onClick={onAddItem} className="w-full mt-4 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 flex items-center justify-center gap-2 text-foreground-muted text-sm transition-all group">
        <Plus className="h-5 w-5 group-hover:scale-110 transition-transform" /> Add New Task
      </button>
    </motion.div>
  );
};
