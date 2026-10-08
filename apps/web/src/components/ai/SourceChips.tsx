import { Link } from "react-router-dom";
import { ScrollText } from "lucide-react";
import type { AiSource } from "@/lib/api";

/** Quests the answer drew on. Only ids returned by the server are linked, so nothing is made up. */
export function SourceChips({ sources }: { sources: AiSource[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-foreground-muted">Sources:</span>
      {sources.map((s) => (
        <Link
          key={s.id}
          to={`/tasks?list=${s.id.replace(/^L/, "")}`}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border bg-background-secondary hover:border-primary/50 max-w-[220px]"
        >
          <ScrollText className="h-3 w-3 shrink-0" />
          <span className="truncate">{s.title}</span>
        </Link>
      ))}
    </div>
  );
}
