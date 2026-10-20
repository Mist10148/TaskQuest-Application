import { useState, type DragEvent } from "react";
import { Check, Circle } from "lucide-react";
import type { Item, Priority } from "@/lib/api";
import { boardColumns, canMoveToColumn, columnPriority, effectivePriority, type BoardColumn } from "@/lib/taskViews";
import { cn } from "@/lib/utils";
import { formatDeadline } from "@/lib/dates";

interface Props {
  items: readonly Item[];
  listPriority?: Priority | null;
  readOnly?: boolean;
  onToggle: (itemId: number) => void;
  onEdit: (itemId: number) => void;
  /** Moving a card to another column sets the task's priority. Without it the board is view-only. */
  onSetPriority?: (itemId: number, priority: Priority | null) => void;
}

const HEADER: Record<string, string> = {
  HIGH: "border-red-500/40 text-red-700 dark:text-red-400",
  MEDIUM: "border-yellow-500/40 text-yellow-700 dark:text-yellow-400",
  LOW: "border-blue-500/40 text-blue-700 dark:text-blue-400",
  NONE: "border-border text-foreground-muted",
};

const DRAG_TYPE = "application/x-taskquest-item";

/**
 * A quest as columns by priority: open tasks first, finished ones faded below. Click the circle to complete, the name to
 * edit. Drag an open card to another column (or use its priority menu, which also works by keyboard and touch) to
 * change its priority.
 */
export const TaskBoard = ({ items, listPriority, readOnly, onToggle, onEdit, onSetPriority }: Props) => {
  const columns = boardColumns(items, listPriority);
  const movable = !readOnly && Boolean(onSetPriority);
  const [dragging, setDragging] = useState<Item | null>(null);
  const [over, setOver] = useState<BoardColumn["key"] | null>(null);

  const columnOf = (item: Item): BoardColumn["key"] => effectivePriority(item, listPriority) ?? "NONE";
  const accepts = (key: BoardColumn["key"]) => dragging !== null && canMoveToColumn(key, listPriority) && columnOf(dragging) !== key;

  const move = (item: Item, key: BoardColumn["key"]) => {
    if (columnOf(item) === key || !canMoveToColumn(key, listPriority)) return;
    onSetPriority?.(item.id, columnPriority(key));
  };

  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };

  const drop = (e: DragEvent, key: BoardColumn["key"]) => {
    e.preventDefault();
    const item = dragging;
    endDrag();
    if (item) move(item, key);
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="task-board">
      {columns.map((col) => (
        <section
          key={col.key}
          aria-label={col.key === "NONE" ? col.label : `${col.label} priority`}
          onDragOver={(e) => {
            if (!accepts(col.key)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setOver(col.key);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((k) => (k === col.key ? null : k));
          }}
          onDrop={(e) => drop(e, col.key)}
          className={cn("rounded-xl border border-border bg-card/60 p-3 transition-colors", over === col.key && "border-primary bg-primary/10")}
        >
          <h3 className={cn("mb-2 flex items-center justify-between border-b pb-1 text-sm font-heading font-semibold", HEADER[col.key])}>
            {col.label}
            <span className="text-xs font-normal text-foreground-muted">{col.open.length} open</span>
          </h3>
          {col.open.length + col.done.length === 0 ? (
            <p className="py-3 text-center text-xs text-foreground-muted">{accepts(col.key) ? "Drop here" : "Nothing here"}</p>
          ) : (
            <ul className="space-y-2">
              {[...col.open, ...col.done].map((item) => {
                const canDrag = movable && !item.completed;
                return (
                  <li
                    key={item.id}
                    draggable={canDrag}
                    onDragStart={
                      canDrag
                        ? (e) => {
                            e.dataTransfer.setData(DRAG_TYPE, String(item.id));
                            e.dataTransfer.effectAllowed = "move";
                            setDragging(item);
                          }
                        : undefined
                    }
                    onDragEnd={endDrag}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border border-border bg-background p-2",
                      item.completed && "opacity-60",
                      canDrag && "cursor-grab active:cursor-grabbing",
                      dragging?.id === item.id && "opacity-40"
                    )}
                  >
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() => onToggle(item.id)}
                      aria-label={item.completed ? `Mark "${item.name}" not done` : `Mark "${item.name}" done`}
                      className="-m-2 mt-[-0.375rem] shrink-0 p-2 text-foreground-muted hover:text-success focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-full disabled:cursor-default disabled:hover:text-foreground-muted"
                    >
                      {item.completed ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Circle className="h-4 w-4" aria-hidden />}
                    </button>
                    <button type="button" onClick={() => onEdit(item.id)} disabled={readOnly} className="min-w-0 flex-1 text-left text-sm disabled:cursor-default">
                      <span className={cn("line-clamp-2 break-words font-medium", item.completed && "line-through")}>{item.name}</span>
                      {item.due_date && <span className="block text-xs text-foreground-muted">{formatDeadline(item.due_date)}</span>}
                    </button>
                    {canDrag && (
                      <select
                        aria-label={`Priority of "${item.name}"`}
                        value={col.key}
                        onChange={(e) => move(item, e.target.value as BoardColumn["key"])}
                        className="h-7 max-w-22 shrink-0 rounded-md border border-input bg-background px-1 text-xs text-foreground-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {columns.map((c) => (
                          <option key={c.key} value={c.key} disabled={!canMoveToColumn(c.key, listPriority)}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
};
