import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatCard } from "./StatCard";

describe("StatCard", () => {
  it("shows the label, the icon and a number with thousands separators", () => {
    render(<StatCard icon={<span data-testid="icon">★</span>} label="Lifetime XP" value={12345} />);
    expect(screen.getByText("Lifetime XP")).toBeInTheDocument();
    expect(screen.getByText("12,345")).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("shows a text value as given", () => {
    render(<StatCard icon="x" label="Class" value="Hero" />);
    expect(screen.getByText("Hero")).toBeInTheDocument();
  });

  it("shows the sub value with a trend arrow, and no arrow without a trend", () => {
    const { rerender } = render(<StatCard icon="x" label="Streak" value={3} subValue="best 9" trend="up" />);
    expect(screen.getByText("↑")).toBeInTheDocument();
    expect(screen.getByText(/best 9/)).toBeInTheDocument();

    rerender(<StatCard icon="x" label="Streak" value={3} subValue="best 9" trend="down" />);
    expect(screen.getByText("↓")).toBeInTheDocument();

    rerender(<StatCard icon="x" label="Streak" value={3} subValue="best 9" />);
    expect(screen.queryByText("↑")).not.toBeInTheDocument();
    expect(screen.queryByText("↓")).not.toBeInTheDocument();
  });

  it("leaves the trend out when there is no sub value", () => {
    render(<StatCard icon="x" label="Streak" value={3} trend="up" />);
    expect(screen.queryByText("↑")).not.toBeInTheDocument();
  });
});
