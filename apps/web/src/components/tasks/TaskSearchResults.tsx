import { CheckCircle2, Circle, Loader2, Scroll } from "lucide-react";
import { useTaskSearch } from "@/hooks/useApi";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchableQuery, snippetAround } from "@/lib/taskSearch";

interface Props {
  query: string;
  onOpen: (listId: number, taskId?: number) => void;
}

/** Tasks whose name or description matches the search text, each opening its quest and the task itself. */
export const TaskSearchResults = ({ query, onOpen }: Props) => {
  const q = searchableQuery(useDebouncedValue(query));
  const { data, isFetching, isError, error, refetch } = useTaskSearch(q);

  if (!searchableQuery(query)) {
    return <p className="text-center py-12 text-foreground-muted">Type at least two characters to search inside your tasks.</p>;
  }
  if (isError) return <ErrorCard what="the search" error={error} onRetry={() => void refetch()} retrying={isFetching} />;
  if (!data) return <div className="flex justify-center py-12" aria-busy="true"><Loader2 className="h-6 w-6 animate-spin text-foreground-muted" /></div>;
  if (data.tasks.length === 0) return <p className="text-center py-12 text-foreground-muted">No tasks match "{q}".</p>;

  return (
    <section aria-label="Matching tasks" aria-busy={isFetching}>
      <p className="text-sm text-foreground-muted mb-3" aria-live="polite">
        {data.tasks.length} matching task{data.tasks.length === 1 ? "" : "s"}{data.tasks.length >= 50 ? " (showing the first 50)" : ""}
      </p>
      <ul className="space-y-2">
        {data.tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onOpen(task.list_id, task.id)}
              className="w-full text-left rounded-xl border border-border bg-card p-3 hover:border-primary/50 transition-colors flex gap-3"
            >
              {task.completed ? <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-success" aria-label="Done" /> : <Circle className="h-5 w-5 mt-0.5 shrink-0 text-foreground-muted" aria-label="Not done" />}
              <span className="min-w-0">
                <span className={task.completed ? "block font-medium line-through text-foreground-muted break-words" : "block font-medium break-words"}>{task.name}</span>
                {task.description && <span className="block text-sm text-foreground-muted break-words">{snippetAround(task.description, q ?? "")}</span>}
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-primary-text"><Scroll className="h-3 w-3" aria-hidden />{task.list_name}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
