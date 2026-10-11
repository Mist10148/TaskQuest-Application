import { describe, expect, it } from "vitest";
import { csvCounts, csvErrorLines, csvFileProblem, MAX_CSV_BYTES } from "./csvImport";

describe("csvFileProblem", () => {
  it("accepts a normal csv and rejects empty, huge and wrong-type files", () => {
    expect(csvFileProblem({ name: "tasks.csv", size: 120 })).toBeNull();
    expect(csvFileProblem({ name: "TASKS.CSV", size: 120 })).toBeNull();
    expect(csvFileProblem({ name: "tasks.csv", size: 0 })).toMatch(/empty/);
    expect(csvFileProblem({ name: "tasks.csv", size: MAX_CSV_BYTES + 1 })).toMatch(/1 MB/);
    expect(csvFileProblem({ name: "tasks.json", size: 10 })).toMatch(/\.csv/);
  });
});

describe("csvErrorLines", () => {
  it("lists the first errors and counts the remainder", () => {
    const errors = Array.from({ length: 12 }, (_, i) => ({ row: i + 2, message: "bad" }));
    const lines = csvErrorLines(errors, 40);
    expect(lines).toHaveLength(11);
    expect(lines[0]).toBe("Row 2: bad");
    expect(lines[10]).toBe("…and 30 more.");
    expect(csvErrorLines(errors.slice(0, 2), 2)).toEqual(["Row 2: bad", "Row 3: bad"]);
  });
});

describe("csvCounts", () => {
  it("pluralises", () => {
    expect(csvCounts(1, 1)).toBe("1 quest and 1 task");
    expect(csvCounts(2, 0)).toBe("2 quests and 0 tasks");
  });
});
