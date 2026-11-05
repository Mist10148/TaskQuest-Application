import { Link } from "react-router-dom";
import { CalendarCheck, CalendarDays } from "lucide-react";
import type { TodayData } from "@/lib/api";
import { formatDeadline, formatDue } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** How many of Today's tasks the dashboard lists before pointing to the Today page. */
export const DUE_TODAY_SHOWN = 5;

/** The first few tasks from Today (overdue, due today, HIGH priority) on the dashboard, each linking to its quest. */
export const DueTodayCard = ({ data }: { data: TodayData }) => {
  const shown = data.tasks.slice(0, DUE_TODAY_SHOWN);
  const more = data.tasks.length - shown.length;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="due-today-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="due-today-title" className="flex items-center gap-2 font-heading font-semibold">
          <CalendarDays className="h-5 w-5 text-primary-text" aria-hidden /> Needs doing today
        </h2>
        <Link to="/today" className="text-xs font-medium text-primary-text hover:underline underline-offset-2 sm:text-sm">
          Open Today
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-foreground-muted">
          <CalendarCheck className="h-4 w-4 text-success" aria-hidden /> Nothing is due or overdue. Enjoy the calm.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((task) => (
            <li key={task.id} className="flex items-baseline justify-between gap-3 text-sm">
              <Link to={`/tasks?list=${task.listId}&task=${task.id}`} className="min-w-0 truncate font-medium hover:text-primary-text hover:underline underline-offset-2">
                {task.name}
              </Link>
              {task.dueDate && (
                <span className={cn("shrink-0 text-xs", task.overdueDays > 0 ? "text-destructive-text" : "text-foreground-muted")} title={formatDeadline(task.dueDate)}>
                  {task.overdueDays > 0 && <span className="sr-only">Overdue: </span>}
                  {formatDue(task.dueDate, data.day)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="mt-2 text-xs text-foreground-muted">
          <Link to="/today" className="hover:text-primary-text hover:underline underline-offset-2">and {more} more on Today</Link>
        </p>
      )}
    </section>
  );
};
