import { ArrowDown, ArrowUp, Calendar, Check, CornerDownRight, GripVertical, ListPlus, Pencil, Repeat, Trash2 } from "lucide-react";
import type { Item, Priority } from "@/lib/api";
import { formatDeadline, isPastDeadline } from "@/lib/dates";
import { cn } from "@/lib/utils";

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
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onAddSubtask?: (id: number) => void;
  onMove?: (id: number, direction: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  drag?: DragProps;
}

const iconButton = "p-1.5 rounded-md text-foreground-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 disabled:pointer-events-none";

/** One task (or subtask): checkbox, details, and the row actions. */
export const TaskRow = ({ item, listPriority, isSubtask, selectMode, selected, onSelect, onToggle, onEdit, onDelete, onAddSubtask, onMove, canMoveUp, canMoveDown, drag }: Props) => {
  const completed = Boolean(item.completed);
  const priority = item.priority || listPriority || null;
  const tags = item.tags ? item.tags.split(",").filter(Boolean) : [];
  const overdue = !completed && isPastDeadline(item.due_date);

  return (
    <div
      draggable={drag?.draggable}
      onDragStart={drag ? (e) => drag.onDragStart(e, item.id) : undefined}
      onDragEnd={drag?.onDragEnd}
      onDragOver={drag ? (e) => drag.onDragOver(e, item.id) : undefined}
      onDragLeave={drag?.onDragLeave}
      onDrop={drag ? (e) => drag.onDrop(e, item.id) : undefined}
      className={cn(
        "group flex items-start gap-2 sm:gap-3 rounded-lg border bg-card p-3 sm:p-4 transition-all duration-200 focus-within:border-primary/50",
        isSubtask && "ml-6 sm:ml-10 p-2.5 sm:p-3",
        completed && "opacity-60",
        selected && "border-primary bg-primary/5",
        drag?.draggable && "cursor-grab active:cursor-grabbing",
        drag?.isDragOver ? "border-primary bg-primary/10" : !selected && "border-border hover:border-primary/30",
        drag?.isDragging && "opacity-50 scale-[0.98]"
      )}
    >
      {isSubtask ? (
        <CornerDownRight className="h-4 w-4 mt-1 flex-shrink-0 text-foreground-muted/60" aria-hidden />
      ) : (
        drag?.draggable && <GripVertical className="h-5 w-5 mt-0.5 flex-shrink-0 text-foreground-muted/50 hidden sm:block" aria-hidden />
      )}

      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(item.id)}
          aria-label={`Select ${item.name}`}
          className="mt-1 h-4 w-4 flex-shrink-0 accent-[hsl(var(--primary))]"
        />
      )}

      <button
        type="button"
        onClick={() => onToggle(item.id)}
        aria-pressed={completed}
        aria-label={completed ? `Mark "${item.name}" as not done` : `Mark "${item.name}" as done`}
        className={cn(
          "flex-shrink-0 mt-0.5 h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          completed ? "bg-success border-success" : "border-border hover:border-primary"
        )}
      >
        {completed && <Check className="h-3 w-3 text-white" />}
      </button>

      <div className="flex-1 min-w-0">
        <p className={cn("font-medium text-sm sm:text-base break-words", completed && "line-through text-foreground-muted")}>{item.name}</p>
        {item.description && <p className="text-xs sm:text-sm mt-1 line-clamp-2 text-foreground-muted">{item.description}</p>}
        {(item.due_date || item.recurrence || tags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs">
            {item.due_date && (
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 border", overdue ? "border-destructive/40 text-destructive" : "border-border text-foreground-muted")}>
                <Calendar className="h-3 w-3" aria-hidden /> {overdue && <span className="sr-only">Overdue: </span>}
                {formatDeadline(item.due_date)}
              </span>
            )}
            {item.recurrence && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border border-border text-foreground-muted">
                <Repeat className="h-3 w-3" aria-hidden /> {item.recurrence}
              </span>
            )}
            {tags.map((t) => (
              <span key={t} className="rounded-full px-2 py-0.5 bg-primary/10 text-primary">#{t}</span>
            ))}
          </div>
        )}
      </div>

      {priority && (
        <>
          <span className={cn("flex-shrink-0 h-2 w-2 rounded-full mt-2", DOT[priority])} aria-hidden />
          <span className="sr-only">{priority.toLowerCase()} priority</span>
        </>
      )}

      <div className="flex-shrink-0 flex items-center gap-0.5 sm:gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
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
          <button type="button" aria-label={`Add a subtask to "${item.name}"`} onClick={() => onAddSubtask(item.id)} className={cn(iconButton, "hover:bg-background-secondary hover:text-primary")}>
            <ListPlus className="h-3.5 w-3.5" />
          </button>
        )}
        <button type="button" aria-label={`Edit "${item.name}"`} onClick={() => onEdit(item.id)} className={cn(iconButton, "hover:bg-background-secondary hover:text-primary")}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label={`Delete "${item.name}"`} onClick={() => onDelete(item.id)} className={cn(iconButton, "hover:bg-destructive/20 hover:text-destructive")}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
