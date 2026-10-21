import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bot, Loader2, MessageSquarePlus, PanelLeft, Send, Square, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessage } from "@/components/ai/ChatMessage";
import { ConfirmActionCard } from "@/components/ai/ConfirmActionCard";
import { useSlow } from "@/components/ai/useSlow";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/hooks/useChat";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useChatThreads, useDeleteThread } from "@/hooks/useApi";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { cn } from "@/lib/utils";

const SUGGESTIONS = ["What should I do first today?", "What is due this week?", "How do I earn XP?", "Add a task to my newest quest"];

const Chat = () => {
  const { user } = useAuth();
  const { threadId: routeThreadId } = useParams();
  const navigate = useNavigate();
  const enabled = Boolean(user?.features?.ai);
  const { data: threadData, isLoading: threadsLoading, isError: threadsFailed, refetch: refetchThreads, isFetching: threadsFetching } = useChatThreads(enabled);
  const deleteThread = useDeleteThread();
  const chat = useChat(routeThreadId ?? null);
  // /chat?q=... pre-fills the box (used by the quick-add "Ask AI" button); it is never sent automatically.
  const [searchParams] = useSearchParams();
  const [input, setInput] = useState(() => (routeThreadId ? "" : (searchParams.get("q") ?? "").slice(0, 2000)));
  const [showThreads, setShowThreads] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Thread whose history has already been scrolled into view; opening a thread jumps straight to its end once.
  const scrolledFor = useRef<string | null>(null);
  // Only replies that finish while the page is open are read aloud, not a history that just loaded.
  const [announced, setAnnounced] = useState<string | null>(null);
  const { reduceMotion } = usePreferences();
  const waiting = chat.isStreaming && !chat.messages[chat.messages.length - 1]?.text;
  const slow = useSlow(waiting);
  const lastMessage = chat.messages[chat.messages.length - 1];
  const busy = chat.isStreaming || chat.pending.length > 0 || chat.historyLoading;
  const wasStreaming = useRef(false);

  useEffect(() => {
    if (wasStreaming.current && !chat.isStreaming && lastMessage?.role === "assistant") setAnnounced(lastMessage.text);
    wasStreaming.current = chat.isStreaming;
  }, [chat.isStreaming, lastMessage]);

  // A brand-new conversation gets its id when the first turn ends; reflect it in the URL, once.
  const { createdThreadId, acknowledgeCreated } = chat;
  useEffect(() => {
    if (!createdThreadId || chat.isStreaming) return;
    if (!routeThreadId) navigate(`/chat/${createdThreadId}`, { replace: true });
    acknowledgeCreated();
  }, [createdThreadId, acknowledgeCreated, chat.isStreaming, routeThreadId, navigate]);

  // A deleted or unknown conversation sends the reader back to a fresh chat.
  useEffect(() => {
    if (chat.historyMissing) navigate("/chat", { replace: true });
  }, [chat.historyMissing, navigate]);

  // Once the confirmation card goes away, put the cursor back in the message box instead of losing it.
  const hadPending = useRef(false);
  useEffect(() => {
    if (hadPending.current && chat.pending.length === 0) inputRef.current?.focus();
    hadPending.current = chat.pending.length > 0;
  }, [chat.pending.length]);

  useEffect(() => {
    if (!showThreads) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowThreads(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showThreads]);

  useEffect(() => {
    // Follow the conversation only while the reader is at (or near) the bottom, or just sent something: scrolling up to
    // reread must not be undone by every streamed token.
    const end = bottomRef.current;
    const scroller = end?.parentElement;
    const nearBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 240;
    const justSent = chat.messages[chat.messages.length - 1]?.role === "user";
    const key = routeThreadId ?? "";
    const firstView = chat.messages.length > 0 && scrolledFor.current !== key;
    if (firstView) {
      // Opening a conversation lands on its latest message, not its first.
      scrolledFor.current = key;
      end?.scrollIntoView({ behavior: "auto", block: "end" });
    } else if (nearBottom || justSent) end?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
  }, [chat.messages, chat.pending.length, reduceMotion, routeThreadId]);

  if (!enabled) return <Navigate to="/dashboard" replace />;

  const submit = () => {
    const text = input;
    if (!text.trim() || busy) return;
    setInput("");
    // A refused message (confirmation pending) goes back into the box instead of being lost.
    void chat.send(text).then((outcome) => { if (outcome === "blocked") setInput((current) => current || text); });
  };

  const threads = threadData?.threads ?? [];

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      await deleteThread.mutateAsync(target.id);
      if (String(target.id) === String(routeThreadId)) navigate("/chat");
    } catch {
      // useDeleteThread already showed the error.
    }
  };

  return (
    <DashboardLayout>
      <div className="relative flex gap-4 h-[calc(100dvh-11rem)] min-h-[480px] lg:h-[calc(100dvh-7rem)]">
        <aside id="chat-threads" aria-label="Conversations" className={cn("w-64 shrink-0 flex-col rounded-xl border border-border bg-card p-3 gap-2", showThreads ? "flex absolute z-20 inset-0 w-auto lg:static" : "hidden lg:flex")}>
          <Button size="sm" variant="glow" className="gap-1" onClick={() => { navigate("/chat"); setShowThreads(false); }}>
            <MessageSquarePlus className="h-4 w-4" /> New chat
          </Button>
          <div className="flex-1 overflow-y-auto space-y-1">
            {threadsLoading && <p className="text-xs text-foreground-muted p-2 flex items-center gap-2" aria-busy="true"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading conversations…</p>}
            {threadsFailed && <ErrorCard what="your conversations" onRetry={() => void refetchThreads()} retrying={threadsFetching} />}
            {!threadsLoading && !threadsFailed && threads.length === 0 && <p className="text-xs text-foreground-muted p-2">Your conversations will show up here.</p>}
            {threads.map((t) => (
              <div key={t.id} className={cn("group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm hover:bg-background-secondary", t.id === routeThreadId && "bg-background-secondary")}>
                <button type="button" aria-current={t.id === routeThreadId ? "page" : undefined} className="flex-1 truncate text-left" onClick={() => { navigate(`/chat/${t.id}`); setShowThreads(false); }}>{t.title}</button>
                <button
                  type="button"
                  aria-label={`Delete ${t.title}`}
                  className="p-1 text-foreground-muted hover:text-destructive-text [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus:opacity-100"
                  onClick={() => setPendingDelete({ id: t.id, title: t.title })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col rounded-xl border border-border bg-background-secondary/30">
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Button size="icon" variant="ghost" className="lg:hidden" aria-label={showThreads ? "Hide conversations" : "Show conversations"} aria-expanded={showThreads} aria-controls="chat-threads" onClick={() => setShowThreads((v) => !v)}><PanelLeft className="h-4 w-4" /></Button>
            <Bot className="h-5 w-5 text-primary-text" />
            <h1 className="font-heading font-semibold">Quest Assistant</h1>
            <span className="ml-auto text-[0.6875rem] text-foreground-muted hidden sm:inline">AI-generated. Changes always ask first.</span>
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Screen readers hear a reply once it is complete, not every streamed token. */}
            <div className="sr-only" role="status" aria-live="polite">{announced ?? ""}</div>
            {chat.historyLoading && (
              <p className="h-full flex items-center justify-center gap-2 text-sm text-foreground-muted" aria-busy="true">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading conversation…
              </p>
            )}
            {chat.historyFailed && <ErrorCard what="this conversation" onRetry={chat.retryHistory} />}
            {chat.messages.length === 0 && !chat.historyLoading && !chat.historyFailed && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-4">
                <Bot className="h-10 w-10 text-primary-text" />
                <div>
                  <p className="font-heading font-semibold">Ask about your quests or how TaskQuest works</p>
                  <p className="text-sm text-foreground-muted">I can also create or complete tasks, once you approve.</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" disabled={busy} onClick={() => void chat.send(s)} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:border-primary/50 disabled:opacity-50 disabled:pointer-events-none">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {chat.messages.map((m) => <ChatMessage key={m.id} message={m} />)}
            {waiting && slow && <p className="text-xs text-foreground-muted flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Waking up the AI… the first request can take a few seconds.</p>}
            {chat.notice && <p role="alert" className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground">{chat.notice}</p>}
            {chat.pending.length > 0 && <ConfirmActionCard actions={chat.pending} busy={chat.isStreaming} onRespond={chat.respond} />}
            <div ref={bottomRef} />
          </div>

          <form
            className="border-t border-border p-3 flex items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
          >
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              placeholder={chat.pending.length ? "Approve or cancel the change above first" : "Ask anything about your quests…"}
              rows={1}
              maxLength={2000}
              disabled={chat.pending.length > 0 || chat.historyLoading}
              className="resize-none min-h-[40px] max-h-32"
              aria-label="Message"
            />
            {chat.isStreaming ? (
              <Button type="button" variant="outline" size="icon" onClick={chat.stop} aria-label="Stop"><Square className="h-4 w-4" /></Button>
            ) : (
              <Button type="submit" size="icon" disabled={!input.trim() || chat.pending.length > 0} aria-label="Send"><Send className="h-4 w-4" /></Button>
            )}
          </form>
        </section>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete this conversation?"
        description={<p>"{pendingDelete?.title}" and its messages will be removed. This can't be undone.</p>}
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
      />
    </DashboardLayout>
  );
};

export default Chat;
