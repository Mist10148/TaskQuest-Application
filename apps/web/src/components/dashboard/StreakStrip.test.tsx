import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StreakStrip } from "./StreakStrip";

describe("StreakStrip", () => {
  it("shows the streak length and marks the kept days in words", () => {
    render(<StreakStrip day="2030-01-10" live={3} claimedToday />);
    const strip = screen.getByRole("region", { name: "Your streak this week" });
    expect(within(strip).getByText("3-day streak")).toBeInTheDocument();
    expect(within(strip).getAllByText(/: streak day/)).toHaveLength(3);
    expect(within(strip).getByText("Claimed today")).toBeInTheDocument();
  });

  it("asks for today's claim when it is still open", () => {
    render(<StreakStrip day="2030-01-10" live={0} claimedToday={false} />);
    expect(screen.getByText("No streak yet")).toBeInTheDocument();
    expect(screen.getByText(/: today, not claimed yet/)).toBeInTheDocument();
  });
});
