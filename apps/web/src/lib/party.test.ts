import { describe, expect, it } from "vitest";
import { canInvite, canKick, canLeave, ownShareLeft, progressPercent, remainingLabel, seatsLabel, seatsLeft } from "./party";

describe("party helpers", () => {
  it("computes the progress percentage, capped and rounded down", () => {
    expect(progressPercent(0, 24)).toBe(0);
    expect(progressPercent(12, 24)).toBe(50);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(30, 24)).toBe(100);
    expect(progressPercent(5, 0)).toBe(0);
    expect(progressPercent(-3, 24)).toBe(0);
  });

  it("counts open seats from members and pending invitations", () => {
    expect(seatsLeft(6, 1, 0)).toBe(5);
    expect(seatsLeft(6, 3, 2)).toBe(1);
    expect(seatsLeft(6, 6, 0)).toBe(0);
    expect(seatsLeft(6, 5, 4)).toBe(0);
  });

  it("lets only an owner with a free seat invite", () => {
    expect(canInvite(true, 2)).toBe(true);
    expect(canInvite(true, 0)).toBe(false);
    expect(canInvite(false, 3)).toBe(false);
  });

  it("lets everyone but the owner leave", () => {
    expect(canLeave(false)).toBe(true);
    expect(canLeave(true)).toBe(false);
  });

  it("words the labels", () => {
    expect(seatsLabel(2, 6)).toBe("2 of 6 seats");
    expect(remainingLabel(10, 24)).toBe("14 to go");
    expect(remainingLabel(24, 24)).toBe("Target reached");
    expect(remainingLabel(30, 24)).toBe("Target reached");
  });

  it("lets only the owner remove somebody else", () => {
    expect(canKick(true, { isOwner: false, isYou: false })).toBe(true);
    expect(canKick(true, { isOwner: true, isYou: true })).toBe(false);
    expect(canKick(true, { isOwner: false, isYou: true })).toBe(false);
    expect(canKick(false, { isOwner: false, isYou: false })).toBe(false);
  });

  it("says how many tasks are left of your own share", () => {
    expect(ownShareLeft(0, 6)).toBe(6);
    expect(ownShareLeft(4, 6)).toBe(2);
    expect(ownShareLeft(6, 6)).toBe(0);
    expect(ownShareLeft(9, 6)).toBe(0);
    expect(ownShareLeft(-1, 6)).toBe(6);
  });
});
