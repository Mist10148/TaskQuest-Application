import { describe, expect, it } from "vitest";
import { bulkPatch, EMPTY_BULK_EDIT } from "./bulkEdit";

describe("bulkPatch", () => {
  it("changes nothing by default", () => {
    expect(bulkPatch(EMPTY_BULK_EDIT)).toBeNull();
  });
  it("sets and clears the priority", () => {
    expect(bulkPatch({ ...EMPTY_BULK_EDIT, priority: "HIGH" })).toEqual({ priority: "HIGH" });
    expect(bulkPatch({ ...EMPTY_BULK_EDIT, priority: "none" })).toEqual({ priority: null });
  });
  it("sets and clears the due date", () => {
    expect(bulkPatch({ ...EMPTY_BULK_EDIT, dueMode: "set", dueDate: "2026-11-01" })).toEqual({ due_date: "2026-11-01" });
    expect(bulkPatch({ ...EMPTY_BULK_EDIT, dueMode: "clear" })).toEqual({ due_date: null });
  });
  it("combines both and refuses a missing or malformed date", () => {
    expect(bulkPatch({ priority: "LOW", dueMode: "set", dueDate: "2026-11-01" })).toEqual({ priority: "LOW", due_date: "2026-11-01" });
    expect(bulkPatch({ ...EMPTY_BULK_EDIT, dueMode: "set", dueDate: "" })).toBeNull();
    expect(bulkPatch({ ...EMPTY_BULK_EDIT, dueMode: "set", dueDate: "tomorrow" })).toBeNull();
  });
});
