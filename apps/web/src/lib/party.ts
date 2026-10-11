/**
 * Pure helpers for the party page. The server owns every rule (it answers 400/403/409 when one is broken); the UI uses
 * these to size the progress bar and to hide controls a person cannot use.
 */

/** Share of the weekly target done, 0-100 and whole percent. A zero or invalid target counts as 0. */
export function progressPercent(progress: number, target: number): number {
  if (!(target > 0) || !(progress > 0)) return 0;
  return Math.min(100, Math.floor((progress / target) * 100));
}

/** Seats still open: the limit counts the owner, members and pending invitations. */
export function seatsLeft(limit: number, memberCount: number, pendingInvites: number): number {
  return Math.max(0, limit - Math.max(0, memberCount) - Math.max(0, pendingInvites));
}

/** Only the owner invites, and only while a seat is free. */
export function canInvite(isOwner: boolean, seats: number): boolean {
  return isOwner && seats > 0;
}

/** Everybody but the owner leaves; the owner disbands instead. */
export const canLeave = (isOwner: boolean): boolean => !isOwner;

/** "2 of 6 seats taken" style label for the member list heading. */
export function seatsLabel(memberCount: number, limit: number): string {
  return `${memberCount} of ${limit} seats`;
}

/** "3 left" / "Done" caption under the progress bar. */
export function remainingLabel(progress: number, target: number): string {
  const left = Math.max(0, target - progress);
  return left === 0 ? "Target reached" : `${left} to go`;
}
