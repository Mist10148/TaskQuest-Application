import { describe, expect, it } from "vitest";
import { addDays, compareDeadlines, daysBetween, formatDayLabel, formatDeadline, formatDue, isPastDeadline, localToday, quickDueDates, setUserZone } from "./dates";

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

  it("reads today in the user's time zone, the day the server counts by", () => {
    const instant = new Date("2030-01-06T01:00:00Z"); // still Jan 5 in Los Angeles, already Jan 6 in Manila
    expect(localToday(instant, "America/Los_Angeles")).toBe("2030-01-05");
    expect(localToday(instant, "Asia/Manila")).toBe("2030-01-06");
    setUserZone("America/Los_Angeles");
    try {
      expect(localToday(instant)).toBe("2030-01-05");
      expect(isPastDeadline("2030-01-05", localToday(instant))).toBe(false);
    } finally {
      setUserZone(null);
    }
    expect(localToday(new Date(2030, 0, 5, 23, 59))).toBe("2030-01-05");
  });

  it("counts calendar days between two dates, across months and years", () => {
    expect(daysBetween("2030-01-31", "2030-02-01")).toBe(1);
    expect(daysBetween("2030-12-31", "2031-01-01")).toBe(1);
    expect(daysBetween("2030-03-10", "2030-03-01")).toBe(-9);
    expect(daysBetween("", "2030-03-01")).toBeNaN();
  });

  it("says a due date relative to today within a week, and as a date beyond", () => {
    const today = "2030-03-10";
    expect(formatDue("2030-03-10", today)).toBe("Today");
    expect(formatDue("2030-03-11", today)).toBe("Tomorrow");
    expect(formatDue("2030-03-09", today)).toBe("Yesterday");
    expect(formatDue("2030-03-14", today)).toBe("in 4 days");
    expect(formatDue("2030-03-06", today)).toBe("4 days ago");
    expect(formatDue("2030-03-17", today)).toBe("Mar 17");
    expect(formatDue("2029-12-01", today)).toBe("Dec 1, 2029");
    expect(formatDue(null, today)).toBe("");
  });

  it("reads a day out in full for labels, without shifting it", () => {
    expect(formatDayLabel("2030-01-15")).toBe("Tuesday, January 15, 2030");
    expect(formatDayLabel("2030-01-15T00:00:00.000Z")).toBe("Tuesday, January 15, 2030");
    expect(formatDayLabel("")).toBe("");
  });

  it("falls back to the browser's day for an unknown zone", () => {
    expect(localToday(new Date(2030, 0, 5, 12), "Not/AZone")).toBe("2030-01-05");
  });

  it("sorts deadlines chronologically with missing ones last", () => {
    const sorted = ["2030-02-01", null, "2030-01-15"].sort(compareDeadlines);
    expect(sorted).toEqual(["2030-01-15", "2030-02-01", null]);
  });

  it("moves a date by calendar days across month, year and leap boundaries", () => {
    expect(addDays("2030-01-31", 1)).toBe("2030-02-01");
    expect(addDays("2030-12-31", 1)).toBe("2031-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2030-03-01", -1)).toBe("2030-02-28");
    expect(addDays("nonsense", 1)).toBe("");
  });

  it("offers today, tomorrow, next week and no date as quick picks", () => {
    expect(quickDueDates("2030-01-29")).toEqual([
      { label: "task.due.today", value: "2030-01-29" },
      { label: "task.due.tomorrow", value: "2030-01-30" },
      { label: "task.due.nextWeek", value: "2030-02-05" },
      { label: "task.due.none", value: "" },
    ]);
  });
});
