import { buildHeatmap, shortDate, utcToday, type HeatCell } from "@/lib/stats";
import type { XPHistoryDay } from "@/lib/api";
import { cn } from "@/lib/utils";

// Full class names so Tailwind's scanner keeps them.
const LEVEL_CLASS: Record<HeatCell["level"], string> = {
  0: "bg-background-tertiary",
  1: "bg-primary/25",
  2: "bg-primary/50",
  3: "bg-primary/75",
  4: "bg-primary",
};

const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

const describeCell = (c: HeatCell) => `${shortDate(c.date)}: ${c.count === 0 ? "no tasks" : c.count === 1 ? "1 task" : `${c.count} tasks`} completed`;

/** Tasks completed per day over the last 12 weeks: a grid of cells, one column per week (Monday first). */
export const Heatmap = ({ days, today }: { days: readonly XPHistoryDay[]; today?: string }) => {
  // The server's last day is today in the player's own time zone; UTC would be a day off for half the world.
  const columns = buildHeatmap(days, today ?? days[days.length - 1]?.date ?? utcToday(), 12);
  return (
    <div data-testid="heatmap">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <div className="flex flex-col gap-1 pr-1 text-[10px] leading-4 text-foreground-muted" aria-hidden>
          {ROW_LABELS.map((l, i) => <span key={i} className="h-4">{l}</span>)}
        </div>
        <ul className="flex gap-1" aria-label="Tasks completed per day, last 12 weeks">
          {columns.map((column) => (
            <li key={column[0].date} className="flex flex-col gap-1">
              {column.map((cell) =>
                cell.future ? (
                  <span key={cell.date} className="h-4 w-4 rounded-xs" aria-hidden />
                ) : (
                  <span
                    key={cell.date}
                    role="img"
                    aria-label={describeCell(cell)}
                    title={describeCell(cell)}
                    className={cn("h-4 w-4 rounded-xs", LEVEL_CLASS[cell.level])}
                  />
                ),
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-foreground-muted" aria-hidden>
        Less
        {([0, 1, 2, 3, 4] as const).map((l) => <span key={l} className={cn("h-3 w-3 rounded-xs", LEVEL_CLASS[l])} />)}
        More
      </div>
    </div>
  );
};
