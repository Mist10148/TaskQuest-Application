import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AchievementBadge } from "./AchievementBadge";

describe("AchievementBadge", () => {
  it("shows the icon and the unlock date once unlocked", () => {
    render(<AchievementBadge name="First Steps" description="Complete a task" icon="🥾" unlocked unlockedAt="3 Oct" />);
    expect(screen.getByRole("heading", { name: "First Steps" })).toBeInTheDocument();
    expect(screen.getByText("🥾")).toBeInTheDocument();
    expect(screen.getByText("Unlocked 3 Oct")).toBeInTheDocument();
  });

  it("hides the icon while locked but still shows what it takes", () => {
    render(<AchievementBadge name="Centurion" description="Finish 100 tasks" icon="💯" unlocked={false} unlockedAt="3 Oct" />);
    expect(screen.getByText("Finish 100 tasks")).toBeInTheDocument();
    expect(screen.queryByText("💯")).not.toBeInTheDocument();
    expect(screen.queryByText(/Unlocked/)).not.toBeInTheDocument();
  });

  it("uses the trophy as the default icon", () => {
    render(<AchievementBadge name="Any" description="d" unlocked />);
    expect(screen.getByText("🏆")).toBeInTheDocument();
  });
});
