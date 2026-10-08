import { Check, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiConfirmAction } from "@/lib/api";

interface Props {
  actions: AiConfirmAction[];
  busy?: boolean;
  onRespond: (approved: boolean) => void;
}

/** The assistant wants to change something. Nothing happens until the user approves here. */
export function ConfirmActionCard({ actions, busy, onRespond }: Props) {
  return (
    <div role="alertdialog" aria-label="Confirm assistant action" className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldQuestion className="h-4 w-4 text-primary" />
        {actions.length > 1 ? "The assistant would like to make these changes" : "The assistant would like to make this change"}
      </div>
      <ul className="space-y-1.5 text-sm">
        {actions.map((a) => (
          <li key={a.id} className="rounded-lg bg-card border border-border px-3 py-2">{a.preview}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onRespond(true)} disabled={busy} className="gap-1"><Check className="h-4 w-4" /> Approve</Button>
        <Button size="sm" variant="outline" onClick={() => onRespond(false)} disabled={busy} className="gap-1"><X className="h-4 w-4" /> Cancel</Button>
      </div>
    </div>
  );
}
