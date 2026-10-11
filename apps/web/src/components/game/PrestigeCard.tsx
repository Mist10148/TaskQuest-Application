import { useState } from "react";
import { Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { useDoPrestige, usePrestigeStatus } from "@/hooks/useApi";
import { PRESTIGE_CONFIRM, isPrestigeConfirmation } from "@/lib/prestige";

const LOST = ["Your XP balance", "Your classes (you can buy them again)", "Your skills and skill points spent", "Your streak freezes", "Your level (you start again at level 1)"];
const KEPT = ["Your achievements", "Your quest and review claims", "Your lists and tasks", "Your daily streak"];

/** Profile card: prestige level, bonus, next title and the guarded "start over" button. */
export const PrestigeCard = ({ gamificationOn }: { gamificationOn: boolean }) => {
  const { data, isError, error, refetch, isFetching } = usePrestigeStatus();
  const prestige = useDoPrestige();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (isError) return <ErrorCard what="your prestige" error={error} onRetry={() => void refetch()} retrying={isFetching} />;
  if (!data) return <div className="mb-6 h-32 animate-pulse rounded-xl bg-card/50" aria-busy="true" />;

  const maxed = data.prestige >= data.max;
  const canStart = data.eligible && !maxed && gamificationOn;
  const reason = maxed
    ? "You reached the highest prestige."
    : !gamificationOn
      ? "Turn XP on in Settings to prestige."
      : data.eligible
        ? "You can start over now."
        : `Reach level ${data.minLevel} to prestige (you are level ${data.level}).`;

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) setText("");
  };

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="prestige-heading" data-testid="prestige-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="prestige-heading" className="flex items-center gap-2 font-heading text-base font-semibold sm:text-lg">
            <Star className="h-4 w-4 text-xp sm:h-5 sm:w-5" aria-hidden /> Prestige
          </h2>
          <p className="mt-1 text-sm">
            {data.prestige > 0 ? (
              <>
                <span className="font-semibold">{data.title}</span> · prestige {data.prestige} of {data.max} ·{" "}
                <span className="font-semibold text-xp">+{data.bonusPercent}% XP</span> forever
              </>
            ) : (
              <>No prestige yet. Each one gives a permanent +{data.nextBonusPercent ?? 2}% XP and a title.</>
            )}
          </p>
          <p className="mt-1 text-xs text-foreground-muted">
            {data.nextTitle ? `Next: ${data.nextTitle} (+${data.nextBonusPercent}% XP). ` : ""}
            {reason}
          </p>
        </div>
        <Button variant="outline" disabled={!canStart} onClick={() => setOpen(true)}>Start over…</Button>
      </div>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Prestige and start over?</DialogTitle>
            <DialogDescription>
              You become {data.nextTitle ?? "a legend"} with a permanent +{data.nextBonusPercent ?? data.bonusPercent}% XP bonus. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-1 font-semibold text-destructive-text">You lose</p>
              <ul className="list-disc space-y-0.5 pl-4 text-foreground-muted">{LOST.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
            <div>
              <p className="mb-1 font-semibold text-success">You keep</p>
              <ul className="list-disc space-y-0.5 pl-4 text-foreground-muted">{KEPT.map((k) => <li key={k}>{k}</li>)}</ul>
            </div>
          </div>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (isPrestigeConfirmation(text)) prestige.mutate(undefined, { onSuccess: () => close(false) });
            }}
          >
            <div>
              <label htmlFor="prestige-confirm" className="mb-1 block text-sm">Type {PRESTIGE_CONFIRM} to confirm</label>
              <Input id="prestige-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" disabled={!isPrestigeConfirmation(text) || prestige.isPending} className="gap-2">
                {prestige.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Prestige
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
};
