import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bot, User as UserIcon, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage as Message } from "@/hooks/useChat";
import { SourceChips } from "./SourceChips";

const TOOL_LABELS: Record<string, string> = {
  search_tasks: "Searched your quests",
  get_list: "Looked up a quest",
  get_overdue: "Checked overdue quests",
  get_due_soon: "Checked upcoming deadlines",
  get_stats: "Checked your stats",
  summarize: "Wrote a summary",
  prioritize: "Ranked your quests",
  create_list: "Created a quest",
  add_item: "Added a task",
  complete_item: "Completed a task",
  update_list: "Updated a quest",
};

/** Bold, inline code and quest ids that the answer actually drew on (links go to the quest). */
function renderInline(text: string, knownIds: Map<string, string>): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\bL\d+\b)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i} className="px-1 rounded bg-background-secondary text-xs">{part.slice(1, -1)}</code>;
    if (/^L\d+$/.test(part) && knownIds.has(part)) {
      return (
        <Link key={i} to={`/tasks?list=${part.slice(1)}`} className="text-primary underline underline-offset-2 hover:opacity-80">
          {part}
        </Link>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function renderBody(text: string, knownIds: Map<string, string>): ReactNode {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-1">
        {bullets.map((b, i) => <li key={i}>{renderInline(b, knownIds)}</li>)}
      </ul>
    );
    bullets = [];
  };
  text.split("\n").forEach((line) => {
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      bullets.push(m[1]);
      return;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line, knownIds)}</p>);
  });
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

export function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const known = new Map(message.sources.map((s) => [s.id, s.title]));
  const doneTools = message.tools.filter((t) => t.status !== "error");

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div className={cn("h-8 w-8 shrink-0 rounded-full flex items-center justify-center", isUser ? "bg-primary/20" : "bg-card border border-border")}>
        {isUser ? <UserIcon className="h-4 w-4 text-primary" /> : <Bot className="h-4 w-4 text-primary" />}
      </div>
      <div className={cn("max-w-[85%] space-y-2", isUser && "items-end")}>
        <div className={cn("rounded-2xl px-4 py-2.5 text-sm leading-relaxed", isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border")}>
          {isUser ? <p className="whitespace-pre-wrap">{message.text}</p> : message.text ? renderBody(message.text, known) : message.streaming ? <span className="inline-block h-4 w-2 bg-primary/60 animate-pulse rounded-sm" aria-label="Thinking" /> : null}
          {!isUser && message.streaming && message.text && <span className="inline-block h-4 w-1.5 ml-0.5 align-middle bg-primary/60 animate-pulse rounded-sm" />}
        </div>
        {!isUser && doneTools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {doneTools.map((t, i) => (
              <span key={i} className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border", t.status === "declined" ? "border-border text-foreground-muted" : "border-primary/20 text-primary bg-primary/5")}>
                <Wrench className="h-3 w-3" /> {t.status === "declined" ? "Declined" : TOOL_LABELS[t.name] ?? t.name}
              </span>
            ))}
          </div>
        )}
        {!isUser && message.sources.length > 0 && <SourceChips sources={message.sources} />}
      </div>
    </div>
  );
}
