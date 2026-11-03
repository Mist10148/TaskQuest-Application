import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Check, Circle, Plus } from "lucide-react";
import type { Item } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { calendarKeyTarget, monthGrid, shiftMonth, tasksByDate } from "@/lib/taskViews";
import { formatDayLabel } from "@/lib/dates";
import { useLocalToday } from "@/hooks/useLocalToday";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/useT";

interface Props {
  items: readonly Item[];
  readOnly?: boolean;
  onToggle: (itemId: number) => void;
  onEdit: (itemId: number) => void;
  /** Start a new task due on the picked day; left out when the quest is read-only. */
  onAddOnDate?: (date: string) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A month grid of the quest's due dates. Pick a day to see (and tick off) its tasks below the grid. */
export const TaskCalendar = ({ items, readOnly, onToggle, onEdit, onAddOnDate }: Props) => {
  const t = useT();
  const today = useLocalToday();
  const monthOf = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
  const [view, setView] = useState(() => monthOf(today));
  const [picked, setPicked] = useState<string>(today);
  // At midnight a calendar left on "today" moves on with it (and to the new month); a day someone picked stays picked.
  const shownToday = useRef(today);
  useEffect(() => {
    const before = shownToday.current;
    if (before === today) return;
    shownToday.current = today;
    setPicked((p) => (p === before ? today : p));
    setView((v) => (v.year === monthOf(before).year && v.month === monthOf(before).month ? monthOf(today) : v));
  }, [today]);
  const onThisMonth = view.year === monthOf(today).year && view.month === monthOf(today).month;
  const goToday = () => {
    setView(monthOf(today));
    setPicked(today);
  };
  const byDate = useMemo(() => tasksByDate(items), [items]);
  const weeks = useMemo(() => monthGrid(view.year, view.month), [view]);
  const undated = items.filter((i) => !i.parent_id && !i.due_date && !i.completed).length;
  const dayItems = byDate.get(picked) ?? [];
  const gridRef = useRef<HTMLDivElement>(null);
  // Set by a key press, so focus follows the picked day after the grid re-renders (possibly as another month).
  const focusAfterRender = useRef(false);
  // One tab stop for the whole grid: the picked day if it is shown, otherwise the first day of the month.
  const shown = weeks.flat();
  const tabStop = shown.some((c) => c.date === picked) ? picked : shown.find((c) => c.inMonth)?.date;

  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${picked}"]`)?.focus();
  }, [picked, weeks]);

  const onGridKey = (e: KeyboardEvent, date: string) => {
    const target = calendarKeyTarget(date, e.key);
    if (!target) return;
    e.preventDefault();
    focusAfterRender.current = true;
    setPicked(target);
    const y = Number(target.slice(0, 4));
    const m = Number(target.slice(5, 7));
    if (y !== view.year || m !== view.month) setView({ year: y, month: m });
  };

  return (
    <div data-testid="task-calendar">
      <div className="mb-3 flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" aria-label={t("calendar.previousMonth")} onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <h3 className="font-heading font-semibold" aria-live="polite">{MONTHS[view.month - 1]} {view.year}</h3>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" disabled={onThisMonth && picked === today} onClick={goToday}>{t("calendar.today")}</Button>
          <Button type="button" variant="outline" size="sm" aria-label={t("calendar.nextMonth")} onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" ref={gridRef} aria-label={`${MONTHS[view.month - 1]} ${view.year}`}>
        <div role="row" className="contents">
          {WEEKDAYS.map((d) => <div key={d} role="columnheader" className="pb-1 text-center text-xs text-foreground-muted">{d}</div>)}
        </div>
        {weeks.map((week) => (
          <div key={week[0].date} role="row" className="contents">
            {week.map((cell) => {
              const tasks = byDate.get(cell.date) ?? [];
              const open = tasks.filter((t) => !t.completed).length;
              const overdue = open > 0 && cell.date < today;
              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  aria-selected={picked === cell.date}
                  data-date={cell.date}
                  tabIndex={cell.date === tabStop ? 0 : -1}
                  onKeyDown={(e) => onGridKey(e, cell.date)}
                  aria-label={`${formatDayLabel(cell.date)}${cell.date === today ? t("calendar.todaySuffix") : ""}${tasks.length ? `${t("calendar.openOf", { open, total: tasks.length })}${overdue ? t("calendar.overdueSuffix") : ""}` : ""}`}
                  onClick={() => setPicked(cell.date)}
                  className={cn(
                    "flex min-h-14 flex-col items-start rounded-md border p-1 text-left text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-20",
                    cell.inMonth ? "border-border bg-card" : "border-transparent bg-card/30 text-foreground-muted",
                    cell.date === today && "ring-1 ring-primary",
                    picked === cell.date && "border-primary bg-primary/10"
                  )}
                >
                  <span className="font-medium">{Number(cell.date.slice(8, 10))}</span>
                  {tasks.length > 0 && (
                    // On a phone a cell is about 40px wide: show just the count there, the words from sm up (the label says it all).
                    <span aria-hidden className={cn("mt-auto max-w-full truncate rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold", overdue ? "bg-destructive/15 text-destructive-text" : open > 0 ? "bg-primary/15 text-primary-text" : "bg-success/15 text-success")}>
                      {overdue ? (
                        <>{open}<span className="hidden sm:inline">{t("calendar.overdue")}</span></>
                      ) : open > 0 ? (
                        <>{open}<span className="hidden sm:inline">{t("calendar.open")}</span></>
                      ) : (
                        <Check className="inline h-3 w-3 sm:hidden" />
                      )}
                      {!overdue && open === 0 && <span className="hidden sm:inline">{t("calendar.done")}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <section className="mt-4 rounded-xl border border-border bg-card/60 p-3" aria-label={t("calendar.tasksDue", { day: formatDayLabel(picked) })}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-heading font-semibold">{picked === today ? t("calendar.today") : formatDayLabel(picked)}</h4>
          {onAddOnDate && (
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onAddOnDate(picked)} aria-label={t("calendar.addOnDayLabel", { day: formatDayLabel(picked) })}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> {t("calendar.addOnDay")}
            </Button>
          )}
        </div>
        {dayItems.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t("calendar.nothingDue")}</p>
        ) : (
          <ul className="space-y-2">
            {dayItems.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <button type="button" disabled={readOnly} onClick={() => onToggle(item.id)} aria-label={t(item.completed ? "calendar.markNotDone" : "calendar.markDone", { name: item.name })} className="shrink-0 rounded-full text-foreground-muted hover:text-success focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
                  {item.completed ? <Check className="h-4 w-4 text-success" aria-hidden /> : <Circle className="h-4 w-4" aria-hidden />}
                </button>
                <button type="button" disabled={readOnly} onClick={() => onEdit(item.id)} className={cn("min-w-0 flex-1 truncate text-left", item.completed && "line-through opacity-60")}>{item.name}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {undated > 0 && <p className="mt-2 text-xs text-foreground-muted">{undated === 1 ? t("calendar.undatedOne") : t("calendar.undatedMany", { count: undated })}</p>}
    </div>
  );
};
