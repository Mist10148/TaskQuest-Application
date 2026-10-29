import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReminderSettings } from "./ReminderSettings";

const mount = (timezone: string | null) =>
  render(<ReminderSettings user={{ timezone, reminder_hour: 9 }} automation weeklyDigest autoDelete onToggle={vi.fn()} onSave={vi.fn()} />);

describe("ReminderSettings", () => {
  it("shows a saved zone the browser does not list as the current one, not some other zone", () => {
    mount("Mars/Olympus_Base");
    const select = screen.getByRole("combobox", { name: "Time zone" }) as HTMLSelectElement;
    expect(select.value).toBe("Mars/Olympus_Base");
    expect(screen.queryByRole("button", { name: /save time zone/i })).toBeNull();
  });

  it("shows UTC (not set) when no zone is saved", () => {
    mount(null);
    expect((screen.getByRole("combobox", { name: "Time zone" }) as HTMLSelectElement).value).toBe("");
  });
});
