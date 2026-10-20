import { describe, expect, it } from "vitest";
import { bulkPatch, bulkTagProblem, EMPTY_BULK_EDIT, tooManyTags } from "./bulkEdit";

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
    expect(bulkPatch({ ...EMPTY_BULK_EDIT, priority: "LOW", dueMode: "set", dueDate: "2026-11-01" })).toEqual({ priority: "LOW", due_date: "2026-11-01" });
    expect(bulkPatch({ ...EMPTY_BULK_EDIT, dueMode: "set", dueDate: "" })).toBeNull();
    expect(bulkPatch({ ...EMPTY_BULK_EDIT, dueMode: "set", dueDate: "tomorrow" })).toBeNull();
  });
});

describe("bulk tags", () => {
  const tags = (tagMode: "add" | "remove" | "replace", text: string) => ({ ...EMPTY_BULK_EDIT, tagMode, tags: text });

  it("adds to each task's own tags without duplicates", () => {
    expect(bulkPatch(tags("add", "#Work, urgent"), ["home", "work"])).toEqual({ tags: "home,work,urgent" });
  });

  it("removes tags and clears the field when none are left", () => {
    expect(bulkPatch(tags("remove", "home"), ["home", "work"])).toEqual({ tags: "work" });
    expect(bulkPatch(tags("remove", "home"), ["home"])).toEqual({ tags: null });
  });

  it("skips a task whose tags would not change", () => {
    expect(bulkPatch(tags("remove", "gone"), ["home"])).toBeNull();
    expect(bulkPatch(tags("add", "home"), ["home"])).toBeNull();
  });

  it("replaces every task's tags, and an empty replace clears them", () => {
    expect(bulkPatch(tags("replace", "a b"), ["home"])).toEqual({ tags: "a,b" });
    expect(bulkPatch(tags("replace", ""), ["home"])).toEqual({ tags: null });
  });

  it("explains tags the server would refuse", () => {
    expect(bulkTagProblem(tags("add", ""))).toMatch(/at least one/);
    expect(bulkTagProblem(tags("add", "a b c d e f"))).toMatch(/at most 5/);
    expect(bulkTagProblem(tags("add", "no!"))).toMatch(/letters, numbers/);
    expect(bulkPatch(tags("add", "no!"))).toBeNull();
  });

  it("notices when adding would pass the limit for one task", () => {
    expect(tooManyTags(tags("add", "f"), ["a", "b", "c", "d", "e"])).toBe(true);
    expect(tooManyTags(tags("add", "f"), ["a"])).toBe(false);
  });
});

