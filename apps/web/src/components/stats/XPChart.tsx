import { barLayout, shortDate } from "@/lib/stats";
import type { XPHistoryDay } from "@/lib/api";

const WIDTH = 600;
const HEIGHT = 160;

/**
 * XP per day as inline SVG bars. The SVG is described for screen readers and the same numbers sit in a
 * collapsible table right under it, so the chart is never the only way to read the data.
 */
export const XPChart = ({ days }: { days: readonly XPHistoryDay[] }) => {
  const bars = barLayout(days.map((d) => d.xp), WIDTH, HEIGHT, days.length > 45 ? 1 : 3);
  const max = Math.max(0, ...days.map((d) => d.xp));
  const first = days[0];
  const last = days[days.length - 1];
  const total = days.reduce((n, d) => n + d.xp, 0);
  const label = first && last ? `XP per day from ${shortDate(first.date)} to ${shortDate(last.date)}: ${total} XP in total, best day ${max} XP.` : "XP per day";

  return (
    <div data-testid="xp-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} className="h-40 w-full" preserveAspectRatio="none">
        <line x1="0" x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-border" strokeWidth="1" />
        {bars.map((b, i) => (
          <rect key={days[i].date} x={b.x} y={b.y} width={b.width} height={b.height} rx="1.5" className="fill-primary">
            <title>{`${shortDate(days[i].date)}: ${days[i].xp} XP`}</title>
          </rect>
        ))}
      </svg>
      {first && last && (
        <div className="mt-1 flex justify-between text-xs text-foreground-muted" aria-hidden>
          <span>{shortDate(first.date)}</span>
          <span>peak {max.toLocaleString()} XP</span>
          <span>{shortDate(last.date)}</span>
        </div>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-foreground-muted hover:text-foreground">Show as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">XP earned and tasks completed per day</caption>
            <thead className="sticky top-0 bg-card">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">Day</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">XP</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Tasks</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <th scope="row" className="px-3 py-1 font-normal">{d.date}</th>
                  <td className="px-3 py-1 text-right">{d.xp}</td>
                  <td className="px-3 py-1 text-right">{d.tasksCompleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
};
