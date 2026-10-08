import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSummary } from "@/hooks/useApi";
import { useAuth } from "@/contexts/AuthContext";
import type { aiApi } from "@/lib/api";
import { SummaryCard } from "./SummaryCard";
import { useSlow } from "./useSlow";

type SummaryBody = Parameters<typeof aiApi.summary>[0];

interface Props {
  body: SummaryBody;
  label?: string;
  title?: string;
  size?: "sm" | "default";
}

/** "Summarize" button: runs the summarizer on click and shows the result in a dialog. Hidden when AI is off. */
export function SummarizeButton({ body, label = "Summarize", title = "Summary", size = "sm" }: Props) {
  const { user } = useAuth();
  const summary = useSummary();
  const [open, setOpen] = useState(false);
  const slow = useSlow(summary.isPending);

  if (!user?.features?.ai) return null;

  const run = () => {
    setOpen(true);
    summary.mutate(body);
  };

  return (
    <>
      <Button variant="outline" size={size} onClick={run} className="gap-1">
        <Sparkles className="h-4 w-4 text-primary" /> <span className="hidden sm:inline">{label}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> {title}</DialogTitle>
          </DialogHeader>
          {summary.isPending && (
            <div className="py-8 text-center text-sm text-foreground-muted">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-primary" />
              {slow ? "Waking up the AI… the first request can take a few seconds." : "Reading your quests…"}
            </div>
          )}
          {summary.isError && <p className="py-6 text-sm text-destructive">{(summary.error as Error).message}</p>}
          {summary.data && <SummaryCard summary={summary.data} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
