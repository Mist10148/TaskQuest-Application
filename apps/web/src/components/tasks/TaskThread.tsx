import { useState } from "react";
import { History, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { useAddComment, useDeleteComment, useItemActivity, useItemComments } from "@/hooks/useApi";
import { actorName, describeActivity, timeAgo } from "@/lib/activity";
import { cn } from "@/lib/utils";

/** The server's limit for one comment (TEXT_LIMITS.COMMENT). */
export const MAX_COMMENT_LENGTH = 1000;

type Tab = "comments" | "activity";

/** A task's conversation and history, shown in the detail drawer: comments (like monday's updates) and every change. */
export const TaskThread = ({ itemId, canComment }: { itemId: number; canComment: boolean }) => {
  const [tab, setTab] = useState<Tab>("comments");
  const tabClass = (t: Tab) =>
    cn(
      "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
      tab === t ? "bg-primary text-primary-foreground" : "text-foreground-muted hover:text-foreground"
    );
  return (
    <section className="mt-6 border-t border-border pt-4" aria-label="Comments and activity">
      <div role="group" aria-label="Show" className="mb-3 inline-flex rounded-lg border border-border bg-card p-0.5">
        <button type="button" aria-pressed={tab === "comments"} className={tabClass("comments")} onClick={() => setTab("comments")}>
          <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Comments
        </button>
        <button type="button" aria-pressed={tab === "activity"} className={tabClass("activity")} onClick={() => setTab("activity")}>
          <History className="h-3.5 w-3.5" aria-hidden /> Activity
        </button>
      </div>
      {tab === "comments" ? <Comments itemId={itemId} canComment={canComment} /> : <Activity itemId={itemId} />}
    </section>
  );
};

const Loading = ({ what }: { what: string }) => (
  <p className="flex items-center gap-2 text-xs text-foreground-muted" aria-busy="true">
    <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading {what}…
  </p>
);

const Comments = ({ itemId, canComment }: { itemId: number; canComment: boolean }) => {
  const { data, isLoading, isError, refetch, isFetching } = useItemComments(itemId);
  const add = useAddComment(itemId);
  const remove = useDeleteComment();
  const [draft, setDraft] = useState("");
  const comments = data?.comments ?? [];

  const submit = () => {
    const body = draft.trim();
    if (!body || add.isPending) return;
    add.mutate(body, { onSuccess: () => setDraft("") });
  };

  return (
    <div className="space-y-3">
      {isLoading && <Loading what="comments" />}
      {isError && <ErrorCard what="the comments" onRetry={() => void refetch()} retrying={isFetching} />}
      {!isLoading && !isError && comments.length === 0 && <p className="text-sm text-foreground-muted">No comments yet.</p>}
      <ul className="space-y-2">
        {comments.map((c) => (
          <li key={c.id} className="group rounded-lg bg-background-secondary/60 p-2.5">
            <div className="flex items-center gap-2 text-xs text-foreground-muted">
              <span className="font-semibold text-foreground">{actorName(c.author)}</span>
              <time dateTime={c.createdAt}>{timeAgo(c.createdAt)}</time>
              {c.canDelete && (
                <button
                  type="button"
                  aria-label={`Delete comment from ${actorName(c.author)}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(c.id)}
                  className="ml-auto rounded p-1 hover:text-destructive-text focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm">{c.body}</p>
          </li>
        ))}
      </ul>
      {canComment && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            aria-label="Write a comment"
            placeholder="Write a comment…"
            rows={2}
            maxLength={MAX_COMMENT_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
            className="min-h-[60px] resize-none"
          />
          <Button type="submit" size="icon" disabled={!draft.trim() || add.isPending} aria-label="Post comment">
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          </Button>
        </form>
      )}
    </div>
  );
};

const Activity = ({ itemId }: { itemId: number }) => {
  const { data, isLoading, isError, refetch, isFetching } = useItemActivity(itemId);
  const entries = data?.activity ?? [];
  if (isLoading) return <Loading what="the history" />;
  if (isError) return <ErrorCard what="the history" onRetry={() => void refetch()} retrying={isFetching} />;
  if (entries.length === 0) return <p className="text-sm text-foreground-muted">No changes recorded yet.</p>;
  return (
    <ol className="space-y-2 border-l border-border pl-3">
      {entries.map((a) => (
        <li key={a.id} className="text-sm">
          <p>{describeActivity(a)}</p>
          <time dateTime={a.createdAt} className="text-xs text-foreground-muted">{timeAgo(a.createdAt)}</time>
        </li>
      ))}
    </ol>
  );
};
