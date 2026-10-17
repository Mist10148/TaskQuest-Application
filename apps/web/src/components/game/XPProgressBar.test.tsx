import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { XPProgressBar } from "./XPProgressBar";

/** The coloured fill is the only element that carries an inline width. */
const fillWidth = (container: HTMLElement) => (container.querySelector('[style*="width"]') as HTMLElement).style.width;

describe("XPProgressBar", () => {
  it("shows the level and the XP towards the next one", () => {
    render(<XPProgressBar currentXP={1250} xpToNextLevel={2000} level={7} />);
    expect(screen.getByText("Level 7")).toBeInTheDocument();
    expect(screen.getByText("1,250 / 2,000 XP")).toBeInTheDocument();
  });

  it("fills in proportion to the progress", () => {
    const { container } = render(<XPProgressBar currentXP={25} xpToNextLevel={100} level={1} />);
    expect(fillWidth(container)).toBe("25%");
  });

  it("never fills past 100%", () => {
    const { container } = render(<XPProgressBar currentXP={500} xpToNextLevel={100} level={1} />);
    expect(fillWidth(container)).toBe("100%");
  });

  it("can hide the label", () => {
    render(<XPProgressBar currentXP={1} xpToNextLevel={2} level={3} showLabel={false} />);
    expect(screen.queryByText("Level 3")).not.toBeInTheDocument();
  });
});
