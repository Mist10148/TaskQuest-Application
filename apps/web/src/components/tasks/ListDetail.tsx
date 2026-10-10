import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Calendar, CheckCheck, CheckSquare, Keyboard, Pencil, Plus, Scroll, Trash2, X } from "lucide-react";
import { motion } from "framer-motion";
import type { Item, ListWithItems } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SummarizeButton } from "@/components/ai/SummarizeButton";
import { formatDeadline } from "@/lib/dates";
import type { QuickAddResult } from "@/lib/quickAdd";
import { cn } from "@/lib/utils";
import { CATEGORIES } from "./constants";
import { QuickAddBar } from "./QuickAddBar";
import { TaskRow } from "./TaskRow";
import { useItemDragReorder } from "./useItemDragReorder";
import { useHotkeys } from "@/hooks/useHotkeys";
import { ShortcutsDialog } from "./ShortcutsDialog";

interface Props {
  list: ListWithItems;
  aiEnabled: boolean;
  quickAddPending: boolean;
  /** Tasks hidden while their delete can still be undone. */
  hiddenIds: Set<number>;
  onBack: () => void;
  onAddItem: (parentId?: number) => void;
  onQuickAdd: (parsed: QuickAddResult) => Promise<void>;
  onEditList: () => void;
  onDeleteList: () => void;
  onToggleItem: (itemId: number) => void;
  onEditItem: (itemId: number) => void;
  onDeleteItem: (itemId: number) => void;
  onBulkComplete: (itemIds: number[]) => Promise<unknown>;
  onBulkDelete: (itemIds: number[]) => void;
  /** Saves the full new order of every task id in the list. */
  onReorder: (itemIds: number[]) => Promise<unknown>;
}

const PRIORITY_BADGE: Record<string, string> = {
  HIGH: "bg-red-500/20 text-red-400 border border-red-500/30",
  MEDIUM: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
  LOW: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
};

/** One quest: header, progress bar, quick add and its tasks (subtasks sit under their parent). */
export const ListDetail = ({ list, aiEnabled, quickAddPending, hiddenIds, onBack, onAddItem, onQuickAdd, onEditList, onDeleteList, onToggleItem, onEditItem, onDeleteItem, onBulkComplete, onBulkDelete, onReorder }: Props) => {
  const items = useMemo(
    () => (list.items || []).filter((i: Item) => !hiddenIds.has(i.id) && !(i.parent_id && hiddenIds.has(i.parent_id))),
    [list.items, hiddenIds]
  );
  const completed = items.filter((i: Item) => i.completed).length;
  const progress = items.length > 0 ? (completed / items.length) * 100 : 0;

  const { topLevel, childrenOf } = useMemo(() => {
    const kids = new Map<number, Item[]>();
    const top: Item[] = [];
    for (const i of items) {
      if (i.parent_id) kids.set(i.parent_id, [...(kids.get(i.parent_id) || []), i]);
      else top.push(i);
    }
    return { topLevel: top, childrenOf: kids };
  }, [items]);

  // Reordering moves whole groups: the parent order changes, subtasks keep their order under their parent.
  const saveTopLevelOrder = (topIds: number[]) =>
    onReorder(topIds.flatMap((id) => [id, ...(childrenOf.get(id) || []).map((c) => c.id)]));
  const drag = useItemDragReorder(topLevel, saveTopLevelOrder);

  // Select several tasks to complete or delete them together.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showHelp, setShowHelp] = useState(false);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const toggleSelected = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const leaveSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };
  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id);
  const openIds = items.filter((i) => selected.has(i.id) && !i.completed).map((i) => i.id);

  useHotkeys({
    n: (e) => { e.preventDefault(); onAddItem(); },
    "/": (e) => { e.preventDefault(); quickAddRef.current?.focus(); },
    s: () => (selectMode ? leaveSelectMode() : setSelectMode(true)),
    "?": () => setShowHelp(true),
    Escape: () => (selectMode ? leaveSelectMode() : onBack()),
  });

  const move = (id: number, direction: -1 | 1, siblings: Item[]) => {
    const from = siblings.findIndex((s) => s.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    const parentId = reordered[0].parent_id;
    if (!parentId) return void saveTopLevelOrder(reordered.map((s) => s.id));
    // Subtasks: rewrite the whole list with this parent's children in their new order.
    const flat = topLevel.flatMap((t) => [t.id, ...(t.id === parentId ? reordered : childrenOf.get(t.id) || []).map((c) => c.id)]);
    void onReorder(flat);
  };

  const row = (item: Item, siblings: Item[], isSubtask: boolean) => {
    const index = siblings.findIndex((s) => s.id === item.id);
    return (
      <TaskRow
        key={item.id}
        item={item}
        listPriority={list.priority}
        isSubtask={isSubtask}
        selectMode={selectMode}
        selected={selected.has(item.id)}
        onSelect={toggleSelected}
        onToggle={onToggleItem}
        onEdit={onEditItem}
        onDelete={onDeleteItem}
        onAddSubtask={(id) => onAddItem(id)}
        onMove={(id, dir) => move(id, dir, siblings)}
        canMoveUp={index > 0}
        canMoveDown={index < siblings.length - 1}
        drag={
          isSubtask
            ? undefined
            : { draggable: true, isDragOver: drag.dragOverItemId === item.id, isDragging: drag.draggedItemId === item.id, ...drag.handlers }
        }
      />
    );
  };

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
            <Button variant="outline" size="sm" onClick={() => onAddItem()} className="gap-1">
              <Plus className="h-4 w-4" /> Add Task
            </Button>
            <Button variant={selectMode ? "default" : "outline"} size="sm" onClick={() => (selectMode ? leaveSelectMode() : setSelectMode(true))} className="gap-1" aria-pressed={selectMode} title="Select tasks (s)">
              <CheckSquare className="h-4 w-4" /><span className="hidden sm:inline">Select</span>
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

      <QuickAddBar ref={quickAddRef} pending={quickAddPending} aiEnabled={aiEnabled} onAdd={onQuickAdd} />

      {items.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
          <Scroll className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No tasks yet. Type one above or press Add Task.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-foreground-muted mb-3 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
            Drag tasks (or use the arrows) to reorder
          </p>
          {topLevel.map((item) => (
            <div key={item.id} className="space-y-2">
              {row(item, topLevel, false)}
              {(childrenOf.get(item.id) || []).map((child) => row(child, childrenOf.get(item.id) || [], true))}
            </div>
          ))}
        </div>
      )}

      {selectMode && (
        <div className="sticky bottom-4 z-10 mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-card/95 p-3 shadow-lg backdrop-blur" role="toolbar" aria-label="Bulk actions">
          <span className="text-sm font-medium mr-auto" aria-live="polite">{selectedIds.length} selected</span>
          <Button size="sm" variant="outline" className="gap-1" disabled={selectedIds.length === items.length} onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
            Select all
          </Button>
          <Button size="sm" className="gap-1" disabled={openIds.length === 0} onClick={async () => { await onBulkComplete(openIds); leaveSelectMode(); }}>
            <CheckCheck className="h-4 w-4" /> Complete{openIds.length ? ` (${openIds.length})` : ""}
          </Button>
          <Button size="sm" variant="destructive" className="gap-1" disabled={selectedIds.length === 0} onClick={() => { onBulkDelete(selectedIds); leaveSelectMode(); }}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button size="sm" variant="ghost" aria-label="Leave select mode" onClick={leaveSelectMode}><X className="h-4 w-4" /></Button>
        </div>
      )}

      <p className="mt-4 text-center text-xs text-foreground-muted">
        <button type="button" onClick={() => setShowHelp(true)} className="inline-flex items-center gap-1 hover:text-foreground">
          <Keyboard className="h-3.5 w-3.5" aria-hidden /> Keyboard shortcuts (?)
        </button>
      </p>
      <ShortcutsDialog open={showHelp} onOpenChange={setShowHelp} />

      <button onClick={() => onAddItem()} className="w-full mt-4 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 flex items-center justify-center gap-2 text-foreground-muted text-sm transition-all group">
        <Plus className="h-5 w-5 group-hover:scale-110 transition-transform" /> Add New Task
      </button>
    </motion.div>
  );
};
