import { describe, expect, it } from "vitest";
import { compareDeadlines, formatDeadline, isPastDeadline, localToday } from "./dates";

describe("deadline helpers", () => {
  it("does not treat a list due today as overdue", () => {
    expect(isPastDeadline("2030-01-05", "2030-01-05")).toBe(false);
    expect(isPastDeadline("2030-01-05", "2030-01-06")).toBe(true);
    expect(isPastDeadline(null, "2030-01-06")).toBe(false);
  });

  it("formats from the string, so the day never shifts with the time zone", () => {
    expect(formatDeadline("2030-01-05", "2030-03-01")).toBe("Jan 5");
    expect(formatDeadline("2031-12-26", "2030-03-01")).toBe("Dec 26, 2031");
    expect(formatDeadline("2030-01-05T00:00:00.000Z", "2030-03-01")).toBe("Jan 5");
    expect(formatDeadline("", "2030-03-01")).toBe("");
  });

  it("builds the local date from local parts", () => {
    expect(localToday(new Date(2030, 0, 5, 23, 59))).toBe("2030-01-05");
  });

  it("sorts deadlines chronologically with missing ones last", () => {
    const sorted = ["2030-02-01", null, "2030-01-15"].sort(compareDeadlines);
    expect(sorted).toEqual(["2030-01-15", "2030-02-01", null]);
  });
});
