import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlarmClock, CalendarCheck, CalendarClock, CheckCircle2, Flame, Gift, Hourglass, Loader2, PenLine, Target, Timer } from "lucide-react";
import { useIsMutating } from "@tanstack/react-query";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { QueryState } from "@/components/feedback/QueryState";
import { PriorityPanel } from "@/components/ai/PriorityPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TOGGLE_ITEM_KEY, useClaimGoal, useSetGoal, useToday, useToggleItem, useUpdateItem, useWriteReflection } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import { formatDeadline, formatDue } from "@/lib/dates";
import { todayHeadline, goalPercent } from "@/lib/today";
import { StreakAtRisk } from "@/components/dashboard/StreakAtRisk";
import { addDays, localToday } from "@/lib/dates";
import { StreakStrip } from "@/components/dashboard/StreakStrip";
import type { TodayData, TodayTask } from "@/lib/api";

const PRIORITY_DOT: Record<string, string> = { HIGH: "bg-destructive", MEDIUM: "bg-xp", LOW: "bg-success" };

const TaskLine = ({ task, today }: { task: TodayTask; today: string }) => {
  const toggle = useToggleItem();
  const update = useUpdateItem();
  // The same task can be listed twice (due now and coming up): either line's click marks both busy.
  const finishing =
    useIsMutating({
      mutationKey: TOGGLE_ITEM_KEY,
      predicate: (m) => {
        const v = m.state.variables as number | { itemId: number } | undefined;
        return (typeof v === "number" ? v : v?.itemId) === task.id;
      },
    }) > 0;
  // Due today or late: push it to tomorrow without opening the quest.
  const canSnooze = Boolean(task.dueDate && task.dueDate <= today);
  const snooze = () =>
    update.mutate({ itemId: task.id, data: { due_date: addDays(localToday(), 1) } }, { onSuccess: () => toast.success(`Snoozed "${task.name}" to tomorrow`) });
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <button
        type="button"
        aria-label={`Mark "${task.name}" done`}
        disabled={finishing}
        onClick={() => toggle.mutate({ itemId: task.id, completed: true })}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-border transition-colors hover:border-success hover:bg-success/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {finishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5 text-transparent hover:text-success" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <Link to={`/tasks?list=${task.listId}&task=${task.id}`} className="line-clamp-2 break-words text-sm font-medium hover:text-primary-text hover:underline underline-offset-2 sm:text-base">{task.name}</Link>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground-muted">
          <span>{task.listName}</span>
          {task.dueDate && (
            <span className={cn(task.overdueDays > 0 && "text-destructive-text")} title={formatDeadline(task.dueDate)}>
              {task.overdueDays > 0 ? <span className="sr-only">Overdue: </span> : null}
              {formatDue(task.dueDate, today)}
            </span>
          )}
          {task.estimateMinutes ? (
            <span className="inline-flex items-center gap-0.5"><Timer className="h-3 w-3" aria-hidden /> {task.estimateMinutes} min</span>
          ) : null}
        </p>
      </div>
      <Button asChild variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs">
        <Link to={`/focus?task=${task.id}`} aria-label={`Focus on "${task.name}"`} title="Focus on this">
          <Hourglass className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Focus</span>
        </Link>
      </Button>
      {canSnooze && (
        <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2 text-xs" disabled={update.isPending} onClick={snooze} aria-label={`Snooze "${task.name}" to tomorrow`}>
          <AlarmClock className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Snooze</span>
        </Button>
      )}
      {task.priority && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} title={`${task.priority.toLowerCase()} priority`} role="img" aria-label={`${task.priority.toLowerCase()} priority`} />}
    </li>
  );
};

const ReflectionCard = ({ data }: { data: TodayData }) => {
  const write = useWriteReflection();
  const [note, setNote] = useState("");
  const done = data.reflection.reflection;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="reflection-title">
      <h2 id="reflection-title" className="flex items-center gap-2 font-heading font-semibold"><PenLine className="h-5 w-5 text-primary-text" aria-hidden /> Reflection</h2>
      {done ? (
        <p className="mt-2 text-sm" role="status"><span className="text-foreground-muted">Today you wrote:</span> {done.note}</p>
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) write.mutate(note.trim(), { onSuccess: () => setNote("") });
          }}
        >
          <label htmlFor="reflection-note" className="text-sm text-foreground-muted">One line about your day{data.xpEnabled ? ` (+${data.reflection.reward} XP, once a day)` : ""}</label>
          <Textarea id="reflection-note" rows={2} maxLength={data.reflection.maxLength} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What went well today?" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground-muted">{note.length}/{data.reflection.maxLength}</span>
            <Button type="submit" size="sm" disabled={!note.trim() || write.isPending} className="gap-1">
              {write.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PenLine className="h-4 w-4" aria-hidden />} Save
            </Button>
          </div>
        </form>
      )}
    </section>
  );
};

const GoalCard = ({ data }: { data: TodayData }) => {
  const setGoal = useSetGoal();
  const claim = useClaimGoal();
  const g = data.goal;
  // The server wants a goal above what is already finished this week, within the allowed range.
  const lowest = Math.max(g.min, g.progress + 1);
  // Until something is typed, the suggestion follows progress (tasks finished while the page is open move it up).
  const [typed, setTarget] = useState<string | null>(null);
  const target = typed ?? String(Math.min(g.max, Math.max(lowest, g.progress + 5)));
  const pct = goalPercent(g.progress, g.target);
  const wanted = /^\d+$/.test(target.trim()) ? Number(target) : null;
  const inRange = wanted !== null && wanted >= lowest && wanted <= g.max;
  const showRangeError = target.trim() !== "" && !inRange;
  const noRoom = lowest > g.max;
  // An unclaimed goal can be raised or lowered (still above progress): the same form, opened from "Change goal".
  const [editing, setEditing] = useState(false);
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="goal-title">
      <h2 id="goal-title" className="flex items-center gap-2 font-heading font-semibold"><Target className="h-5 w-5 text-primary-text" aria-hidden /> Weekly goal</h2>
      {g.target && !editing ? (
        <div className="mt-2 space-y-2">
          <p className="text-sm">
            <span className="font-heading text-xl font-bold" data-testid="goal-progress">{g.progress}</span> of {g.target} tasks
            {g.reward ? <span className="text-foreground-muted"> · reward {g.reward} XP</span> : null}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-background-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={g.target} aria-valuenow={Math.min(g.progress, g.target)} aria-label="Weekly goal progress">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          {g.claimed ? (
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success" role="status"><CheckCircle2 className="h-4 w-4" aria-hidden /> Goal claimed this week</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1" disabled={!g.claimable || claim.isPending} onClick={() => claim.mutate()}>
                {claim.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Gift className="h-4 w-4" aria-hidden />} Claim goal reward
              </Button>
              {!noRoom && (
                <Button size="sm" variant="outline" onClick={() => { setTarget(String(Math.min(g.max, Math.max(lowest, g.target ?? lowest)))); setEditing(true); }}>
                  Change goal
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (inRange) setGoal.mutate(wanted, { onSuccess: () => setEditing(false) });
          }}
        >
          <div>
            <label htmlFor="goal-target" className="mb-1 block text-sm text-foreground-muted">Tasks to finish this week ({lowest} to {g.max})</label>
            <Input
              id="goal-target"
              type="number"
              inputMode="numeric"
              required
              min={lowest}
              max={g.max}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-invalid={showRangeError}
              aria-describedby={showRangeError ? "goal-target-error" : undefined}
              className="w-28"
            />
          </div>
          <Button type="submit" size="sm" disabled={setGoal.isPending || !inRange}>Set goal</Button>
          {editing && <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
          {showRangeError && !noRoom && <p id="goal-target-error" className="w-full text-sm text-destructive-text">Enter a whole number from {lowest} to {g.max}.</p>}
          {noRoom && <p id="goal-target-error" className="w-full text-sm text-foreground-muted">You have already finished {g.progress} tasks this week, more than the largest goal. Set one next week.</p>}
        </form>
      )}
    </section>
  );
};

/** "What should I do next?" on Today: a ranked quest opens in the Quest Log, as it does there. */
const TodayPriorities = () => {
  const navigate = useNavigate();
  return <PriorityPanel onOpen={(listId) => navigate(`/tasks?list=${listId}`)} />;
};

const TodayView = ({ data }: { data: TodayData }) => (
  <div className="space-y-4 sm:space-y-6">
    <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label="Today at a glance">
      <span className="rounded-full border border-border bg-card px-3 py-1" data-testid="count-due"><strong>{data.counts.dueToday}</strong> due today</span>
      <span className={cn("rounded-full border px-3 py-1", data.counts.overdue > 0 ? "border-destructive/40 bg-destructive/10 text-destructive-text" : "border-border bg-card")} data-testid="count-overdue"><strong>{data.counts.overdue}</strong> overdue</span>
      <span className="rounded-full border border-border bg-card px-3 py-1" data-testid="count-done"><strong>{data.counts.doneToday}</strong> done today</span>
    </div>

    {data.season.enabled && data.xpEnabled && (
      <p className="rounded-lg border border-xp/30 bg-xp/10 px-3 py-2 text-sm" data-testid="season-banner"><strong>{data.season.name}:</strong> {data.season.blurb}</p>
    )}

    <StreakStrip day={data.day} live={data.streak.live} claimedToday={data.streak.claimedToday} />

    {data.streak.atRisk && <StreakAtRisk live={data.streak.live} expiresAt={data.streak.expiresAt} />}

    <section aria-labelledby="todo-title">
      <h2 id="todo-title" className="mb-2 flex items-center gap-2 font-heading font-semibold"><Flame className="h-5 w-5 text-primary-text" aria-hidden /> What needs doing</h2>
      {data.tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center" data-testid="today-empty">
          <CalendarCheck className="mx-auto mb-2 h-8 w-8 text-success" aria-hidden />
          <p className="font-medium">Nothing is due and nothing is overdue.</p>
          <p className="mt-1 text-sm text-foreground-muted">Add a task with a due date, or mark one HIGH priority, and it shows up here.</p>
          <Button asChild size="sm" className="mt-3"><Link to="/tasks">Go to your quests</Link></Button>
        </div>
      ) : (
        <ul className="space-y-2">{data.tasks.map((t) => <TaskLine key={t.id} task={t} today={data.day} />)}</ul>
      )}
    </section>

    {data.upcoming && data.upcoming.length > 0 && (
      <section aria-labelledby="upcoming-title">
        <h2 id="upcoming-title" className="mb-2 flex items-center gap-2 font-heading font-semibold"><CalendarClock className="h-5 w-5 text-primary-text" aria-hidden /> Coming up this week</h2>
        <ul className="space-y-2">{data.upcoming.map((t) => <TaskLine key={t.id} task={t} today={data.day} />)}</ul>
      </section>
    )}

    <TodayPriorities />

    <div className="grid gap-4 md:grid-cols-2">
      <ReflectionCard data={data} />
      <GoalCard data={data} />
    </div>
  </div>
);

const Today = () => {
  const today = useToday();
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6">
        <header>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-bold sm:text-3xl">
            <CalendarCheck className="h-6 w-6 text-primary-text sm:h-7 sm:w-7" aria-hidden /> Today
          </h1>
          <p className="text-sm text-foreground-muted">{today.data ? todayHeadline(today.data) : "What is on your plate right now."}</p>
        </header>
        <QueryState query={today} what="your day" skeleton={<div className="h-72 animate-pulse rounded-xl bg-card/50" aria-busy="true" />}>
          {(data) => <TodayView data={data} />}
        </QueryState>
      </div>
    </DashboardLayout>
  );
};

export default Today;
