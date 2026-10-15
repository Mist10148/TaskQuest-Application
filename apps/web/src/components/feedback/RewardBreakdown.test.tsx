import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RewardBreakdown } from "./RewardBreakdown";

describe("RewardBreakdown", () => {
  it("lists every part of the reward on its own line", () => {
    render(<RewardBreakdown details="Base: 10 | 🎯 Hit x4 +10 | 📚 Skill +10" bonuses={[{ key: "first_of_day", label: "First of the day", xp: 10 }]} />);
    const list = screen.getByRole("list", { name: /where the XP came from/i });
    expect(list.querySelectorAll("li")).toHaveLength(4);
    expect(screen.getByText("Base: 10")).toBeInTheDocument();
    expect(screen.getByText("+10 First of the day")).toBeInTheDocument();
  });

  it("shows the level-up first", () => {
    render(<RewardBreakdown leveledUp newLevel={7} details="Base: 10" />);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Level up! You are now level 7.");
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = render(<RewardBreakdown />);
    expect(container).toBeEmptyDOMElement();
  });
});
