import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ today: "2030-01-31" }));
vi.mock("@/hooks/useLocalToday", () => ({ useLocalToday: () => clock.today }));

import { TaskCalendar } from "./TaskCalendar";

describe("TaskCalendar at midnight", () => {
  it("moves a calendar left on today to the new day and month", () => {
    const { rerender } = render(<TaskCalendar items={[]} onToggle={() => {}} onEdit={() => {}} />);
    expect(screen.getByText("January 2030")).toBeInTheDocument();
    clock.today = "2030-02-01";
    rerender(<TaskCalendar items={[]} onToggle={() => {}} onEdit={() => {}} />);
    expect(screen.getByText("February 2030")).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /February 1, 2030, today/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  });
});
