import { describe, expect, it } from "vitest";
import {
  assignableRoles, canChangeRole, canDeleteList, canEditTasks, canInviteRole, canLeaveList, canManageList, isAccessLost,
  peopleLabel, remainingSlots, rolesFor, roleLabel, sharedSubtitle, type MemberLike, type SharingFields,
} from "./sharing";

const own: SharingFields = { shared: false, role: "manager", isOwner: true, memberCount: 1 };
const asManager: SharingFields = { shared: true, role: "manager", isOwner: false, ownerName: "Ava", memberCount: 3 };
const asEditor: SharingFields = { shared: true, role: "editor", isOwner: false, ownerName: "Ava", memberCount: 3 };
const asViewer: SharingFields = { shared: true, role: "viewer", isOwner: false, ownerName: "Ava", memberCount: 3 };
const member = (role: MemberLike["role"], extra: Partial<MemberLike> = {}): MemberLike => ({ memberKey: "abc123abc123", role, isOwner: false, isYou: false, ...extra });

describe("task and list permissions", () => {
  it("only viewers cannot edit tasks", () => {
    expect(canEditTasks("viewer")).toBe(false);
    expect(canEditTasks("editor")).toBe(true);
    expect(canEditTasks("manager")).toBe(true);
  });
  it("only managers (and the owner) manage the list", () => {
    expect(canManageList("manager")).toBe(true);
    expect(canManageList("editor")).toBe(false);
    expect(canManageList("viewer")).toBe(false);
    expect(canManageList(undefined)).toBe(true);
  });
  it("only the owner deletes; everyone else may leave", () => {
    expect(canDeleteList(own)).toBe(true);
    expect(canDeleteList(asManager)).toBe(false);
    expect(canLeaveList(own)).toBe(false);
    expect(canLeaveList(asEditor)).toBe(true);
  });
  it("treats a list without sharing fields as my own", () => {
    expect(canDeleteList({})).toBe(true);
    expect(canManageList(undefined)).toBe(true);
  });
});

describe("member management", () => {
  it("the owner can change any non-owner member, a manager only non-managers", () => {
    expect(canChangeRole(own, member("manager"))).toBe(true);
    expect(canChangeRole(own, member("viewer"))).toBe(true);
    expect(canChangeRole(asManager, member("manager"))).toBe(false);
    expect(canChangeRole(asManager, member("editor"))).toBe(true);
  });
  it("nobody changes the owner or themselves, and editors and viewers change nobody", () => {
    expect(canChangeRole(own, member("manager", { isOwner: true }))).toBe(false);
    expect(canChangeRole(asManager, member("editor", { isYou: true }))).toBe(false);
    expect(canChangeRole(asEditor, member("viewer"))).toBe(false);
    expect(canChangeRole(asViewer, member("viewer"))).toBe(false);
  });
  it("only the owner can hand out the manager role", () => {
    expect(rolesFor(own, member("viewer"))).toEqual(["viewer", "editor", "manager"]);
    expect(rolesFor(asManager, member("viewer"))).toEqual(["viewer", "editor"]);
    expect(rolesFor(asManager, member("manager"))).toEqual([]);
    expect(canInviteRole(asManager, "manager")).toBe(false);
    expect(canInviteRole(asManager, "editor")).toBe(true);
    expect(canInviteRole(asEditor, "viewer")).toBe(false);
    expect(assignableRoles(own)).toEqual(["viewer", "editor", "manager"]);
    expect(assignableRoles(asManager)).toEqual(["viewer", "editor"]);
    expect(assignableRoles(asViewer)).toEqual([]);
  });
});

describe("labels and capacity", () => {
  it("labels roles and shared cards", () => {
    expect(roleLabel("editor")).toBe("Editor");
    expect(sharedSubtitle(own)).toBeNull();
    expect(sharedSubtitle({ ...own, shared: true, memberCount: 2 })).toBe("Shared by you");
    expect(sharedSubtitle(asViewer)).toBe("Viewer · by Ava");
    expect(sharedSubtitle({ ...asViewer, ownerName: null })).toBe("Viewer");
  });
  it("counts remaining invite slots from members and pending invitations", () => {
    expect(remainingSlots(10, 1, 0)).toBe(10);
    expect(remainingSlots(10, 4, 2)).toBe(5);
    expect(remainingSlots(10, 11, 3)).toBe(0);
  });
  it("pluralises people", () => {
    expect(peopleLabel(1)).toBe("1 person");
    expect(peopleLabel(3)).toBe("3 people");
  });
});

describe("isAccessLost", () => {
  it("is true for 403 and 404 API errors only", () => {
    expect(isAccessLost({ status: 404 })).toBe(true);
    expect(isAccessLost({ status: 403 })).toBe(true);
    expect(isAccessLost({ status: 500 })).toBe(false);
    expect(isAccessLost(new Error("x"))).toBe(false);
    expect(isAccessLost(null)).toBe(false);
  });
});
