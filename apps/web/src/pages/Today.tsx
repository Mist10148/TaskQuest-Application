import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarCheck, CalendarClock, CheckCircle2, Flame, Gift, Loader2, PenLine, Target, Timer } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { QueryState } from "@/components/feedback/QueryState";
import { PriorityPanel } from "@/components/ai/PriorityPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useClaimGoal, useSetGoal, useToday, useToggleItem, useWriteReflection } from "@/hooks/useApi";
import { cn } from "@/lib/utils";
import { formatDeadline, formatDue } from "@/lib/dates";
import { todayHeadline, goalPercent } from "@/lib/today";
import { StreakStrip } from "@/components/dashboard/StreakStrip";
import type { TodayData, TodayTask } from "@/lib/api";

const PRIORITY_DOT: Record<string, string> = { HIGH: "bg-destructive", MEDIUM: "bg-xp", LOW: "bg-success" };

const TaskLine = ({ task, today }: { task: TodayTask; today: string }) => {
  const toggle = useToggleItem();
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <button
        type="button"
        aria-label={`Mark "${task.name}" done`}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate({ itemId: task.id, completed: true })}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-border transition-colors hover:border-success hover:bg-success/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {toggle.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5 text-transparent hover:text-success" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words text-sm font-medium sm:text-base">{task.name}</p>
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
  // A suggestion above this week's progress, within the allowed range (a default over the maximum could not be submitted).
  const [target, setTarget] = useState(String(Math.min(g.max, Math.max(g.min, g.progress + 5))));
  const pct = goalPercent(g.progress, g.target);
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="goal-title">
      <h2 id="goal-title" className="flex items-center gap-2 font-heading font-semibold"><Target className="h-5 w-5 text-primary-text" aria-hidden /> Weekly goal</h2>
      {g.target ? (
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
            <Button size="sm" className="gap-1" disabled={!g.claimable || claim.isPending} onClick={() => claim.mutate()}>
              {claim.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Gift className="h-4 w-4" aria-hidden />} Claim goal reward
            </Button>
          )}
        </div>
      ) : (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setGoal.mutate(Number(target));
          }}
        >
          <div>
            <label htmlFor="goal-target" className="mb-1 block text-sm text-foreground-muted">Tasks to finish this week ({g.min} to {g.max})</label>
            <Input id="goal-target" type="number" inputMode="numeric" min={g.min} max={g.max} value={target} onChange={(e) => setTarget(e.target.value)} className="w-28" />
          </div>
          <Button type="submit" size="sm" disabled={setGoal.isPending}>Set goal</Button>
        </form>
      )}
    </section>
  );
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

    {data.streak.atRisk && (
      <div role="alert" className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" data-testid="streak-warning">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive-text" aria-hidden />
        <p>
          Your <strong>{data.streak.live}-day streak</strong> ends today if you do not claim your daily reward. <Link to="/dashboard" className="font-medium underline">Claim it on the dashboard</Link>.
        </p>
      </div>
    )}

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

    <PriorityPanel />

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
