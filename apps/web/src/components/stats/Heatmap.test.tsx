import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Heatmap } from "./Heatmap";

describe("Heatmap", () => {
  afterEach(() => vi.useRealTimers());

  it("ends on the server's last day, not on today in UTC", () => {
    // 23:30 UTC on 10 Jan is already 11 Jan for a player in UTC+2; the server says so with its last day.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-10T23:30:00Z"));
    const days = [
      { date: "2030-01-10", xp: 0, tasksCompleted: 0 },
      { date: "2030-01-11", xp: 10, tasksCompleted: 2 },
    ];
    render(<Heatmap days={days} />);
    expect(screen.getByRole("img", { name: /2 tasks completed/ })).toBeInTheDocument();
  });
});
