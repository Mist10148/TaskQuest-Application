import { describe, expect, it } from "vitest";
import { achievementDescription, formatBonus, rewardDescription } from "./bonuses";

describe("formatBonus", () => {
  it("shows the XP and the label", () => {
    expect(formatBonus({ key: "first_of_day", label: "First of the day", xp: 10 })).toBe("+10 First of the day");
  });
});

describe("rewardDescription", () => {
  const bonuses = [
    { key: "first_of_day", label: "First of the day", xp: 10 },
    { key: "early_finish", label: "Finished early", xp: 20 },
  ];
  it("joins the bonuses with dots", () => {
    expect(rewardDescription({ bonuses })).toBe("+10 First of the day · +20 Finished early");
  });
  it("puts the class and skill details before the bonuses", () => {
    expect(rewardDescription({ details: "+2 class", bonuses })).toBe("+2 class · +10 First of the day · +20 Finished early");
  });
  it("shows the level-up instead of the details", () => {
    expect(rewardDescription({ leveledUp: true, newLevel: 5, details: "+2 class", bonuses: [bonuses[0]] })).toBe("🎉 Level up! You are now level 5. · +10 First of the day");
  });
  it("is undefined when there is nothing to say", () => {
    expect(rewardDescription({})).toBeUndefined();
    expect(rewardDescription({ details: "", bonuses: [] })).toBeUndefined();
    expect(rewardDescription({ bonuses: [{ key: "x", label: "Zero", xp: 0 }] })).toBeUndefined();
  });
});

describe("achievementDescription", () => {
  it("mentions the XP reward", () => {
    expect(achievementDescription({ description: "Finish 10 tasks", xp: 25 })).toBe("Finish 10 tasks · +25 XP");
  });
  it("leaves the description alone without a reward", () => {
    expect(achievementDescription({ description: "Finish 10 tasks" })).toBe("Finish 10 tasks");
    expect(achievementDescription({ description: "Finish 10 tasks", xp: 0 })).toBe("Finish 10 tasks");
  });
});
