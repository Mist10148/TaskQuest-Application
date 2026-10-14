import { forwardRef, useState } from "react";
import { Calendar, Loader2, Repeat, Sparkles, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDeadline, localToday } from "@/lib/dates";
import { parseQuickAdd, type QuickAddResult } from "@/lib/quickAdd";

interface Props {
  pending: boolean;
  aiEnabled: boolean;
  /** Resolves true when the task was created; the text is kept when it was not, so nothing typed is lost. */
  onAdd: (parsed: QuickAddResult) => Promise<boolean>;
}

/**
 * One-line task entry: "Finish report fri !high #work every week". A live preview
 * shows what was understood; Enter adds the task. With AI on, a second button
 * hands the same sentence to the chat assistant instead.
 */
export const QuickAddBar = forwardRef<HTMLInputElement, Props>(({ pending, aiEnabled, onAdd }, ref) => {
  const [text, setText] = useState("");
  const parsed = parseQuickAdd(text, localToday());
  const understood = parsed.due_date || parsed.priority || parsed.tags.length > 0 || parsed.recurrence;

  const submit = async () => {
    if (!parsed.name || pending) return;
    if (await onAdd(parsed)) setText("");
  };

  return (
    <form
      className="mb-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Zap className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary-text" aria-hidden />
          <Input
            ref={ref}
            aria-label="Quick add a task"
            placeholder="Quick add: Finish report fri !high #work every week"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            className="pl-10"
          />
        </div>
        <Button type="submit" disabled={!parsed.name || pending} className="gap-1">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
        </Button>
        {aiEnabled && text.trim() && (
          <Button asChild type="button" variant="outline" className="gap-1" title="Ask the AI assistant to add this">
            <Link to={`/chat?q=${encodeURIComponent(`Add this to my quests: ${text.trim()}`)}`}>
              <Sparkles className="h-4 w-4" /> <span className="hidden sm:inline">Ask AI</span>
            </Link>
          </Button>
        )}
      </div>
      {text.trim() && understood && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground-muted" aria-live="polite">
          <span className="font-medium text-foreground">{parsed.name || "…"}</span>
          {parsed.due_date && <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" aria-hidden /> {formatDeadline(parsed.due_date)}</span>}
          {parsed.priority && <span>❗ {parsed.priority.toLowerCase()}</span>}
          {parsed.recurrence && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" aria-hidden /> {parsed.recurrence}</span>}
          {parsed.tags.map((t) => <span key={t} className="text-primary-text">#{t}</span>)}
        </p>
      )}
    </form>
  );
});
QuickAddBar.displayName = "QuickAddBar";
