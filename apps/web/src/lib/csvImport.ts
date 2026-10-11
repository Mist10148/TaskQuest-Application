/** Small helpers for the spreadsheet (CSV) import in Settings. */

/** The server takes up to 1,000,000 characters of CSV text. */
export const MAX_CSV_BYTES = 1_000_000;

export interface CsvRowError {
  row: number;
  message: string;
}

/** Why a chosen file can't be sent, or null when it looks fine. */
export function csvFileProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_CSV_BYTES) return "That file is too large to import (1 MB limit).";
  if (!/\.(csv|txt)$/i.test(file.name)) return "Choose a .csv file.";
  return null;
}

/** "Row 3: Due date must be…" lines for the first few errors, plus a count of the rest. */
export function csvErrorLines(errors: CsvRowError[], total: number, show = 10): string[] {
  const lines = errors.slice(0, show).map((e) => `Row ${e.row}: ${e.message}`);
  if (total > lines.length) lines.push(`…and ${total - lines.length} more.`);
  return lines;
}

/** "3 quests and 12 tasks" with correct plurals. */
export function csvCounts(lists: number, items: number): string {
  return `${lists} quest${lists === 1 ? "" : "s"} and ${items} task${items === 1 ? "" : "s"}`;
}
