import { describe, expect, it } from "vitest";
import { filterCommands, moveActive, type PaletteCommand } from "./commands";

const cmds: PaletteCommand[] = [
  { id: "dash", label: "Dashboard", group: "Go to" },
  { id: "tasks", label: "Tasks", group: "Go to", keywords: "quests todo" },
  { id: "theme", label: "Toggle theme", group: "Actions", keywords: "dark light" },
  { id: "new", label: "New task", group: "Actions" },
];

describe("filterCommands", () => {
  it("keeps everything, in order, for an empty query", () => {
    expect(filterCommands(cmds, "  ").map((c) => c.id)).toEqual(["dash", "tasks", "theme", "new"]);
  });
  it("matches labels and keywords, case-insensitively", () => {
    expect(filterCommands(cmds, "DARK").map((c) => c.id)).toEqual(["theme"]);
    expect(filterCommands(cmds, "todo").map((c) => c.id)).toEqual(["tasks"]);
  });
  it("requires every word", () => {
    expect(filterCommands(cmds, "new task").map((c) => c.id)).toEqual(["new"]);
    expect(filterCommands(cmds, "new zzz")).toEqual([]);
  });
  it("ranks label matches above keyword-only matches", () => {
    expect(filterCommands(cmds, "task").map((c) => c.id)).toEqual(["tasks", "new"]);
    expect(filterCommands(cmds, "quests").map((c) => c.id)).toEqual(["tasks"]);
  });
});

describe("moveActive", () => {
  it("wraps in both directions", () => {
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
  });
  it("is 0 for an empty list", () => {
    expect(moveActive(5, 1, 0)).toBe(0);
  });
});
