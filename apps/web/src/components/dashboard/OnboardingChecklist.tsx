import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Circle, PartyPopper, X } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KEY = "tq.onboarding.dismissed";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

interface Props {
  hasQuest: boolean;
  hasTask: boolean;
  claimedDaily: boolean;
  onClaimDaily: () => void;
  claiming: boolean;
}

/**
 * Three first steps for a new player, worked out from real data (so it is right on
 * every device and disappears by itself once it is done). It can be dismissed early.
 */
export const OnboardingChecklist = ({ hasQuest, hasTask, claimedDaily, onClaimDaily, claiming }: Props) => {
  const [dismissed, setDismissed] = useState(wasDismissed);
  const steps = [
    { done: hasQuest, label: "Create your first quest", hint: "A quest is a list of tasks.", action: <Link to="/tasks" className="text-primary-text underline-offset-4 hover:underline">Open Quest Log</Link> },
    { done: hasTask, label: "Add a task to it", hint: "Press n inside a quest, or type in quick add.", action: <Link to="/tasks" className="text-primary-text underline-offset-4 hover:underline">Add a task</Link> },
    { done: claimedDaily, label: "Claim your daily reward", hint: "Come back every day to build a streak.", action: <Button size="sm" variant="outline" onClick={onClaimDaily} disabled={claiming}>Claim now</Button> },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* storage blocked: it reappears next visit */
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label="Getting started"
      className="rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-6"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
            {allDone ? <PartyPopper className="h-5 w-5 text-xp" aria-hidden /> : null}
            {allDone ? "You're all set!" : "Get started"}
          </h2>
          <p className="text-sm text-foreground-muted">{allDone ? "You finished the first steps. Have fun out there." : `${doneCount} of ${steps.length} done`}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Dismiss getting started" onClick={dismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-background-tertiary" role="progressbar" aria-label="Getting started progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3">
            {step.done ? <Check className="h-5 w-5 shrink-0 text-success" aria-label="Done" /> : <Circle className="h-5 w-5 shrink-0 text-foreground-muted" aria-label="Not done yet" />}
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", step.done && "text-foreground-muted line-through")}>{step.label}</p>
              {!step.done && <p className="text-xs text-foreground-muted">{step.hint}</p>}
            </div>
            {!step.done && <div className="shrink-0 text-sm">{step.action}</div>}
          </li>
        ))}
      </ol>
      {allDone && (
        <div className="mt-4 text-right">
          <Button size="sm" onClick={dismiss}>Got it</Button>
        </div>
      )}
    </motion.section>
  );
};
