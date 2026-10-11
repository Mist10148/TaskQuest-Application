import { useState } from "react";
import { Check, CheckCircle2, Crown, Gift, Loader2, LogOut, Mail, Send, Shield, Trash2, UserMinus, X } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { QueryState } from "@/components/feedback/QueryState";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { InviteConfirmDialog } from "@/components/feedback/InviteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useClaimParty, useCreateParty, useDisbandParty, useInvitePartyPreview, useInviteToParty, useKickPartyMember, useLeaveParty, useParty, useRespondToPartyInvite, useRevokePartyInvite,
} from "@/hooks/useApi";
import { useCountdown } from "@/hooks/useCountdown";
import { formatLongCountdown } from "@/lib/countdown";
import { canInvite, canKick, canLeave, ownShareLeft, progressPercent, remainingLabel, seatsLabel, seatsLeft } from "@/lib/party";
import { shortDate } from "@/lib/stats";
import { INVITE_NEUTRAL_MESSAGE, type InvitePreview, type MyPartyInvite, type PartyMember, type PartyStatus } from "@/lib/api";

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const expiryText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `Expires ${d.toLocaleDateString()}`;
};

/** Invitations other people sent me. Renders nothing when there are none. */
const PartyInvites = ({ invites }: { invites: MyPartyInvite[] }) => {
  const respond = useRespondToPartyInvite();
  if (invites.length === 0) return null;
  const answer = (invite: MyPartyInvite, accept: boolean) =>
    respond.mutate(
      { id: invite.id, accept },
      { onSuccess: () => toast.success(accept ? `🤝 You joined "${invite.partyName}"` : `Declined the invitation to "${invite.partyName}"`) }
    );
  return (
    <section aria-label="Party invitations" className="rounded-xl border border-primary/40 bg-primary/5">
      <h2 className="flex items-center gap-2 px-3 pt-3 font-heading text-sm font-semibold">
        <Mail className="h-4 w-4 text-primary-text" aria-hidden /> Invitations ({invites.length})
      </h2>
      <ul className="divide-y divide-border">
        {invites.map((invite) => {
          const busy = respond.isPending && respond.variables?.id === invite.id;
          return (
            <li key={invite.id} className="flex flex-wrap items-center gap-3 p-3" data-testid="party-invite">
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{invite.ownerName ?? "Someone"}</span> invited you to the party{" "}
                <span className="font-medium">{invite.partyName}</span>
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="gap-1" disabled={busy} onClick={() => answer(invite, true)} aria-label={`Accept invitation to ${invite.partyName}`}>
                  <Check className="h-4 w-4" aria-hidden /> Accept
                </Button>
                <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => answer(invite, false)} aria-label={`Decline invitation to ${invite.partyName}`}>
                  <X className="h-4 w-4" aria-hidden /> Decline
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const CreateParty = () => {
  const create = useCreateParty();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await create.mutateAsync(trimmed);
      toast.success(`🛡️ Party "${trimmed}" created`);
      setName("");
    } catch (e) {
      setError(errorText(e, "Could not create the party."));
    }
  };

  return (
    <section aria-label="Start a party" className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <Shield className="mb-2 h-8 w-8 text-primary-text" aria-hidden />
      <h2 className="font-heading text-lg font-semibold">Start a party</h2>
      <p className="mt-1 text-sm text-foreground-muted">
        Team up with up to 5 friends. Together you finish a weekly quest and every member earns a bonus.
      </p>
      <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label htmlFor="party-name" className="mb-1 block text-sm font-medium">Party name</label>
            <Input id="party-name" value={name} maxLength={40} autoComplete="off" onChange={(e) => { setName(e.target.value); setError(null); }} aria-describedby={error ? "party-name-error" : undefined} />
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()} className="gap-2">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Shield className="h-4 w-4" aria-hidden />} Create party
          </Button>
        </div>
        {error && <p id="party-name-error" role="alert" className="text-sm text-destructive-text">{error}</p>}
      </form>
    </section>
  );
};

const RulesNote = ({ status }: { status: PartyStatus }) => (
  <p className="text-xs text-foreground-muted">
    A party has up to {status.limit} people, owner included, and you can be in one at a time. The target is {status.perMember} tasks for each member who
    finished at least one task this week; each member&apos;s first {status.perMember} task completions since joining count towards it, and you need at
    least {status.minToClaim} of your own to claim the reward. The week resets on Monday 00:00 UTC. Members see names and this week&apos;s counts only.
  </p>
);

const InviteForm = ({ seats, partyName }: { seats: number; partyName: string }) => {
  const invite = useInviteToParty();
  const previewInvite = useInvitePartyPreview();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<InvitePreview | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** Step 1: ask who the username is and show them for confirmation. Nothing is sent yet. */
  const askWho = async () => {
    const name = username.trim();
    if (!name) return;
    setError(null);
    setNote(null);
    try {
      const who = await previewInvite.mutateAsync(name);
      if (who.name === null) setNote(INVITE_NEUTRAL_MESSAGE);
      else setConfirming(who);
    } catch (e) {
      setError(errorText(e, "Could not send the invitation."));
    }
  };

  /** Step 2: the owner confirmed that is the person they meant. */
  const send = async () => {
    const name = username.trim();
    setConfirming(null);
    if (!name) return;
    setError(null);
    try {
      const result = await invite.mutateAsync(name);
      toast.success(result.message);
      setUsername("");
    } catch (e) {
      setError(errorText(e, "Could not send the invitation."));
    }
  };

  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void askWho(); }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor="party-invite-username" className="mb-1 block text-sm font-medium">Username</label>
          <Input id="party-invite-username" value={username} maxLength={100} autoComplete="off" onChange={(e) => { setUsername(e.target.value); setError(null); setNote(null); }} aria-describedby={error ? "party-invite-error" : "party-invite-hint"} />
        </div>
        <Button type="submit" disabled={invite.isPending || previewInvite.isPending || !username.trim()} className="gap-2">
          {invite.isPending || previewInvite.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Invite
        </Button>
      </div>
      {note && <p role="status" className="text-sm text-foreground-muted">{note}</p>}
      {error && <p id="party-invite-error" role="alert" className="text-sm text-destructive-text">{error}</p>}
      <InviteConfirmDialog preview={confirming} target={`the party "${partyName}"`} onCancel={() => setConfirming(null)} onConfirm={() => void send()} />
      <p id="party-invite-hint" className="text-xs text-foreground-muted">
        Type their exact Discord username (not their display name); you will be asked to confirm who it is. {seats} {seats === 1 ? "seat" : "seats"} left.
      </p>
    </form>
  );
};

const PartyCard = ({ status }: { status: PartyStatus }) => {
  const claim = useClaimParty();
  const revoke = useRevokePartyInvite();
  const leave = useLeaveParty();
  const kick = useKickPartyMember();
  const disband = useDisbandParty();
  const [toKick, setToKick] = useState<PartyMember | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDisband, setConfirmDisband] = useState(false);
  const left = useCountdown(Date.parse(status.resetsAt), 60_000);

  const isOwner = status.party.isOwner;
  const invites = status.invites ?? [];
  const seats = seatsLeft(status.limit, status.members.length, invites.length);
  const percent = progressPercent(status.progress, status.target);

  const hint = status.claimed
    ? "You claimed this week's party reward. A new quest opens on Monday."
    : status.claimable
      ? "Target reached! Claim your reward before the week resets."
      : status.reached
        ? `Target reached, but you need ${status.minToClaim} tasks of your own to claim (${ownShareLeft(status.yourCount, status.minToClaim)} to go).`
        : `Finish tasks together: ${remainingLabel(status.progress, status.target).toLowerCase()}.`;

  return (
    <div className="space-y-4">
      <section aria-label="Weekly party quest" className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold" data-testid="party-name">{status.party.name}</h2>
          <p className="text-sm text-foreground-muted">Reward: +{status.reward} XP each</p>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium" data-testid="party-progress">{status.progress} / {status.target} tasks</span>
            <span className="text-foreground-muted">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Party weekly quest progress"
            aria-valuemin={0}
            aria-valuemax={status.target}
            aria-valuenow={Math.min(status.progress, status.target)}
            className="h-3 overflow-hidden rounded-full bg-background-secondary"
          >
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <p className="mt-3 text-sm text-foreground-muted">{hint}</p>
        <div className="mt-4">
          {status.claimed ? (
            <p className="inline-flex items-center gap-2 font-medium text-success" role="status">
              <CheckCircle2 className="h-5 w-5" aria-hidden /> Claimed
            </p>
          ) : (
            <Button className="gap-2" disabled={!status.claimable || claim.isPending} onClick={() => claim.mutate()}>
              {claim.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Gift className="h-4 w-4" aria-hidden />}
              Claim party reward
            </Button>
          )}
        </div>
        <p className="mt-4 text-xs text-foreground-muted">
          Week of {shortDate(status.weekStart)} · resets in {formatLongCountdown(left)} (Monday 00:00 UTC)
        </p>
      </section>

      <section aria-label="Party members" className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <h2 className="mb-3 font-heading text-sm font-semibold">
          Members <span className="font-normal text-foreground-muted">({seatsLabel(status.members.length, status.limit)})</span>
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {status.members.map((m) => (
            <li key={m.memberKey} className="flex flex-wrap items-center gap-2 p-3" data-testid="party-member">
              <span className="min-w-0 flex-1 truncate font-medium">
                {m.isOwner && <Crown className="mr-1.5 inline h-4 w-4 text-xp" aria-label="Owner" />}
                {m.name ?? "Unknown adventurer"}
                {m.isYou && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary-text">You</span>}
              </span>
              <span className="text-sm text-foreground-muted" aria-label={`${m.count} of ${status.perMember} tasks`}>{m.count} / {status.perMember}</span>
              {canKick(isOwner, m) && (
                <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10" aria-label={`Remove ${m.name ?? "member"} from the party`} onClick={() => setToKick(m)}>
                  <UserMinus className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <section aria-label="Invite someone" className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-6">
          <h2 className="font-heading text-sm font-semibold">Invite someone</h2>
          {canInvite(isOwner, seats) ? (
            <InviteForm seats={seats} partyName={status.party.name} />
          ) : (
            <p className="text-sm text-foreground-muted">The party is full ({status.limit} people, counting pending invitations).</p>
          )}
          {invites.length > 0 && (
            <div aria-label="Pending invitations" role="group" className="space-y-2">
              <h3 className="text-sm font-medium">Pending invitations</h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {invites.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-2 p-3" data-testid="party-pending-invite">
                    <span className="min-w-0 flex-1 truncate">
                      {inv.inviteeName ?? "Unknown adventurer"}
                      <span className="ml-2 text-xs text-foreground-muted">{expiryText(inv.expiresAt)}</span>
                    </span>
                    <Button variant="ghost" size="sm" aria-label={`Withdraw invitation for ${inv.inviteeName ?? "this person"}`} disabled={revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <RulesNote status={status} />

      <div className="border-t border-border pt-4">
        {canLeave(isOwner) ? (
          <Button variant="outline" className="gap-2 text-destructive-text hover:bg-destructive/10" onClick={() => setConfirmLeave(true)}>
            <LogOut className="h-4 w-4" aria-hidden /> Leave party
          </Button>
        ) : (
          <Button variant="outline" className="gap-2 text-destructive-text hover:bg-destructive/10" onClick={() => setConfirmDisband(true)}>
            <Trash2 className="h-4 w-4" aria-hidden /> Disband party
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={toKick !== null}
        onOpenChange={(o) => !o && setToKick(null)}
        title="Remove this member?"
        description={<>{toKick?.name ?? "This person"} will leave "{status.party.name}" and their count stops adding to its quest. You can invite them again later.</>}
        confirmLabel="Remove"
        onConfirm={() => {
          if (toKick) kick.mutate(toKick.memberKey, { onSuccess: () => toast.success(`${toKick.name ?? "The member"} was removed`) });
          setToKick(null);
        }}
      />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave this party?"
        description={<>You will leave "{status.party.name}" and your count stops adding to its quest. Someone has to invite you again to rejoin.</>}
        confirmLabel="Leave"
        onConfirm={() => leave.mutate(undefined, { onSuccess: () => toast.success(`You left "${status.party.name}"`) })}
      />
      <ConfirmDialog
        open={confirmDisband}
        onOpenChange={setConfirmDisband}
        title="Disband this party?"
        description={<>"{status.party.name}" will be deleted for everyone, including its pending invitations. This cannot be undone.</>}
        confirmLabel="Disband"
        onConfirm={() => disband.mutate(undefined, { onSuccess: () => toast.success(`"${status.party.name}" was disbanded`) })}
      />
    </div>
  );
};

const Party = () => {
  const party = useParty();
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-4 sm:space-y-6">
        <header>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-bold sm:text-3xl">
            <Shield className="h-6 w-6 text-primary-text sm:h-7 sm:w-7" aria-hidden /> Party
          </h1>
          <p className="text-sm text-foreground-muted">Team up for a shared weekly quest and earn a bonus together.</p>
        </header>
        <QueryState query={party} what="your party" skeleton={<div className="h-64 animate-pulse rounded-xl bg-card/50" aria-busy="true" />}>
          {(data) =>
            data.party ? (
              <PartyCard status={data.party} />
            ) : (
              <div className="space-y-4">
                <PartyInvites invites={data.invites} />
                <CreateParty />
              </div>
            )
          }
        </QueryState>
      </div>
    </DashboardLayout>
  );
};

export default Party;
