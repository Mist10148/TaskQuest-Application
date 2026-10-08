import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Bot, Loader2, MessageSquarePlus, PanelLeft, Send, Square, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessage } from "@/components/ai/ChatMessage";
import { ConfirmActionCard } from "@/components/ai/ConfirmActionCard";
import { useSlow } from "@/components/ai/useSlow";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/hooks/useChat";
import { useChatThreads, useDeleteThread } from "@/hooks/useApi";
import { cn } from "@/lib/utils";

const SUGGESTIONS = ["What should I do first today?", "What is due this week?", "How do I earn XP?", "Add a task to my newest quest"];

const Chat = () => {
  const { user } = useAuth();
  const { threadId: routeThreadId } = useParams();
  const navigate = useNavigate();
  const enabled = Boolean(user?.features?.ai);
  const { data: threadData } = useChatThreads(enabled);
  const deleteThread = useDeleteThread();
  const chat = useChat(routeThreadId ?? null);
  const [input, setInput] = useState("");
  const [showThreads, setShowThreads] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const waiting = chat.isStreaming && !chat.messages[chat.messages.length - 1]?.text;
  const slow = useSlow(waiting);

  // A brand-new conversation gets its id when the first turn ends; reflect it in the URL.
  useEffect(() => {
    if (chat.threadId && chat.threadId !== routeThreadId && !chat.isStreaming) navigate(`/chat/${chat.threadId}`, { replace: true });
  }, [chat.threadId, chat.isStreaming, routeThreadId, navigate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.messages, chat.pending.length]);

  if (!enabled) return <Navigate to="/dashboard" replace />;

  const submit = () => {
    const text = input;
    if (!text.trim()) return;
    setInput("");
    chat.send(text);
  };

  const threads = threadData?.threads ?? [];

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-0 flex gap-4 h-[calc(100vh-7rem)] min-h-[480px]">
        <aside className={cn("w-64 shrink-0 flex-col rounded-xl border border-border bg-card p-3 gap-2", showThreads ? "flex absolute z-20 inset-x-4 top-20 bottom-4 w-auto lg:static" : "hidden lg:flex")}>
          <Button size="sm" variant="glow" className="gap-1" onClick={() => { navigate("/chat"); setShowThreads(false); }}>
            <MessageSquarePlus className="h-4 w-4" /> New chat
          </Button>
          <div className="flex-1 overflow-y-auto space-y-1">
            {threads.length === 0 && <p className="text-xs text-foreground-muted p-2">Your conversations will show up here.</p>}
            {threads.map((t) => (
              <div key={t.id} className={cn("group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm hover:bg-background-secondary", t.id === routeThreadId && "bg-background-secondary")}>
                <button type="button" className="flex-1 truncate text-left" onClick={() => { navigate(`/chat/${t.id}`); setShowThreads(false); }}>{t.title}</button>
                <button
                  type="button"
                  aria-label={`Delete ${t.title}`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-foreground-muted hover:text-destructive"
                  onClick={async () => {
                    await deleteThread.mutateAsync(t.id);
                    if (t.id === routeThreadId) navigate("/chat");
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex-1 min-w-0 flex flex-col rounded-xl border border-border bg-background-secondary/30">
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Button size="icon" variant="ghost" className="lg:hidden" aria-label="Show conversations" onClick={() => setShowThreads((v) => !v)}><PanelLeft className="h-4 w-4" /></Button>
            <Bot className="h-5 w-5 text-primary" />
            <h1 className="font-heading font-semibold">Quest Assistant</h1>
            <span className="ml-auto text-[11px] text-foreground-muted hidden sm:inline">AI-generated. Changes always ask first.</span>
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-4" aria-live="polite">
            {chat.messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-4">
                <Bot className="h-10 w-10 text-primary" />
                <div>
                  <p className="font-heading font-semibold">Ask about your quests or how TaskQuest works</p>
                  <p className="text-sm text-foreground-muted">I can also create or complete tasks, once you approve.</p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => chat.send(s)} className="text-xs px-3 py-1.5 rounded-full border border-border bg-card hover:border-primary/50">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {chat.messages.map((m) => <ChatMessage key={m.id} message={m} />)}
            {waiting && slow && <p className="text-xs text-foreground-muted flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Waking up the AI… the first request can take a few seconds.</p>}
            {chat.pending.length > 0 && <ConfirmActionCard actions={chat.pending} busy={chat.isStreaming} onRespond={chat.respond} />}
            <div ref={bottomRef} />
          </div>

          <form
            className="border-t border-border p-3 flex items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder={chat.pending.length ? "Approve or cancel the change above first" : "Ask anything about your quests…"}
              rows={1}
              maxLength={2000}
              disabled={chat.pending.length > 0}
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
    </DashboardLayout>
  );
};

export default Chat;
