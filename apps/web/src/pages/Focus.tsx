import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Hourglass, Loader2, Play, Timer, XCircle } from "lucide-react";
import type { FocusActive, FocusFinishResult, FocusStatus } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { APP_TITLE, pageTitle } from "@/lib/pageTitle";
import { QueryState } from "@/components/feedback/QueryState";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFinishFocus, useFocus, useParty, useStartFocus } from "@/hooks/useApi";
import { FOCUS_PRESETS, canFinish, focusTitle, formatClock, minutesUntilPayable, parseMinutes, remainingMs } from "@/lib/focus";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/utils";

const Meter = ({ label, value, max }: { label: string; value: number; max: number }) => {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-xs text-foreground-muted">{value} / {max}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background-tertiary" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

const TodayCard = ({ status }: { status: FocusStatus }) => (
  <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="focus-today">
    <h2 id="focus-today" className="mb-3 font-heading text-base font-semibold sm:text-lg">Today's progress</h2>
    <div className="space-y-3">
      <Meter label="Sessions" value={status.today.sessions} max={status.config.sessionsPerDay} />
      <Meter label="Focus XP" value={status.today.xp} max={status.config.xpPerDay} />
    </div>
    <p className="mt-3 text-xs text-foreground-muted">
      Each focused minute pays {status.config.xpPerMinute} XP, up to {status.config.xpPerDay} XP and {status.config.sessionsPerDay} sessions a day (your day, in your time zone).
    </p>
  </section>
);

const ResultCard = ({ result, onDismiss }: { result: FocusFinishResult; onDismiss: () => void }) => {
  const done = result.state === "finished";
  const Icon = done ? CheckCircle2 : XCircle;
  const message =
    result.state === "finished"
      ? result.xp > 0
        ? `You focused for ${result.minutesCredited} minutes and earned +${result.xp} XP${result.capped ? " (trimmed by the daily cap)" : ""}${result.leveledUp ? `. Level up! You are now level ${result.level}.` : "."}`
        : `You focused for ${result.minutesCredited} minutes. The daily focus XP cap was already reached, so there is no XP this time.`
      : result.state === "cancelled"
        ? "That session ended before it could pay, so it was cancelled and earned no XP."
        : "That session ran too long without being finished, so it expired and earned no XP.";
  return (
    <div role="status" className={cn("rounded-xl border p-4 sm:p-5", done ? "border-success/40 bg-success/5" : "border-border bg-card")}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", done ? "text-success" : "text-foreground-muted")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-heading font-semibold">{done ? "Session complete" : result.state === "cancelled" ? "Session cancelled" : "Session expired"}</p>
          <p className="mt-1 text-sm text-foreground-muted">{message}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  );
};

const Starter = ({ status }: { status: FocusStatus }) => {
  const start = useStartFocus();
  const { minMinutes, maxMinutes } = status.config;
  const [custom, setCustom] = useState("");
  const customMinutes = parseMinutes(custom, minMinutes, maxMinutes);
  const full = status.today.remainingSessions <= 0;
  // Sessions are still allowed after the day's focus XP is used up; say so before one starts, not only in its result.
  const noXpLeft = !full && status.today.remainingXP <= 0;
  const invalidCustom = custom.trim() !== "" && customMinutes === null;

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby="focus-start">
      <h2 id="focus-start" className="mb-1 font-heading text-base font-semibold sm:text-lg">Start a session</h2>
      <p className="mb-4 text-sm text-foreground-muted">
        Pick how long to focus. The timer runs on the server, so closing this tab does not stop it, and it cannot be paused.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Session length">
        {FOCUS_PRESETS.map((m) => (
          <Button key={m} variant="outline" className="gap-2" disabled={full || start.isPending} onClick={() => start.mutate(m)}>
            {start.isPending && start.variables === m && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {m} min
          </Button>
        ))}
      </div>
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (customMinutes !== null) start.mutate(customMinutes);
        }}
      >
        <div>
          <label htmlFor="focus-custom" className="mb-1 block text-sm">Custom minutes ({minMinutes}-{maxMinutes})</label>
          <Input
            id="focus-custom"
            inputMode="numeric"
            className="w-32"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            aria-invalid={invalidCustom}
            aria-describedby={invalidCustom ? "focus-custom-error" : undefined}
            placeholder="30"
          />
        </div>
        <Button type="submit" className="gap-2" disabled={full || customMinutes === null || start.isPending}>
          {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Start
        </Button>
      </form>
      {invalidCustom && <p id="focus-custom-error" className="mt-2 text-sm text-destructive-text">Enter a whole number from {minMinutes} to {maxMinutes}.</p>}
      {noXpLeft && <p className="mt-3 text-sm text-foreground-muted">You have earned today's {status.config.xpPerDay} focus XP. A session still counts its minutes (for a party's focus quest) but pays no more XP until midnight in your time zone.</p>}
      {full && <p className="mt-3 text-sm text-foreground-muted">You finished all {status.config.sessionsPerDay} sessions for today. The limit resets at midnight in your time zone.</p>}
    </section>
  );
};

const Running = ({ active, status, onFinish, finishing }: { active: FocusActive; status: FocusStatus; onFinish: (sessionId: number) => void; finishing: boolean }) => {
  // Server time, estimated: every timing rule here is the server's, so the device clock is corrected by the measured offset.
  const offset = status.clockOffsetMs ?? 0;
  const [now, setNow] = useState(() => Date.now() + offset);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const startedAt = useMemo(() => Date.parse(active.startedAt), [active.startedAt]);
  const endsAt = useMemo(() => Date.parse(active.endsAt), [active.endsAt]);
  const left = remainingMs(endsAt, now);
  const payable = canFinish(startedAt, now, status.config.minMinutes);
  const wasRunning = useRef(left > 0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [offset]);

  // The tab title keeps the countdown visible from other tabs. Restored in a layout effect: when you leave Focus, a plain
  // effect's clean-up would run after the next page set its title and put "Focus" back on it.
  useLayoutEffect(
    () => () => {
      document.title = pageTitle(window.location.pathname);
    },
    []
  );
  // Built from the app name, not the current title: that is already "Focus · TaskQuest", which read "Focus – Focus".
  useEffect(() => {
    document.title = left > 0 ? focusTitle(left, APP_TITLE) : `Time's up · Focus – ${APP_TITLE}`;
  }, [left]);

  // When the time runs out: a soft chime (it follows the "Game sounds" setting), and keyboard focus moves to "Finish session",
  // whose new state a screen reader then reads out with the "Time's up" line below it.
  const finishRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (left === 0 && wasRunning.current) {
      wasRunning.current = false;
      playSound("win");
      finishRef.current?.focus();
    }
  }, [left]);

  const run = () => onFinish(active.sessionId);
  const waitMinutes = minutesUntilPayable(startedAt, now, status.config.minMinutes);

  return (
    <section className="rounded-xl border border-primary/40 bg-card p-6 text-center sm:p-8" aria-labelledby="focus-running">
      <h2 id="focus-running" className="mb-2 flex items-center justify-center gap-2 font-heading text-base font-semibold sm:text-lg">
        <Hourglass className="h-5 w-5 text-primary-text" aria-hidden /> {active.minutes} minute session
      </h2>
      <p className="font-heading text-6xl font-bold tabular-nums sm:text-7xl" role="timer" aria-label="Time left" data-testid="focus-timer">
        {formatClock(left)}
      </p>
      <p className="mt-2 text-sm text-foreground-muted" role="status">
        {left === 0 ? "Time's up! Finish the session to collect your XP." : "Stay with it. The timer cannot be paused: leave early and the session ends without XP."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button ref={finishRef} className="gap-2" disabled={!payable || finishing} onClick={run}>
          {finishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          Finish session
        </Button>
        <Button variant="ghost" disabled={finishing} onClick={() => setConfirmAbandon(true)}>Give up</Button>
      </div>
      {!payable && (
        <p className="mt-3 text-xs text-foreground-muted">
          Finishing pays XP after {status.config.minMinutes} minutes ({waitMinutes} more {waitMinutes === 1 ? "minute" : "minutes"}).
        </p>
      )}
      <ConfirmDialog
        open={confirmAbandon}
        onOpenChange={setConfirmAbandon}
        title="Give up this session?"
        description={payable ? "You will be paid for the minutes you already focused." : `It is shorter than ${status.config.minMinutes} minutes, so it will be cancelled and earn no XP.`}
        confirmLabel={payable ? "Finish now" : "Give up"}
        onConfirm={run}
      />
    </section>
  );
};

/** Focus minutes count towards the party's shared quest: say so, and link to it, when the player is in a party that has one. */
const PartyFocusLink = () => {
  const quest = useParty().data?.party?.focusQuest;
  if (!quest) return null;
  return (
    <p className="text-center text-sm text-foreground-muted">
      Your focus minutes count towards your party's quest ({quest.progress}/{quest.target} min this week).{" "}
      <Link to="/party" className="font-medium text-primary-text underline underline-offset-2">Open the party</Link>
    </p>
  );
};

const FocusBody = ({ status }: { status: FocusStatus }) => {
  const [result, setResult] = useState<FocusFinishResult | null>(null);
  const finish = useFinishFocus();
  return (
    <div className="space-y-4 sm:space-y-6">
      {result && <ResultCard result={result} onDismiss={() => setResult(null)} />}
      {status.active ? <Running key={status.active.sessionId} active={status.active} status={status} finishing={finish.isPending} onFinish={(id) => finish.mutate(id, { onSuccess: setResult })} /> : <Starter status={status} />}
      <TodayCard status={status} />
      <PartyFocusLink />
    </div>
  );
};

const Focus = () => {
  const focus = useFocus();
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-4 sm:space-y-6">
        <header>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-bold sm:text-3xl">
            <Timer className="h-6 w-6 text-primary-text sm:h-7 sm:w-7" aria-hidden /> Focus
          </h1>
          <p className="text-sm text-foreground-muted">Work without distractions and earn XP for the minutes you really spend.</p>
        </header>
        <QueryState query={focus} what="your focus sessions" skeleton={<div className="h-64 animate-pulse rounded-xl bg-card/50" aria-busy="true" />}>
          {(status) => <FocusBody status={status} />}
        </QueryState>
      </div>
    </DashboardLayout>
  );
};

export default Focus;
