import { useState } from "react";
import { Loader2, LogOut, Send, UserMinus, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { InvitePreview, ListInvite, ListMember } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { InviteConfirmDialog } from "@/components/feedback/InviteConfirmDialog";
import { useInviteMember, useInvitePreview, useLeaveList, useListMembers, useRemoveMember, useRevokeInvite, useSetMemberRole } from "@/hooks/useApi";
import {
  assignableRoles, canChangeRole, canLeaveList, canManageList, isAccessLost, remainingSlots, roleHint, roleLabel, rolesFor,
  type ListRole, type SharingFields,
} from "@/lib/sharing";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: number;
  listName: string;
  /** The server says the quest is gone or I was removed, or I just left it. */
  onAccessLost: () => void;
}

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

const RoleBadge = ({ role }: { role: ListRole }) => (
  <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", role === "manager" ? "border-primary/40 bg-primary/10 text-primary-text" : "border-border text-foreground-muted")}>
    {roleLabel(role)}
  </span>
);

const expiryText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `Expires ${d.toLocaleDateString()}`;
};

/** Who is on a quest and what they may do, plus (for managers) inviting people and withdrawing invitations. */
export const MembersDialog = ({ open, onOpenChange, listId, listName, onAccessLost }: Props) => {
  const membersQuery = useListMembers(listId, open);
  const data = membersQuery.data;
  const invite = useInviteMember(listId);
  const previewInvite = useInvitePreview(listId);
  const setRole = useSetMemberRole(listId);
  const removeMember = useRemoveMember(listId);
  const revoke = useRevokeInvite(listId);
  const leave = useLeaveList(listId);

  const [username, setUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<ListRole>("editor");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<InvitePreview | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [toRemove, setToRemove] = useState<ListMember | null>(null);

  const me: SharingFields = { role: data?.role, isOwner: data?.isOwner };
  const manage = data ? canManageList(data.role) : false;
  const roles = assignableRoles(me);
  const effectiveInviteRole = roles.includes(inviteRole) ? inviteRole : roles[roles.length - 1] ?? "viewer";
  const slots = data ? remainingSlots(data.limit, data.members.length, data.invites.length) : 0;

  const reportInviteError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 404 && /^list not found/i.test(error.message)) {
      onAccessLost();
      return;
    }
    setInviteError(error instanceof Error ? error.message : "Could not send the invitation.");
  };

  /** Step 1: ask who the username is and show them for confirmation. Nothing is sent yet. */
  const askWho = async () => {
    const name = username.trim();
    if (!name) return;
    setInviteError(null);
    try {
      setConfirming(await previewInvite.mutateAsync({ username: name, role: effectiveInviteRole }));
    } catch (error) {
      reportInviteError(error);
    }
  };

  /** Step 2: the inviter confirmed that is the person they meant. */
  const sendInvite = async () => {
    const name = username.trim();
    const who = confirming;
    setConfirming(null);
    if (!name) return;
    setInviteError(null);
    try {
      const result = await invite.mutateAsync({ username: name, role: effectiveInviteRole });
      toast.success(`Invited ${result.inviteeName ?? who?.name ?? name} as ${roleLabel(effectiveInviteRole).toLowerCase()}`);
      setUsername("");
    } catch (error) {
      reportInviteError(error);
    }
  };

  const doLeave = async () => {
    try {
      await leave.mutateAsync();
      setConfirmLeave(false);
      onOpenChange(false);
      toast.success(`You left "${listName}"`);
      onAccessLost();
    } catch {
      setConfirmLeave(false);
    }
  };

  const lost = membersQuery.isError && isAccessLost(membersQuery.error);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary-text" aria-hidden />Members</DialogTitle>
          <DialogDescription>Everyone who can open "{listName}". Each person earns their own XP for what they finish.</DialogDescription>
        </DialogHeader>

        {membersQuery.isError ? (
          lost ? (
            <div className="space-y-3">
              <ErrorCard what="the members" error={new Error("This quest was not found, or you no longer have access to it.")} hint="Go back to your quests." />
              <div className="text-center"><Button variant="outline" size="sm" onClick={() => { onOpenChange(false); onAccessLost(); }}>Back to Quests</Button></div>
            </div>
          ) : (
            <ErrorCard what="the members" error={membersQuery.error} onRetry={() => void membersQuery.refetch()} retrying={membersQuery.isFetching} />
          )
        ) : !data ? (
          <div className="space-y-2" aria-busy="true" aria-live="polite">
            {[0, 1, 2].map((n) => <div key={n} className="h-12 animate-pulse rounded-lg bg-background-secondary" />)}
          </div>
        ) : (
          <div className="space-y-6">
            <section aria-label="People on this quest">
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.members.map((m) => {
                  const editable = canChangeRole(me, m);
                  return (
                    <li key={m.memberKey} className="flex flex-wrap items-center gap-2 p-3" data-testid="member-row">
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {m.name ?? "Unknown adventurer"}
                        {m.isYou && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary-text">You</span>}
                        {m.isOwner && <span className="ml-2 text-xs font-normal text-foreground-muted">Owner</span>}
                      </span>
                      {editable ? (
                        <>
                          <label className="sr-only" htmlFor={`role-${m.memberKey}`}>Role of {m.name ?? "this member"}</label>
                          <select
                            id={`role-${m.memberKey}`}
                            className={selectClass}
                            value={m.role}
                            disabled={setRole.isPending}
                            onChange={(e) => setRole.mutate({ memberKey: m.memberKey, role: e.target.value as ListRole })}
                          >
                            {rolesFor(me, m).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                          </select>
                          <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10" aria-label={`Remove ${m.name ?? "member"}`} onClick={() => setToRemove(m)}>
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {manage && (
              <section aria-label="Invite someone" className="space-y-2">
                <h3 className="font-heading text-sm font-semibold">Invite someone</h3>
                {slots === 0 ? (
                  <p className="text-sm text-foreground-muted">This quest is full ({data.limit} people besides the owner, counting pending invitations).</p>
                ) : (
                  <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void askWho(); }}>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-40 flex-1">
                        <label htmlFor="invite-username" className="mb-1 block text-sm font-medium">Username</label>
                        <Input id="invite-username" value={username} maxLength={100} autoComplete="off" onChange={(e) => { setUsername(e.target.value); setInviteError(null); }} aria-describedby={inviteError ? "invite-error" : "invite-hint"} />
                      </div>
                      <div>
                        <label htmlFor="invite-role" className="mb-1 block text-sm font-medium">Role</label>
                        <select id="invite-role" className={selectClass} value={effectiveInviteRole} onChange={(e) => setInviteRole(e.target.value as ListRole)}>
                          {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                        </select>
                      </div>
                      <Button type="submit" disabled={invite.isPending || previewInvite.isPending || !username.trim()} className="gap-2">
                        {invite.isPending || previewInvite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" aria-hidden />} Invite
                      </Button>
                    </div>
                    {inviteError && <p id="invite-error" role="alert" className="text-sm text-destructive-text">{inviteError}</p>}
                    <p id="invite-hint" className="text-xs text-foreground-muted">
                      Type their exact Discord username (not their display name); you will be asked to confirm who it is. {roleHint(effectiveInviteRole)}. {slots} {slots === 1 ? "spot" : "spots"} left.
                    </p>
                  </form>
                )}
              </section>
            )}

            {manage && data.invites.length > 0 && (
              <section aria-label="Pending invitations" className="space-y-2">
                <h3 className="font-heading text-sm font-semibold">Pending invitations</h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {data.invites.map((inv: ListInvite) => (
                    <li key={inv.id} className="flex flex-wrap items-center gap-2 p-3" data-testid="invite-row">
                      <span className="min-w-0 flex-1 truncate">
                        {inv.inviteeName ?? "Unknown adventurer"}
                        <span className="ml-2 text-xs text-foreground-muted">{expiryText(inv.expiresAt)}</span>
                      </span>
                      <RoleBadge role={inv.role} />
                      <Button variant="ghost" size="sm" aria-label={`Withdraw invitation for ${inv.inviteeName ?? "this person"}`} disabled={revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {canLeaveList(me) && (
              <div className="border-t border-border pt-4">
                <Button variant="outline" className="gap-2 text-destructive-text hover:bg-destructive/10" onClick={() => setConfirmLeave(true)}>
                  <LogOut className="h-4 w-4" aria-hidden /> Leave list
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>

      <InviteConfirmDialog preview={confirming} target={`the quest "${listName}"`} onCancel={() => setConfirming(null)} onConfirm={() => void sendInvite()} />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave this quest?"
        description={<>You will lose access to "{listName}" until someone invites you again.</>}
        confirmLabel="Leave"
        onConfirm={() => void doLeave()}
      />
      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(o) => !o && setToRemove(null)}
        title="Remove this member?"
        description={<>{toRemove?.name ?? "This person"} will lose access to "{listName}".</>}
        confirmLabel="Remove"
        onConfirm={() => {
          if (toRemove) removeMember.mutate(toRemove.memberKey);
          setToRemove(null);
        }}
      />
    </Dialog>
  );
};
