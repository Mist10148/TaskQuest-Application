import { useState } from "react";
import { BarChart3, CalendarDays, Flame, ListChecks, Sparkles } from "lucide-react";
import type { HistoryRange } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { QueryState } from "@/components/feedback/QueryState";
import { XPChart } from "@/components/stats/XPChart";
import { Heatmap } from "@/components/stats/Heatmap";
import { useStatsSummary, useXpHistory } from "@/hooks/useApi";
import { sumBy } from "@/lib/stats";
import { cn } from "@/lib/utils";

const RANGES: HistoryRange[] = [7, 30, 90];

const Card = ({ title, icon, children, className }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <section className={cn("rounded-xl border border-border bg-card p-4 sm:p-5", className)}>
    <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold sm:text-lg">{icon}{title}</h2>
    {children}
  </section>
);

const Skeleton = ({ className }: { className: string }) => <div className={cn("animate-pulse rounded-xl bg-card/50", className)} aria-busy="true" />;

const Stats = () => {
  const [range, setRange] = useState<HistoryRange>(30);
  const history = useXpHistory(range);
  const heat = useXpHistory(90); // the heatmap needs 12 weeks whatever the chart range is
  const summary = useStatsSummary();

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
        <header>
          <h1 className="font-heading text-2xl font-bold sm:text-3xl">Stats</h1>
          <p className="text-sm text-foreground-muted">How your XP and finished tasks add up. Days follow your time zone (Settings).</p>
        </header>

        <QueryState query={summary} what="your stats" skeleton={<Skeleton className="h-24" />}>
          {(s) => (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl border border-border bg-card p-3 sm:p-4" data-testid="streak-card">
                <Flame className="mb-1 h-5 w-5 text-destructive-text" aria-hidden />
                <p className="font-heading text-2xl font-bold">{s.streak}</p>
                <p className="text-xs text-foreground-muted">day streak</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
                <ListChecks className="mb-1 h-5 w-5 text-success" aria-hidden />
                <p className="font-heading text-2xl font-bold">{s.tasksCompleted7d}</p>
                <p className="text-xs text-foreground-muted">tasks done in 7 days</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
                <Sparkles className="mb-1 h-5 w-5 text-xp" aria-hidden />
                <p className="font-heading text-2xl font-bold">{s.xpBySource30d.reduce((n, r) => n + r.xp, 0).toLocaleString()}</p>
                <p className="text-xs text-foreground-muted">XP in 30 days</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
                <CalendarDays className="mb-1 h-5 w-5 text-primary-text" aria-hidden />
                <p className="font-heading text-2xl font-bold">{s.busiestWeekday?.name ?? "No data yet"}</p>
                <p className="text-xs text-foreground-muted">{s.busiestWeekday ? `busiest day (${s.busiestWeekday.count} tasks)` : "busiest day"}</p>
              </div>
            </div>
          )}
        </QueryState>

        <Card title="XP per day" icon={<BarChart3 className="h-4 w-4 text-primary-text" aria-hidden />}>
          <div role="group" aria-label="Chart range" className="mb-3 flex gap-2">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={cn(
                  "rounded-lg border px-3 py-1 text-sm",
                  range === r ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground-muted hover:text-foreground",
                )}
              >
                {r} days
              </button>
            ))}
          </div>
          <QueryState query={history} what="your XP history" skeleton={<Skeleton className="h-48" />}>
            {(days) => (
              <>
                <p className="mb-2 text-sm text-foreground-muted">
                  <span className="font-semibold text-foreground">{sumBy(days, "xp").toLocaleString()} XP</span> and{" "}
                  <span className="font-semibold text-foreground">{sumBy(days, "tasksCompleted")} tasks</span> in the last {range} days
                </p>
                <XPChart days={days} />
              </>
            )}
          </QueryState>
        </Card>

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
          <Card title="Where your XP comes from" icon={<Sparkles className="h-4 w-4 text-xp" aria-hidden />}>
            <QueryState query={summary} what="your XP sources" skeleton={<Skeleton className="h-40" />}>
              {(s) => {
                const total = s.xpBySource30d.reduce((n, r) => n + r.xp, 0);
                if (s.xpBySource30d.length === 0) return <p className="text-sm text-foreground-muted">No XP earned in the last 30 days yet. Finish a task to get started.</p>;
                return (
                  <ul className="space-y-2" aria-label="XP by source, last 30 days">
                    {s.xpBySource30d.map((r) => {
                      const percent = total > 0 ? Math.round((r.xp / total) * 100) : 0;
                      return (
                        <li key={r.source}>
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="truncate">{r.label}</span>
                            <span className="shrink-0 text-xs text-foreground-muted">{r.xp.toLocaleString()} XP · {percent}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background-tertiary" role="progressbar" aria-label={`${r.label} share`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                );
              }}
            </QueryState>
          </Card>

          <Card title="Last 12 weeks" icon={<CalendarDays className="h-4 w-4 text-primary-text" aria-hidden />}>
            <QueryState query={heat} what="your activity" skeleton={<Skeleton className="h-40" />}>
              {(days) => <Heatmap days={days} />}
            </QueryState>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Stats;
