import { describe, expect, it } from "vitest";
import { streakStrip } from "./streakStrip";

const states = (today: string, live: number, claimed: boolean) => streakStrip(today, live, claimed).map((d) => d.state);

describe("streakStrip", () => {
  it("marks the live days ending today when today is claimed", () => {
    expect(states("2026-10-19", 3, true)).toEqual(["missed", "missed", "missed", "missed", "kept", "kept", "kept"]);
  });
  it("ends yesterday when today is not claimed yet, and leaves today open", () => {
    expect(states("2026-10-19", 3, false)).toEqual(["missed", "missed", "missed", "kept", "kept", "kept", "today-open"]);
  });
  it("shows no kept day without a streak", () => {
    expect(states("2026-10-19", 0, false)).toEqual(["missed", "missed", "missed", "missed", "missed", "missed", "today-open"]);
  });
  it("caps at the strip length and crosses month ends", () => {
    const strip = streakStrip("2026-03-02", 40, true);
    expect(strip.every((d) => d.state === "kept")).toBe(true);
    expect(strip[0].day).toBe("2026-02-24");
    expect(strip[6]).toMatchObject({ day: "2026-03-02", isToday: true, label: "Mon" });
  });
});
