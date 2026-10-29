import { useState } from "react";
import { Check, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMyInvites, useRespondToInvite } from "@/hooks/useApi";
import { roleLabel } from "@/lib/sharing";
import type { MyInvite } from "@/lib/api";

const Row = ({ invite, busy, onAnswer }: { invite: MyInvite; busy: boolean; onAnswer: (invite: MyInvite, accept: boolean) => void }) => {
  const from = invite.invitedByName ?? invite.ownerName ?? "Someone";
  return (
    <li className="flex flex-wrap items-center gap-3 p-3" data-testid="invite">
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{from}</span> invited you to <span className="font-medium">{invite.listName}</span>
        <span className="text-foreground-muted"> as {roleLabel(invite.role).toLowerCase()}</span>
        {invite.ownerName && invite.ownerName !== from && <span className="text-foreground-muted"> (owned by {invite.ownerName})</span>}
      </p>
      <div className="flex gap-2">
        <Button size="sm" className="gap-1" disabled={busy} onClick={() => onAnswer(invite, true)} aria-label={`Accept invitation to ${invite.listName}`}>
          <Check className="h-4 w-4" aria-hidden /> Accept
        </Button>
        <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => onAnswer(invite, false)} aria-label={`Decline invitation to ${invite.listName}`}>
          <X className="h-4 w-4" aria-hidden /> Decline
        </Button>
      </div>
    </li>
  );
};

/** Quests other people invited me to. Renders nothing when there are none (or the lookup failed: the quest log still works). */
export const InvitesBanner = () => {
  const { data } = useMyInvites();
  const respond = useRespondToInvite();
  // Each answer is tracked by itself: a mutation's `variables` and per-call callbacks follow only the latest call, so with
  // two answers in flight the first one's buttons came back on and its toast was lost.
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  if (!data || data.length === 0) return null;

  const answer = (invite: MyInvite, accept: boolean) => {
    if (busy.has(invite.id)) return;
    setBusy((ids) => new Set(ids).add(invite.id));
    respond
      .mutateAsync({ id: invite.id, accept })
      .then(() => toast.success(accept ? `🤝 You joined "${invite.listName}"` : `Declined the invitation to "${invite.listName}"`))
      .catch(() => { /* error toast shown by the mutation hook */ })
      .finally(() => setBusy((ids) => { const next = new Set(ids); next.delete(invite.id); return next; }));
  };

  return (
    <section aria-label="Quest invitations" className="mb-6 rounded-xl border border-primary/40 bg-primary/5">
      <h2 className="flex items-center gap-2 px-3 pt-3 font-heading text-sm font-semibold">
        <Mail className="h-4 w-4 text-primary-text" aria-hidden /> Invitations ({data.length})
      </h2>
      <ul className="divide-y divide-border">
        {data.map((invite) => (
          <Row key={invite.id} invite={invite} busy={busy.has(invite.id)} onAnswer={answer} />
        ))}
      </ul>
    </section>
  );
};
