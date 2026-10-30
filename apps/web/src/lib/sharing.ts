/**
 * Permission rules for shared lists, mirrored from the server (which always has the last word: it answers 403 or 404
 * when a rule is broken). The UI uses them to hide controls a person cannot use. A list of my own that has no sharing
 * fields yet (just created, not refetched) counts as mine with the manager role.
 */

export type ListRole = "viewer" | "editor" | "manager";

export const LIST_ROLES: readonly ListRole[] = ["viewer", "editor", "manager"];

/** The sharing fields every list carries. All optional so lists created in this session (before a refetch) still type-check. */
export interface SharingFields {
  shared?: boolean;
  role?: ListRole;
  isOwner?: boolean;
  ownerName?: string | null;
  memberCount?: number;
}

export interface MemberLike {
  memberKey: string;
  role: ListRole;
  isOwner: boolean;
  isYou: boolean;
}

const ROLE_LABEL: Record<ListRole, string> = { viewer: "Viewer", editor: "Editor", manager: "Manager" };
const ROLE_HINT: Record<ListRole, string> = {
  viewer: "Can read the quest",
  editor: "Can add, edit, reorder and complete tasks, and delete the ones they added",
  manager: "Can also edit the quest and manage members",
};

export const roleLabel = (role: ListRole | undefined | null): string => (role ? ROLE_LABEL[role] : ROLE_LABEL.manager);
export const roleHint = (role: ListRole): string => ROLE_HINT[role];

export const roleOf = (list: SharingFields): ListRole => list.role ?? "manager";
export const isOwner = (list: SharingFields): boolean => list.isOwner ?? true;

/** Add, edit, reorder and complete tasks (and delete the ones you added; managers delete any). */
export const canEditTasks = (role: ListRole | undefined | null): boolean => role !== "viewer";

/** Edit the quest's own fields, invite people and remove members. */
export const canManageList = (role: ListRole | undefined | null): boolean => !role || role === "manager";

/** Only the owner can delete the quest. */
export const canDeleteList = (list: SharingFields): boolean => isOwner(list);

/** Everybody but the owner can leave; the owner deletes instead. */
export const canLeaveList = (list: SharingFields): boolean => !isOwner(list);

/** Only the owner promotes someone to manager (invites included) or demotes a manager. */
export const canInviteRole = (viewer: SharingFields, role: ListRole): boolean =>
  canManageList(roleOf(viewer)) && (role !== "manager" || isOwner(viewer));

export const assignableRoles = (viewer: SharingFields): ListRole[] => LIST_ROLES.filter((r) => canInviteRole(viewer, r));

/**
 * Whether the viewer may change this member's role or remove them. Never the owner or yourself; managers cannot touch other
 * managers, only the owner can.
 */
export function canChangeRole(viewer: SharingFields, target: MemberLike): boolean {
  if (target.isOwner || target.isYou) return false;
  if (!canManageList(roleOf(viewer))) return false;
  return isOwner(viewer) || target.role !== "manager";
}

/** Roles the viewer may set on this member (the select's options). */
export const rolesFor = (viewer: SharingFields, target: MemberLike): ListRole[] =>
  canChangeRole(viewer, target) ? LIST_ROLES.filter((r) => r !== "manager" || isOwner(viewer)) : [];

/** People still invitable: the limit counts members and pending invitations besides the owner. */
export function remainingSlots(limit: number, memberCount: number, pendingInvites: number): number {
  return Math.max(0, limit - Math.max(0, memberCount - 1) - pendingInvites);
}

/** Short text for a card: what I may do on a list shared with me, or that I share it. */
export function sharedSubtitle(list: SharingFields): string | null {
  if (!list.shared) return null;
  if (isOwner(list)) return "Shared by you";
  return `${roleLabel(roleOf(list))}${list.ownerName ? ` · by ${list.ownerName}` : ""}`;
}

export const peopleLabel = (count: number | undefined): string => {
  const n = count ?? 1;
  return `${n} ${n === 1 ? "person" : "people"}`;
};

/** An error that means "you are no longer allowed here": the quest was unshared, you were removed, or it was deleted. */
export const isAccessLost = (error: unknown): boolean => {
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: number }).status : undefined;
  return status === 404 || status === 403;
};

/** The largest id the database stores (a Postgres INTEGER); the server rejects anything bigger with a 400. */
export const MAX_ID = 2147483647;

/** A quest or task id from the URL: a plain positive whole number in the database's range, otherwise null. */
export function idFromParam(value: string | null): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 && n <= MAX_ID ? n : null;
}
