import { Sparkles } from "lucide-react";
import { SummarizeButton } from "./SummarizeButton";
import { useAuth } from "@/contexts/AuthContext";

/** Dashboard card: a daily briefing and a weekly recap, generated on demand. */
export function BriefingCard() {
  const { user } = useAuth();
  if (!user?.features?.ai) return null;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center"><Sparkles className="h-5 w-5 text-primary" /></div>
        <div>
          <h2 className="font-heading font-semibold text-sm sm:text-base">Today&apos;s briefing</h2>
          <p className="text-xs sm:text-sm text-foreground-muted">What is due, what is overdue, and where to start.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <SummarizeButton body={{ mode: "digest" }} label="Briefing" title="Today's briefing" />
        <SummarizeButton body={{ mode: "recap", range: "week" }} label="Weekly recap" title="Your week" />
      </div>
    </div>
  );
}
