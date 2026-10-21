import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Calendar, CheckCheck, CheckSquare, Eye, FilePlus, Keyboard, Pencil, SlidersHorizontal, Plus, Scroll, Trash2, Users, X } from "lucide-react";
import { motion } from "framer-motion";
import type { Item, ListWithItems, Priority } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SummarizeButton } from "@/components/ai/SummarizeButton";
import { formatDeadline } from "@/lib/dates";
import { completeOrder, rangeBetween } from "@/lib/reorder";
import type { QuickAddResult } from "@/lib/quickAdd";
import { cn } from "@/lib/utils";
import { CATEGORIES } from "./constants";
import { QuickAddBar } from "./QuickAddBar";
import { TaskRow } from "./TaskRow";
import { TaskBoard } from "./TaskBoard";
import { TaskFilterBar } from "./TaskFilterBar";
import { DEFAULT_FILTER, filterTasks, groupTasks, isFiltering, loadFilterPrefs, saveFilterPrefs, tagsIn, type GroupBy, type TaskFilter } from "@/lib/taskFilters";
import { localToday } from "@/lib/dates";
import { TaskCalendar } from "./TaskCalendar";
import { TaskDetailSheet } from "./TaskDetailSheet";
import { BulkEditDialog } from "./BulkEditDialog";
import type { BulkEditValues } from "@/lib/bulkEdit";
import { TASK_VIEWS, type TaskView } from "@/lib/taskViews";
import { useItemDragReorder } from "./useItemDragReorder";
import { useHotkeys } from "@/hooks/useHotkeys";
import { stepCursor } from "@/lib/cursor";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { canDeleteList, canEditTasks, canManageList, peopleLabel, roleLabel, roleOf } from "@/lib/sharing";

interface Props {
  list: ListWithItems;
  /** A task to open in the detail drawer once the quest has loaded (from ?task=); `onTaskOpened` then clears the request. */
  openTaskId?: number | null;
  onTaskOpened?: () => void;
  aiEnabled: boolean;
  quickAddPending: boolean;
  /** Tasks hidden while their delete can still be undone. */
  hiddenIds: Set<number>;
  onBack: () => void;
  onOpenMembers: () => void;
  onAddItem: (parentId?: number) => void;
  onQuickAdd: (parsed: QuickAddResult) => Promise<boolean>;
  onEditList: () => void;
  onSaveTemplate: () => void;
  onDeleteList: () => void;
  onToggleItem: (itemId: number) => void;
  onEditItem: (itemId: number) => void;
  /** Set one task's priority (moving a card between the board's columns). */
  onSetPriority: (itemId: number, priority: Priority | null) => void;
  /** A shared quest's owner and members, for assigning tasks (absent on a quest nobody shares). */
  assignOptions?: ReadonlyArray<{ memberKey: string; name: string | null; isYou: boolean }>;
  onAssign?: (itemId: number, memberKey: string | null) => void;
  /** Other quests tasks can be moved to. */
  moveTargets?: ReadonlyArray<{ id: number; name: string }>;
  /** Move top-level tasks (their subtasks go with them) to another quest. */
  onMove?: (itemIds: number[], listId: number) => Promise<unknown>;
  onDeleteItem: (itemId: number) => void;
  onBulkComplete: (itemIds: number[]) => Promise<unknown>;
  onBulkDelete: (itemIds: number[]) => void;
  /** Applies the same priority / due date change to every id; resolves when done. */
  onBulkEdit: (itemIds: number[], values: BulkEditValues) => Promise<unknown>;
  /** Saves the full new order of every task id in the list. */
  onReorder: (itemIds: number[]) => Promise<unknown>;
}

/** Deleting more tasks than this at once asks first (a smaller selection is covered by Undo alone). */
const BULK_DELETE_CONFIRM_ABOVE = 5;

const PRIORITY_BADGE: Record<string, string> = {
  HIGH: "bg-red-500/20 text-red-700 dark:text-red-400 border border-red-500/30",
  MEDIUM: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border border-yellow-500/30",
  LOW: "bg-blue-500/20 text-blue-700 dark:text-blue-400 border border-blue-500/30",
};

/** One quest: header, progress bar, quick add and its tasks (subtasks sit under their parent). */
export const ListDetail = ({ list, openTaskId, onTaskOpened, aiEnabled, quickAddPending, hiddenIds, onBack, onOpenMembers, onAddItem, onQuickAdd, onEditList, onSaveTemplate, onDeleteList, onToggleItem, onEditItem, onSetPriority, assignOptions, onAssign, moveTargets, onMove, onDeleteItem, onBulkComplete, onBulkDelete, onBulkEdit, onReorder }: Props) => {
  const role = roleOf(list);
  const editable = canEditTasks(role);
  const manageable = canManageList(role);
  const deletable = canDeleteList(list);
  const items = useMemo(
    () => (list.items || []).filter((i: Item) => !hiddenIds.has(i.id) && !(i.parent_id && hiddenIds.has(i.parent_id))),
    [list.items, hiddenIds]
  );

  const { topLevel, childrenOf } = useMemo(() => {
    const kids = new Map<number, Item[]>();
    const top: Item[] = [];
    for (const i of items) {
      if (i.parent_id) kids.set(i.parent_id, [...(kids.get(i.parent_id) || []), i]);
      else top.push(i);
    }
    return { topLevel: top, childrenOf: kids };
  }, [items]);
  // Progress counts tasks, not their subtasks, like the quest log's counts (`itemsTotal` / `itemsCompleted`).
  const completed = topLevel.filter((i: Item) => i.completed).length;
  const progress = topLevel.length > 0 ? (completed / topLevel.length) * 100 : 0;

  // Filters and grouping (remembered per browser). A tag this quest does not use counts as "any tag".
  const [prefs, setPrefs] = useState(loadFilterPrefs);
  const questTags = useMemo(() => tagsIn(items), [items]);
  const filter: TaskFilter = useMemo(
    () => (prefs.filter.tag && !questTags.includes(prefs.filter.tag) ? { ...prefs.filter, tag: "" } : prefs.filter),
    [prefs.filter, questTags]
  );
  const groupBy = prefs.groupBy;
  const updatePrefs = (next: { filter?: TaskFilter; groupBy?: GroupBy }) => {
    const merged = { filter: next.filter ?? filter, groupBy: next.groupBy ?? groupBy };
    setPrefs(merged);
    saveFilterPrefs(merged.filter, merged.groupBy);
  };
  const today = localToday();
  const shown = useMemo(() => filterTasks(topLevel, childrenOf, filter, list.priority, today), [topLevel, childrenOf, filter, list.priority, today]);
  const shownItems = useMemo(() => shown.topLevel.flatMap((t) => [t, ...(shown.childrenOf.get(t.id) ?? [])]), [shown]);
  const groups = useMemo(() => groupTasks(shown.topLevel, groupBy, list.priority, today), [shown.topLevel, groupBy, list.priority, today]);
  // Reordering a partial or regrouped view would be guesswork, so it is only offered on the plain list.
  const reorderable = !isFiltering(filter) && groupBy === "none";

  // Reordering moves whole groups: the parent order changes, subtasks keep their order under their parent.
  // The server needs every task id of the list, so tasks hidden by a pending undo-delete are appended last.
  const reorderAll = (visibleOrder: number[]) => onReorder(completeOrder(visibleOrder, (list.items || []).map((i: Item) => i.id)));
  const saveTopLevelOrder = (topIds: number[]) =>
    reorderAll(topIds.flatMap((id) => [id, ...(childrenOf.get(id) || []).map((c) => c.id)]));
  const drag = useItemDragReorder(topLevel, saveTopLevelOrder);

  // Select several tasks to complete or delete them together.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showHelp, setShowHelp] = useState(false);
  // How the tasks are drawn: remembered per browser (a convenience only, so a blocked store is fine).
  const [view, setViewState] = useState<TaskView>(() => {
    try {
      const saved = window.localStorage.getItem("taskquest:task-view");
      return saved === "board" || saved === "calendar" ? saved : "list";
    } catch {
      return "list";
    }
  });
  const setView = (next: TaskView) => {
    setViewState(next);
    try {
      window.localStorage.setItem("taskquest:task-view", next);
    } catch {
      /* the choice just is not remembered */
    }
  };
  // The task shown in the detail drawer (looked up by id, so it follows edits and completion).
  const [detailId, setDetailId] = useState<number | null>(null);
  useEffect(() => {
    if (!openTaskId) return;
    if ((list.items || []).some((i: Item) => i.id === openTaskId)) setDetailId(openTaskId);
    onTaskOpened?.(); // a task that is not on this quest (deleted, or a wrong link) just opens the quest
  }, [openTaskId, list.items, onTaskOpened]);
  const detailItem = detailId !== null ? items.find((i) => i.id === detailId) ?? null : null;
  const [confirmBulk, setConfirmBulk] = useState<number[] | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditing, setBulkEditing] = useState(false);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const lastSelectedRef = useRef<number | null>(null);
  // Rows in the order they are drawn (each task followed by its subtasks), for Shift-click ranges.
  const visibleOrder = groups.flatMap((g) => g.items).flatMap((t) => [t.id, ...(shown.childrenOf.get(t.id) || []).map((c) => c.id)]);
  const toggleSelected = (id: number, range = false) => {
    const anchor = lastSelectedRef.current;
    lastSelectedRef.current = id;
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && anchor !== null) {
        for (const rid of rangeBetween(visibleOrder, anchor, id)) next.add(rid);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const leaveSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
    lastSelectedRef.current = null;
  };
  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id);
  const openIds = items.filter((i) => selected.has(i.id) && !i.completed).map((i) => i.id);
  // An editor may only delete tasks they added; the rest of a selection is left alone.
  const deletableIds = items.filter((i) => selected.has(i.id) && i.can_delete !== false).map((i) => i.id);
  // Only top-level tasks move (each takes its subtasks along).
  const movableIds = items.filter((i) => selected.has(i.id) && !i.parent_id).map((i) => i.id);

  // The keyboard cursor: j and k move over the rows, x completes, e edits, d deletes (list view only).
  const [cursorId, setCursorId] = useState<number | null>(null);
  const cursorRow = cursorId !== null ? items.find((i) => i.id === cursorId) : undefined;
  // The row keys (j k x e d i) only act on rows that are drawn: not in the board or calendar view, and not while selecting.
  const rowKeysActive = view === "list" && !selectMode;
  // Spoken when the cursor moves, because the ring around the row is only visual.
  const cursorPosition = cursorRow && rowKeysActive ? visibleOrder.indexOf(cursorRow.id) + 1 : 0;
  const cursorAnnouncement = cursorPosition > 0 ? `${cursorRow?.name}, task ${cursorPosition} of ${visibleOrder.length}${cursorRow?.completed ? ", done" : ""}` : "";
  const moveCursor = (direction: 1 | -1) => {
    if (!rowKeysActive) return;
    const next = stepCursor(visibleOrder, cursorId, direction);
    setCursorId(next);
    if (next !== null) requestAnimationFrame(() => document.querySelector(`[data-task-id="${next}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  useHotkeys({
    j: () => moveCursor(1),
    k: () => moveCursor(-1),
    x: () => { if (editable && rowKeysActive && cursorRow) onToggleItem(cursorRow.id); },
    i: () => { if (rowKeysActive && cursorRow) setDetailId(cursorRow.id); },
    e: (e) => { if (editable && rowKeysActive && cursorRow) { e.preventDefault(); onEditItem(cursorRow.id); } },
    d: () => { if (editable && rowKeysActive && cursorRow && cursorRow.can_delete !== false) onDeleteItem(cursorRow.id); },
    n: (e) => { if (!editable) return; e.preventDefault(); onAddItem(); },
    "/": (e) => { if (!editable) return; e.preventDefault(); quickAddRef.current?.focus(); },
    s: () => { if (!editable) return; if (selectMode) leaveSelectMode(); else setSelectMode(true); },
    "1": () => { if (items.length > 0) setView("list"); },
    "2": () => { if (items.length > 0) setView("board"); },
    "3": () => { if (items.length > 0) setView("calendar"); },
    A: () => { if (editable && selectMode) setSelected(new Set(visibleOrder)); },
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
    void reorderAll(flat);
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
        onOpenDetails={setDetailId}
        readOnly={!editable}
        focused={view === "list" && cursorId === item.id}
        onAddSubtask={(id) => onAddItem(id)}
        onMove={reorderable ? (id, dir) => move(id, dir, siblings) : undefined}
        canMoveUp={index > 0}
        canMoveDown={index < siblings.length - 1}
        drag={
          isSubtask || !editable || !reorderable
            ? undefined
            : { draggable: !selectMode, isDragOver: drag.dragOverItemId === item.id, isDragging: drag.draggedItemId === item.id, ...drag.handlers }
        }
      />
    );
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
      <div className="mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-foreground-muted hover:text-foreground mb-4 text-sm group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" /> Back to Quests
        </button>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-heading font-bold">{list.name}</h1>
              {list.priority && <span className={cn("text-xs px-2 py-1 rounded-full font-medium", PRIORITY_BADGE[list.priority])}>{list.priority}</span>}
              {!editable && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium border border-border text-foreground-muted">
                  <Eye className="h-3 w-3" aria-hidden /> View only
                </span>
              )}
            </div>
            {list.description && <p className="text-foreground-muted mt-1 text-sm sm:text-base">{list.description}</p>}
            <div className="flex gap-4 mt-2 text-sm text-foreground-muted flex-wrap">
              {list.category && <span className="flex items-center gap-1">{CATEGORIES.find((c) => c.value === list.category)?.emoji} {list.category}</span>}
              {list.shared && !list.isOwner && <span>{roleLabel(role)} · shared by {list.ownerName ?? "another adventurer"}</span>}
              {list.deadline && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Due: {formatDeadline(list.deadline)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <SummarizeButton body={{ mode: "list", listId: list.id }} title={`Summary: ${list.name}`} />
            <Button variant="outline" size="sm" onClick={onOpenMembers} className="gap-1" title={list.shared ? `Shared with ${peopleLabel(list.memberCount)}` : "Invite people to this quest"}>
              <Users className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Members</span>
              {list.shared && <span className="rounded-full bg-primary/15 px-1.5 text-xs font-semibold text-primary-text"><span aria-hidden>👥 {list.memberCount}</span><span className="sr-only">{`, ${list.memberCount ?? 2} people`}</span></span>}
            </Button>
            {editable && (
              <Button variant="outline" size="sm" onClick={() => onAddItem()} className="gap-1">
                <Plus className="h-4 w-4" /> Add Task
              </Button>
            )}
            {editable && <Button variant={selectMode ? "default" : "outline"} size="sm" onClick={() => (selectMode ? leaveSelectMode() : setSelectMode(true))} className="gap-1" aria-pressed={selectMode} title="Select tasks (s)">
              <CheckSquare className="h-4 w-4" /><span className="hidden sm:inline">Select</span>
            </Button>}
            {editable && (
              <Button variant="outline" size="sm" onClick={onSaveTemplate} className="gap-1" title="Save this quest's tasks as a template">
                <FilePlus className="h-4 w-4" /><span className="hidden sm:inline">Template</span>
              </Button>
            )}
            {manageable && (
              <Button variant="outline" size="sm" onClick={onEditList} className="gap-1" aria-label="Edit quest">
                <Pencil className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Edit</span>
              </Button>
            )}
            {deletable && (
              <Button variant="outline" size="sm" className="text-destructive-text hover:bg-destructive/10" onClick={onDeleteList} aria-label="Delete quest">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mb-6 p-4 rounded-xl bg-linear-to-br from-card to-card/50 border border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />
        <div className="relative">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-foreground-muted">Quest Progress</span>
            <span className="font-medium font-heading">{completed}/{topLevel.length} Tasks</span>
          </div>
          <div className="h-3 rounded-full bg-background-secondary overflow-hidden" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Quest progress">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={cn("h-full rounded-full", progress === 100 ? "bg-linear-to-r from-success to-emerald-400" : "bg-linear-to-r from-primary to-violet-500")}
            />
          </div>
          {progress === 100 && <p className="text-xs text-success mt-2 font-medium">🎉 Quest Complete!</p>}
        </div>
      </div>

      {editable && <QuickAddBar ref={quickAddRef} pending={quickAddPending} aiEnabled={aiEnabled} onAdd={onQuickAdd} />}

      {items.length > 0 && (
        <div role="group" aria-label="How to show the tasks" className="mb-4 inline-flex rounded-lg border border-border bg-card p-0.5">
          {TASK_VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              onClick={() => setView(v.value)}
              className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring", view === v.value ? "bg-primary text-primary-foreground" : "text-foreground-muted hover:text-foreground")}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <TaskFilterBar
          filter={filter}
          onFilter={(next) => updatePrefs({ filter: next })}
          tags={questTags}
          showAssignee={Boolean(list.shared) || items.some((i) => i.assignee)}
          groupBy={view === "list" ? groupBy : undefined}
          onGroupBy={(next) => updatePrefs({ groupBy: next })}
          shown={shownItems.length}
          total={items.length}
        />
      )}

      {items.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
          <Scroll className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>{editable ? "No tasks yet. Type one above or press Add Task." : "No tasks yet."}</p>
          {editable && (
            <p className="mt-2 text-sm">
              Quick add understands dates, priority and tags: try <code className="rounded bg-background-secondary px-1.5 py-0.5 text-xs">Finish report fri !high #work</code>
            </p>
          )}
        </div>
      ) : shownItems.length === 0 ? (
        <div className="text-center py-12 text-foreground-muted">
          <p>No tasks match these filters.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => updatePrefs({ filter: DEFAULT_FILTER })}>Clear filters</Button>
        </div>
      ) : view === "board" ? (
        <TaskBoard items={shownItems} listPriority={list.priority} readOnly={!editable} onToggle={onToggleItem} onEdit={onEditItem} onSetPriority={onSetPriority} />
      ) : view === "calendar" ? (
        <TaskCalendar items={shownItems} readOnly={!editable} onToggle={onToggleItem} onEdit={onEditItem} />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-foreground-muted mb-3 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
            {!editable ? "View only: you can read this quest but not change it." : reorderable ? "Drag the grip (or use the arrows) to reorder. Shift-click selects a range." : "Clear the filters and grouping to reorder. Shift-click selects a range."}
          </p>
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label || undefined} className="space-y-2">
              {group.label && (
                <h3 className="flex items-center gap-2 pt-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                  {group.label} <span className="font-normal normal-case">({group.items.length})</span>
                </h3>
              )}
              {group.items.map((item) => (
                <div key={item.id} className="space-y-2">
                  {row(item, topLevel, false)}
                  {(shown.childrenOf.get(item.id) || []).map((child) => row(child, childrenOf.get(item.id) || [], true))}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {selectMode && editable && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 mt-4 flex lg:bottom-4 flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-card/95 p-3 shadow-lg backdrop-blur-sm" role="toolbar" aria-label="Bulk actions">
          <span className="text-sm font-medium mr-auto" aria-live="polite">{selectedIds.length} selected</span>
          <Button size="sm" variant="outline" className="gap-1" disabled={shownItems.every((i) => selected.has(i.id))} onClick={() => setSelected(new Set(shownItems.map((i) => i.id)))}>
            Select all
          </Button>
          <Button size="sm" className="gap-1" disabled={openIds.length === 0} onClick={async () => {
            try {
              await onBulkComplete(openIds);
            } catch {
              // The mutation hooks already showed the error.
            }
            leaveSelectMode();
          }}>
            <CheckCheck className="h-4 w-4" /> Complete{openIds.length ? ` (${openIds.length})` : ""}
          </Button>
          <Button size="sm" variant="outline" className="gap-1" disabled={selectedIds.length === 0} onClick={() => setBulkEditOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden /> Edit{selectedIds.length ? ` (${selectedIds.length})` : ""}
          </Button>
          {onMove && moveTargets && moveTargets.length > 0 && (
            <select
              aria-label="Move selected tasks to another quest"
              title={movableIds.length < selectedIds.length ? "Subtasks move with their parent task" : undefined}
              disabled={movableIds.length === 0}
              value=""
              onChange={async (e) => {
                const listId = Number(e.target.value);
                if (!listId) return;
                try {
                  await onMove(movableIds, listId);
                } catch {
                  // The mutation hooks already showed the error.
                }
                leaveSelectMode();
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="">Move{movableIds.length ? ` (${movableIds.length})` : ""} to…</option>
              {moveTargets.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
          )}
          <Button size="sm" variant="destructive" className="gap-1" disabled={deletableIds.length === 0} title={deletableIds.length < selectedIds.length ? "Only tasks you added can be deleted by an editor" : undefined} onClick={() => { if (deletableIds.length > BULK_DELETE_CONFIRM_ABOVE) setConfirmBulk(deletableIds); else { onBulkDelete(deletableIds); leaveSelectMode(); } }}>
            <Trash2 className="h-4 w-4" /> Delete{deletableIds.length && deletableIds.length < selectedIds.length ? ` (${deletableIds.length})` : ""}
          </Button>
          <Button size="sm" variant="ghost" aria-label="Leave select mode" onClick={leaveSelectMode}><X className="h-4 w-4" /></Button>
        </div>
      )}

      <p className="mt-4 text-center text-xs text-foreground-muted">
        <button type="button" onClick={() => setShowHelp(true)} className="inline-flex items-center gap-1 hover:text-foreground">
          <Keyboard className="h-3.5 w-3.5" aria-hidden /> Keyboard shortcuts (?)
        </button>
      </p>
      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        count={selectedIds.length}
        pending={bulkEditing}
        onApply={async (values) => {
          setBulkEditing(true);
          try {
            await onBulkEdit(selectedIds, values);
            setBulkEditOpen(false);
            leaveSelectMode();
          } catch {
            // The mutation hooks already showed the error; keep the dialog open so the choice can be retried.
          } finally {
            setBulkEditing(false);
          }
        }}
      />
      <div role="status" aria-live="polite" className="sr-only">{cursorAnnouncement}</div>
      <ConfirmDeleteDialog
        open={confirmBulk !== null}
        onOpenChange={(open) => { if (!open) setConfirmBulk(null); }}
        title={`Delete ${confirmBulk?.length ?? 0} tasks?`}
        description="They are removed from this quest. You can undo for a few seconds afterwards."
        confirmLabel={`Delete ${confirmBulk?.length ?? 0} tasks`}
        onConfirm={() => { if (confirmBulk) onBulkDelete(confirmBulk); setConfirmBulk(null); leaveSelectMode(); }}
      />
      <ShortcutsDialog open={showHelp} onOpenChange={setShowHelp} />
      <TaskDetailSheet
        item={detailItem}
        subtasks={detailItem ? childrenOf.get(detailItem.id) || [] : []}
        readOnly={!editable}
        onOpenChange={(open) => { if (!open) setDetailId(null); }}
        onToggle={onToggleItem}
        onEdit={(id) => { setDetailId(null); onEditItem(id); }}
        onOpenSubtask={setDetailId}
        assignOptions={assignOptions}
        onAssign={onAssign}
        moveTargets={moveTargets}
        onMove={onMove ? (id, listId) => { setDetailId(null); void onMove([id], listId); } : undefined}
        showThread
      />

      {editable && <button onClick={() => onAddItem()} className="w-full mt-4 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 flex items-center justify-center gap-2 text-foreground-muted text-sm transition-all group">
        <Plus className="h-5 w-5 group-hover:scale-110 transition-transform" /> Add New Task
      </button>}
    </motion.div>
  );
};
