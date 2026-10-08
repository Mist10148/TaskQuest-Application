import { Sparkles, AlertTriangle, ArrowRight } from "lucide-react";
import type { AiSummary } from "@/lib/api";

export function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
      <Sparkles className="h-3 w-3" /> AI-generated
    </span>
  );
}

export function SummaryCard({ summary }: { summary: AiSummary }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading font-semibold text-base sm:text-lg">{summary.headline}</h3>
        <AiBadge />
      </div>

      {summary.highlights.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {summary.highlights.map((h) => (
            <li key={h} className="flex gap-2"><span className="text-primary">•</span><span>{h}</span></li>
          ))}
        </ul>
      )}

      {summary.blockers.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive mb-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Blockers</p>
          <ul className="space-y-1 text-sm">
            {summary.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      {summary.next_steps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-foreground-muted mb-1.5">Next steps</p>
          <ul className="space-y-1 text-sm">
            {summary.next_steps.map((s) => (
              <li key={s} className="flex gap-2"><ArrowRight className="h-4 w-4 mt-0.5 text-primary shrink-0" /><span>{s}</span></li>
            ))}
          </ul>
        </div>
      )}

      {summary.referenced_ids.length > 0 && (
        <p className="text-[11px] text-foreground-muted">Based on: {summary.referenced_ids.join(", ")}{summary.cached ? " · cached" : ""}</p>
      )}
    </div>
  );
}
