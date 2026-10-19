import { describe, expect, it } from "vitest";
import type { ItemActivity } from "./api";
import { describeActivity, timeAgo } from "./activity";

const entry = (over: Partial<ItemActivity>): ItemActivity => ({ id: 1, kind: "created", actor: { name: "Sam", isYou: false }, createdAt: "2030-01-10T12:00:00Z", ...over });

describe("describeActivity", () => {
  it("names the actor, or You", () => {
    expect(describeActivity(entry({}))).toBe("Sam added this task");
    expect(describeActivity(entry({ actor: { name: "Me", isYou: true }, kind: "completed" }))).toBe("You marked it done");
    expect(describeActivity(entry({ actor: null, kind: "reopened" }))).toBe("Someone reopened it");
  });

  it("describes changes with their old and new values", () => {
    expect(describeActivity(entry({ kind: "priority", from: "LOW", to: "HIGH" }))).toBe("Sam changed the priority from Low to High");
    expect(describeActivity(entry({ kind: "priority", from: null, to: "MEDIUM" }))).toBe("Sam set the priority to Medium");
    expect(describeActivity(entry({ kind: "priority", from: "LOW", to: null }))).toBe("Sam removed the priority");
    expect(describeActivity(entry({ kind: "assigned", to: "Alex" }))).toBe("Sam assigned it to Alex");
    expect(describeActivity(entry({ kind: "assigned", to: null }))).toBe("Sam unassigned it");
    expect(describeActivity(entry({ kind: "moved", from: "Home", to: "Work" }))).toBe("Sam moved it from Home to Work");
    expect(describeActivity(entry({ kind: "renamed", from: "a", to: "b" }))).toBe('Sam renamed it from "a" to "b"');
    expect(describeActivity(entry({ kind: "due", to: null }))).toBe("Sam removed the due date");
  });
});

describe("timeAgo", () => {
  const now = new Date("2030-01-10T12:00:00Z");
  it("counts minutes and hours, then shows the date", () => {
    expect(timeAgo("2030-01-10T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2030-01-10T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2030-01-10T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2030-01-08T09:00:00Z", now)).toBe(new Date("2030-01-08T09:00:00Z").toLocaleDateString());
  });
});
