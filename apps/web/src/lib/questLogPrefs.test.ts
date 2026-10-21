import { describe, expect, it } from "vitest";
import { DEFAULT_QUEST_LOG_PREFS, loadQuestLogPrefs, saveQuestLogPrefs } from "./questLogPrefs";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe("quest log preferences", () => {
  it("round-trips the tab, filters and sort", () => {
    const store = memory();
    const prefs = { searchScope: "tasks", categoryFilter: "Work", priorityFilter: "HIGH", statusFilter: "active", activeTab: "current", sortBy: "deadline" } as const;
    saveQuestLogPrefs(prefs, store);
    expect(loadQuestLogPrefs(store)).toEqual(prefs);
  });

  it("falls back to the defaults for nothing saved, junk, or unknown values", () => {
    expect(loadQuestLogPrefs(memory())).toEqual(DEFAULT_QUEST_LOG_PREFS);
    const junk = memory();
    junk.setItem("taskquest:quest-log", "{not json");
    expect(loadQuestLogPrefs(junk)).toEqual(DEFAULT_QUEST_LOG_PREFS);
    const odd = memory();
    odd.setItem("taskquest:quest-log", JSON.stringify({ activeTab: "archived", sortBy: 3, categoryFilter: "<script>" }));
    expect(loadQuestLogPrefs(odd)).toEqual(DEFAULT_QUEST_LOG_PREFS);
  });

  it("works without storage at all", () => {
    expect(loadQuestLogPrefs(undefined)).toEqual(DEFAULT_QUEST_LOG_PREFS);
    expect(() => saveQuestLogPrefs(DEFAULT_QUEST_LOG_PREFS, undefined)).not.toThrow();
  });
});
