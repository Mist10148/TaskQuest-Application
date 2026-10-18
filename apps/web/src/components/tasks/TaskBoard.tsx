import { Check, Circle } from "lucide-react";
import type { Item, Priority } from "@/lib/api";
import { boardColumns } from "@/lib/taskViews";
import { cn } from "@/lib/utils";
import { formatDeadline } from "@/lib/dates";

interface Props {
  items: readonly Item[];
  listPriority?: Priority | null;
  readOnly?: boolean;
  onToggle: (itemId: number) => void;
  onEdit: (itemId: number) => void;
}

const HEADER: Record<string, string> = {
  HIGH: "border-red-500/40 text-red-700 dark:text-red-400",
  MEDIUM: "border-yellow-500/40 text-yellow-700 dark:text-yellow-400",
  LOW: "border-blue-500/40 text-blue-700 dark:text-blue-400",
  NONE: "border-border text-foreground-muted",
};

/** A quest as columns by priority: open tasks first, finished ones faded below. Click the circle to complete, the name to edit. */
export const TaskBoard = ({ items, listPriority, readOnly, onToggle, onEdit }: Props) => {
  const columns = boardColumns(items, listPriority);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="task-board">
      {columns.map((col) => (
        <section key={col.key} aria-label={col.key === "NONE" ? col.label : `${col.label} priority`} className="rounded-xl border border-border bg-card/60 p-3">
          <h3 className={cn("mb-2 flex items-center justify-between border-b pb-1 text-sm font-heading font-semibold", HEADER[col.key])}>
            {col.label}
            <span className="text-xs font-normal text-foreground-muted">{col.open.length} open</span>
          </h3>
          {col.open.length + col.done.length === 0 ? (
            <p className="py-3 text-center text-xs text-foreground-muted">Nothing here</p>
          ) : (
            <ul className="space-y-2">
              {[...col.open, ...col.done].map((item) => (
                <li key={item.id} className={cn("flex items-start gap-2 rounded-lg border border-border bg-background p-2", item.completed && "opacity-60")}>
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
                    <span className={cn("block truncate font-medium", item.completed && "line-through")}>{item.name}</span>
                    {item.due_date && <span className="block text-xs text-foreground-muted">{formatDeadline(item.due_date)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
};
