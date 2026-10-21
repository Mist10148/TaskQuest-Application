import { describe, expect, it } from "vitest";
import { pageTitle } from "./pageTitle";

describe("pageTitle", () => {
  it("names the page from the navigation", () => {
    expect(pageTitle("/today")).toBe("Today · TaskQuest");
    expect(pageTitle("/review")).toBe("Weekly review · TaskQuest");
    expect(pageTitle("/settings")).toBe("Settings · TaskQuest");
  });

  it("uses the first path segment, so a chat thread is still the chat page", () => {
    expect(pageTitle("/chat/42")).toBe("AI Chat · TaskQuest");
  });

  it("falls back to the app name for an unknown page", () => {
    expect(pageTitle("/nowhere")).toBe("TaskQuest");
    expect(pageTitle("/")).toBe("TaskQuest");
  });
});
