import { describe, expect, it } from "vitest";
import { classCounter, dailyDescription, describeChest, freezeLimits } from "./classInfo";
import type { UserSkill } from "./api";

const skill = (id: string): UserSkill => ({ skill_id: id, skill_level: 1, unlocked_at: "" });
const NOW = Date.parse("2026-10-10T12:00:00Z");

describe("freezeLimits", () => {
  it("uses the server's limits and falls back to 150/3", () => {
    expect(freezeLimits({ COST: 120, MAX: 5 })).toEqual({ cost: 120, max: 5 });
    expect(freezeLimits(undefined)).toEqual({ cost: 150, max: 3 });
    expect(freezeLimits(null)).toEqual({ cost: 150, max: 3 });
  });
});

describe("classCounter", () => {
  it("is null for classes without a counter", () => {
    expect(classCounter({ player_class: "HERO" }, [], NOW)).toBeNull();
    expect(classCounter({ player_class: "RANGER" }, [], NOW)).toBeNull();
  });

  it("shows the Monk rhythm with the Discipline cap and flags a lapsed rhythm", () => {
    expect(classCounter({ player_class: "MONK", monk_rhythm: 5, monk_day: "2026-10-10" }, [], NOW)).toMatchObject({ value: 5, max: 14, note: undefined });
    expect(classCounter({ player_class: "MONK", monk_rhythm: 5, monk_day: "2026-10-09" }, [skill("monk_discipline")], NOW)).toMatchObject({ max: 18, note: undefined });
    expect(classCounter({ player_class: "MONK", monk_rhythm: 5, monk_day: "2026-10-07" }, [], NOW)?.note).toMatch(/Lapsed/);
    // Serenity forgives one skipped day.
    expect(classCounter({ player_class: "MONK", monk_rhythm: 5, monk_day: "2026-10-08" }, [skill("monk_serenity")], NOW)?.note).toBeUndefined();
  });

  it("shows Artisan progress and Necromancer souls with skill-dependent caps", () => {
    expect(classCounter({ player_class: "ARTISAN", artisan_progress: 4 }, [], NOW)).toMatchObject({ label: "Project", value: 4, max: 10 });
    expect(classCounter({ player_class: "ARTISAN", artisan_progress: 4 }, [skill("artisan_blueprint")], NOW)?.max).toBe(13);
    expect(classCounter({ player_class: "NECROMANCER", necro_souls: 9 }, [], NOW)).toMatchObject({ label: "Souls", value: 5, max: 5 });
    expect(classCounter({ player_class: "NECROMANCER", necro_souls: 2 }, [skill("necro_jar")], NOW)?.max).toBe(8);
  });
});

describe("daily reward text", () => {
  it("describes chests of any shape", () => {
    expect(describeChest(undefined)).toBe("");
    expect(describeChest(null)).toBe("");
    expect(describeChest(75)).toBe("+75 XP");
    expect(describeChest({ streak: 7, xp: 50 })).toBe("7-day streak: +50 XP");
  });

  it("adds the Daily Surprise to the toast text", () => {
    expect(dailyDescription({ success: true, classBonus: 10, streakBonus: 5, streak: 3 })).toBe("+10 class, +5 streak (3 days)");
    expect(dailyDescription({ success: true, bonusInfo: { details: "Hero +25" }, surpriseBonus: 50 })).toBe("Hero +25 · 🎉 Daily Surprise +50 XP");
    expect(dailyDescription({ success: true, surpriseBonus: 50 })).toBe("🎉 Daily Surprise +50 XP");
    expect(dailyDescription({ success: true })).toBe("");
  });
});
