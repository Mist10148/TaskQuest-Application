import type { ItemInput, Priority } from "@/lib/api";

/** What the bulk-edit dialog collects: "keep" leaves a field alone, "none" clears it. */
export interface BulkEditValues {
  priority: "keep" | "none" | Priority;
  /** "keep" leaves due dates alone, "clear" removes them, "set" uses `dueDate`. */
  dueMode: "keep" | "clear" | "set";
  dueDate: string;
}

export const EMPTY_BULK_EDIT: BulkEditValues = { priority: "keep", dueMode: "keep", dueDate: "" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The patch to send for each selected task, or null when the form changes nothing (or the date is not a date). */
export function bulkPatch(values: BulkEditValues): Pick<ItemInput, "priority" | "due_date"> | null {
  const patch: Pick<ItemInput, "priority" | "due_date"> = {};
  if (values.priority === "none") patch.priority = null;
  else if (values.priority !== "keep") patch.priority = values.priority;
  if (values.dueMode === "clear") patch.due_date = null;
  else if (values.dueMode === "set") {
    if (!DAY.test(values.dueDate)) return null;
    patch.due_date = values.dueDate;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
