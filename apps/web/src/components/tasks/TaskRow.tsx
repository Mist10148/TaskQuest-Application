import { ArrowDown, ArrowUp, Calendar, Check, CornerDownRight, GripVertical, Info, ListPlus, MessageSquare, Pencil, Repeat, Timer, Trash2, UserRound } from "lucide-react";
import type { Item, Priority } from "@/lib/api";
import { formatDeadline, formatDue, isPastDeadline } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";
import { swipeAction, swipeOffset } from "@/lib/swipe";
import { parseTags } from "@/lib/tags";

const DOT: Record<string, string> = { HIGH: "bg-red-500", MEDIUM: "bg-yellow-500", LOW: "bg-blue-500" };

export interface DragProps {
  draggable: boolean;
  isDragOver: boolean;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, id: number) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, id: number) => void;
}

interface Props {
  item: Item;
  /** Used for the priority dot when the task has no priority of its own. */
  listPriority?: Priority | null;
  isSubtask?: boolean;
  selectMode: boolean;
  selected: boolean;
  /** `range` is true for a Shift-click, which selects everything since the last click. */
  onSelect: (id: number, range: boolean) => void;
  onToggle: (id: number) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  /** Opens the detail drawer (also for a viewer, who has no other row actions). */
  onOpenDetails?: (id: number) => void;
  onAddSubtask?: (id: number) => void;
  onMove?: (id: number, direction: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  drag?: DragProps;
  /** A viewer of a shared quest: the checkbox is disabled and the row has no actions. */
  readOnly?: boolean;
  /** The keyboard cursor (j / k) is on this row. */
  focused?: boolean;
}

const iconButton = "p-2.5 sm:p-1.5 rounded-md text-foreground-muted transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 disabled:pointer-events-none";

/** One task (or subtask): checkbox, details, and the row actions. */
export const TaskRow = ({ item, listPriority, isSubtask, selectMode, selected, onSelect, onToggle, onEdit, onDelete, onOpenDetails, onAddSubtask, onMove, canMoveUp, canMoveDown, drag, readOnly, focused }: Props) => {
  const completed = Boolean(item.completed);
  const priority = item.priority || listPriority || null;
  const tags = parseTags(item.tags);
  const overdue = !completed && isPastDeadline(item.due_date);

  // Touch: swipe a task to the right to complete it (the checkbox and the keyboard still work as before).
  const swipeable = !readOnly && !completed && !selectMode;
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const onTouchStart = (e: React.TouchEvent) => {
    if (swipeable) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touch.current) return;
    setOffset(swipeOffset(e.touches[0].clientX - touch.current.x, e.touches[0].clientY - touch.current.y));
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    setOffset(0);
    if (!start) return;
    const end = e.changedTouches[0];
    if (swipeAction(end.clientX - start.x, end.clientY - start.y) === "complete") onToggle(item.id);
  };

  return (
    <div
      data-task-row
      data-task-id={item.id}
      onTouchStart={swipeable ? onTouchStart : undefined}
      onTouchMove={swipeable ? onTouchMove : undefined}
      onTouchEnd={swipeable ? onTouchEnd : undefined}
      onTouchCancel={swipeable ? () => { touch.current = null; setOffset(0); } : undefined}
      style={offset ? { transform: `translateX(${offset}px)` } : undefined}
      onDragOver={drag ? (e) => drag.onDragOver(e, item.id) : undefined}
      onDragLeave={drag?.onDragLeave}
      onDrop={drag ? (e) => drag.onDrop(e, item.id) : undefined}
      className={cn(
        "group flex items-start gap-2 sm:gap-3 rounded-lg border bg-card p-3 sm:p-4 transition-all duration-200 focus-within:border-primary/50",
        isSubtask && "ml-6 sm:ml-10 p-2.5 sm:p-3",
        completed && "bg-card/60",
        focused && "ring-2 ring-primary/70",
        selected && "border-primary bg-primary/5",
        drag?.isDragOver ? "border-primary bg-primary/10" : !selected && "border-border hover:border-primary/30",
        drag?.isDragging && "opacity-50 scale-[0.98]"
      )}
    >
      {isSubtask ? (
        <CornerDownRight className="h-4 w-4 mt-1 shrink-0 text-foreground-muted/60" aria-hidden />
      ) : (
        drag?.draggable && (
          // Only the handle drags, so the task text stays selectable. Keyboard and touch users reorder with the arrow buttons.
          <span
            draggable
            onDragStart={(e) => drag.onDragStart(e, item.id)}
            onDragEnd={drag.onDragEnd}
            className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-foreground-muted hover:bg-background-secondary hover:text-foreground active:cursor-grabbing"
            title="Drag to reorder"
            aria-hidden
          >
            <GripVertical className="h-5 w-5" />
          </span>
        )
      )}

      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => undefined}
          onClick={(e) => onSelect(item.id, e.shiftKey)}
          aria-label={`Select ${item.name}`}
          className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
        />
      )}

      <button
        type="button"
        onClick={() => onToggle(item.id)}
        disabled={readOnly}
        aria-pressed={completed}
        aria-label={`Mark "${item.name}" as done`}
        className={cn(
          // The ::after widens the hit area to 28px (WCAG 2.5.8) without growing the box.
          "relative after:absolute after:-inset-1 shrink-0 mt-0.5 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          completed ? "bg-success border-success" : "border-border hover:border-primary",
          readOnly && "cursor-not-allowed opacity-60 hover:border-border"
        )}
      >
        {completed && <Check className="h-3 w-3 text-white" />}
      </button>

      <div className="flex-1 min-w-0">
        <p className={cn("font-medium text-sm sm:text-base wrap-break-word", completed && "line-through text-foreground-muted")}>
          {priority && (
            <>
              <span className={cn("inline-block h-2 w-2 rounded-full mr-2 align-middle", DOT[priority], completed && "opacity-40")} aria-hidden />
              <span className="sr-only">{priority.toLowerCase()} priority: </span>
            </>
          )}
          {item.name}
        </p>
        {item.description && <p className="text-xs sm:text-sm mt-1 line-clamp-2 text-foreground-muted">{item.description}</p>}
        {completed && item.completed_by_name && <p className="mt-1 text-xs text-foreground-muted">Done by {item.completed_by_name}</p>}
        {(item.due_date || item.recurrence || item.estimate_minutes || tags.length > 0 || item.assignee || (item.comment_count ?? 0) > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs">
            {item.due_date && (
              <span title={formatDeadline(item.due_date)} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 border", overdue ? "border-destructive/40 text-destructive-text" : "border-border text-foreground-muted")}>
                <Calendar className="h-3 w-3" aria-hidden /> {overdue && <span className="sr-only">Overdue: </span>}
                {formatDue(item.due_date)}
              </span>
            )}
            {item.recurrence && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border border-border text-foreground-muted">
                <Repeat className="h-3 w-3" aria-hidden /> {item.recurrence}
              </span>
            )}
            {item.estimate_minutes ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border border-border text-foreground-muted">
                <Timer className="h-3 w-3" aria-hidden /> {item.estimate_minutes} min
              </span>
            ) : null}
            {tags.map((t) => (
              <span key={t} className="rounded-full px-2 py-0.5 bg-primary/10 text-primary-text">#{t}</span>
            ))}
            {item.assignee && (
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 border", item.assignee.isYou ? "border-primary/40 text-primary-text" : "border-border text-foreground-muted")}>
                <UserRound className="h-3 w-3" aria-hidden /> <span className="sr-only">Assigned to </span>{item.assignee.isYou ? "You" : item.assignee.name ?? "Someone"}
              </span>
            )}
            {(item.comment_count ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border border-border text-foreground-muted">
                <MessageSquare className="h-3 w-3" aria-hidden /> {item.comment_count}<span className="sr-only"> {item.comment_count === 1 ? "comment" : "comments"}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {onOpenDetails && (
        <button type="button" aria-label={`Details of "${item.name}"`} onClick={() => onOpenDetails(item.id)} className={cn(iconButton, "shrink-0 hover:bg-background-secondary hover:text-primary-text")}>
          <Info className="h-3.5 w-3.5" />
        </button>
      )}

      {!readOnly && <div className="shrink-0 flex items-center gap-0.5 sm:gap-1 [@media(hover:hover)]:sm:opacity-0 [@media(hover:hover)]:sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {onMove && (
          <>
            <button type="button" aria-label={`Move "${item.name}" up`} disabled={!canMoveUp} onClick={() => onMove(item.id, -1)} className={cn(iconButton, "hover:bg-background-secondary hover:text-foreground")}>
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" aria-label={`Move "${item.name}" down`} disabled={!canMoveDown} onClick={() => onMove(item.id, 1)} className={cn(iconButton, "hover:bg-background-secondary hover:text-foreground")}>
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {onAddSubtask && !isSubtask && (
          <button type="button" aria-label={`Add a subtask to "${item.name}"`} onClick={() => onAddSubtask(item.id)} className={cn(iconButton, "hover:bg-background-secondary hover:text-primary-text")}>
            <ListPlus className="h-3.5 w-3.5" />
          </button>
        )}
        <button type="button" aria-label={`Edit "${item.name}"`} onClick={() => onEdit(item.id)} className={cn(iconButton, "hover:bg-background-secondary hover:text-primary-text")}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {item.can_delete !== false && (
          <button type="button" aria-label={`Delete "${item.name}"`} onClick={() => onDelete(item.id)} className={cn(iconButton, "hover:bg-destructive/20 hover:text-destructive-text")}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>}
    </div>
  );
};
