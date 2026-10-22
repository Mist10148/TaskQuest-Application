import { useEffect, useState } from "react";
import { AlarmClock, Calendar, Check, ListPlus, Pencil, Repeat, Timer, Trash2, UserRound } from "lucide-react";
import type { Item } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDeadline, formatDue, isPastDeadline } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { parseTags } from "@/lib/tags";
import { TaskThread } from "./TaskThread";

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
  /** People the task can be assigned to (a shared quest's owner and members); leave out on a quest nobody shares. */
  assignOptions?: ReadonlyArray<{ memberKey: string; name: string | null; isYou: boolean }>;
  /** May return the save's promise: the choice shows at once and goes back if the save fails. */
  onAssign?: (id: number, memberKey: string | null) => void | Promise<unknown>;
  /** Quests a top-level task can be moved to (with its subtasks). */
  moveTargets?: ReadonlyArray<{ id: number; name: string }>;
  onMove?: (id: number, listId: number) => void;
  /** Show the comments and activity (they load from the server). */
  showThread?: boolean;
  /** Delete (the caller offers Undo), push to tomorrow, or add a subtask under this task; each is left out when not given. */
  onDelete?: (id: number) => void;
  onSnooze?: (id: number) => void;
  onAddSubtask?: (id: number) => void;
}

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";
const personName = (p: { name: string | null; isYou: boolean }) => (p.isYou ? `${p.name ?? "You"} (you)` : p.name ?? "Unknown");

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{label}</dt>
    <dd className="mt-1 text-sm">{children}</dd>
  </div>
);

/** A side drawer with everything about one task, so it can be read without opening the edit form. */
export const TaskDetailSheet = ({ item, subtasks, readOnly, onOpenChange, onToggle, onEdit, onOpenSubtask, assignOptions, onAssign, moveTargets, onMove, showThread, onDelete, onSnooze, onAddSubtask }: Props) => {
  const completed = Boolean(item?.completed);
  const tags = parseTags(item?.tags);
  const overdue = item ? !completed && isPastDeadline(item.due_date) : false;
  const doneSubtasks = subtasks.filter((s) => s.completed).length;
  // The assignee just picked, shown until the task data catches up (or the save fails), so the menu does not snap back meanwhile.
  const [chosen, setChosen] = useState<{ id: number; key: string } | null>(null);
  const savedKey = item?.assignee?.memberKey ?? "";
  useEffect(() => {
    if (chosen && (chosen.id !== item?.id || chosen.key === savedKey)) setChosen(null);
  }, [chosen, item?.id, savedKey]);
  const shownKey = chosen && chosen.id === item?.id ? chosen.key : savedKey;

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
                    {formatDue(item.due_date) !== formatDeadline(item.due_date) && <span className="text-foreground-muted">· {formatDue(item.due_date)}</span>}
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
              {!readOnly && onAssign && assignOptions && assignOptions.length > 1 ? (
                <Field label="Assignee">
                  <select
                    aria-label="Assignee"
                    className={selectClass}
                    value={shownKey}
                    onChange={(e) => {
                      const key = e.target.value;
                      setChosen({ id: item.id, key });
                      void Promise.resolve(onAssign(item.id, key || null)).catch(() => setChosen(null));
                    }}
                  >
                    <option value="">Nobody</option>
                    {assignOptions.map((p) => (
                      <option key={p.memberKey} value={p.memberKey}>{personName(p)}</option>
                    ))}
                  </select>
                </Field>
              ) : (
                item.assignee && (
                  <Field label="Assignee">
                    <span className="inline-flex items-center gap-1"><UserRound className="h-4 w-4" aria-hidden /> {personName(item.assignee)}</span>
                  </Field>
                )
              )}
              <Field label="Added">{new Date(item.created_at).toLocaleDateString()}</Field>
              {!readOnly && onMove && !item.parent_id && moveTargets && moveTargets.length > 0 && (
                <Field label="Move to another quest">
                  <select
                    aria-label="Move to another quest"
                    className={selectClass}
                    value=""
                    onChange={(e) => { if (e.target.value) onMove(item.id, Number(e.target.value)); }}
                  >
                    <option value="">Choose a quest…</option>
                    {moveTargets.map((q) => (
                      <option key={q.id} value={q.id}>{q.name}</option>
                    ))}
                  </select>
                  {subtasks.length > 0 && <p className="mt-1 text-xs text-foreground-muted">Its {subtasks.length} subtask{subtasks.length === 1 ? "" : "s"} move with it.</p>}
                </Field>
              )}
            </dl>
            {!readOnly && (
              <>
                <SheetFooter className="mt-6 gap-2 sm:space-x-0">
                  <Button variant="outline" className="gap-1" onClick={() => onEdit(item.id)}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
                  <Button onClick={() => onToggle(item.id)}>{completed ? "Reopen" : "Mark done"}</Button>
                </SheetFooter>
                <div className="mt-2 flex flex-wrap justify-end gap-1">
                  {onSnooze && !completed && (
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => onSnooze(item.id)}><AlarmClock className="h-4 w-4" aria-hidden /> Snooze to tomorrow</Button>
                  )}
                  {onAddSubtask && !item.parent_id && (
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => onAddSubtask(item.id)}><ListPlus className="h-4 w-4" aria-hidden /> Add subtask</Button>
                  )}
                  {onDelete && item.can_delete !== false && (
                    <Button variant="ghost" size="sm" className="gap-1 text-destructive-text" onClick={() => onDelete(item.id)}><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>
                  )}
                </div>
              </>
            )}
            {/* Keyed by task: a half-written comment must not carry over to the subtask opened from this drawer. */}
            {showThread && <TaskThread key={item.id} itemId={item.id} canComment={!readOnly} />}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
