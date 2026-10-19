import { Calendar, Check, Pencil, Repeat, Timer } from "lucide-react";
import type { Item } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDeadline, isPastDeadline } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { parseTags } from "@/lib/tags";

interface Props {
  /** The task to show; null keeps the drawer closed. */
  item: Item | null;
  subtasks: Item[];
  /** A viewer of a shared quest cannot complete or edit. */
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (id: number) => void;
  onEdit: (id: number) => void;
  onOpenSubtask: (id: number) => void;
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{label}</dt>
    <dd className="mt-1 text-sm">{children}</dd>
  </div>
);

/** A side drawer with everything about one task, so it can be read without opening the edit form. */
export const TaskDetailSheet = ({ item, subtasks, readOnly, onOpenChange, onToggle, onEdit, onOpenSubtask }: Props) => {
  const completed = Boolean(item?.completed);
  const tags = parseTags(item?.tags);
  const overdue = item ? !completed && isPastDeadline(item.due_date) : false;
  const doneSubtasks = subtasks.filter((s) => s.completed).length;

  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle className={cn("pr-6 wrap-break-word", completed && "line-through text-foreground-muted")}>{item.name}</SheetTitle>
              <SheetDescription>{completed ? (item.completed_by_name ? `Done by ${item.completed_by_name}` : "Done") : "Not done yet"}</SheetDescription>
            </SheetHeader>
            <dl className="mt-6 space-y-4">
              {item.description && <Field label="Description"><p className="whitespace-pre-wrap wrap-break-word">{item.description}</p></Field>}
              {item.priority && <Field label="Priority">{item.priority.charAt(0) + item.priority.slice(1).toLowerCase()}</Field>}
              {item.due_date && (
                <Field label="Due">
                  <span className={cn("inline-flex items-center gap-1", overdue && "text-destructive-text")}>
                    <Calendar className="h-4 w-4" aria-hidden /> {overdue && <span className="sr-only">Overdue: </span>}{formatDeadline(item.due_date)}
                  </span>
                </Field>
              )}
              {item.recurrence && <Field label="Repeats"><span className="inline-flex items-center gap-1"><Repeat className="h-4 w-4" aria-hidden /> {item.recurrence}</span></Field>}
              {item.estimate_minutes ? <Field label="Estimate"><span className="inline-flex items-center gap-1"><Timer className="h-4 w-4" aria-hidden /> {item.estimate_minutes} min</span></Field> : null}
              {tags.length > 0 && (
                <Field label="Tags">
                  <span className="flex flex-wrap gap-1.5">{tags.map((t) => <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-text">#{t}</span>)}</span>
                </Field>
              )}
              {subtasks.length > 0 && (
                <Field label={`Subtasks (${doneSubtasks}/${subtasks.length})`}>
                  <ul className="space-y-1">
                    {subtasks.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => onOpenSubtask(s.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-background-secondary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                          <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", s.completed ? "border-success bg-success" : "border-border")} aria-hidden>
                            {s.completed ? <Check className="h-3 w-3 text-white" /> : null}
                          </span>
                          <span className={cn("wrap-break-word", s.completed && "line-through text-foreground-muted")}>{s.name}</span>
                          <span className="sr-only">{s.completed ? "(done)" : "(not done)"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
              <Field label="Added">{new Date(item.created_at).toLocaleDateString()}</Field>
            </dl>
            {!readOnly && (
              <SheetFooter className="mt-6 gap-2 sm:space-x-0">
                <Button variant="outline" className="gap-1" onClick={() => onEdit(item.id)}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
                <Button onClick={() => onToggle(item.id)}>{completed ? "Reopen" : "Mark done"}</Button>
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
