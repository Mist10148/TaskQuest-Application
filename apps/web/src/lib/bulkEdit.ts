import type { ItemInput, Priority } from "@/lib/api";
import { readTagInput, tagProblem } from "@/lib/tags";

/** What the bulk-edit dialog collects: "keep" leaves a field alone, "none" clears it. */
export interface BulkEditValues {
  priority: "keep" | "none" | Priority;
  /** "keep" leaves due dates alone, "clear" removes them, "set" uses `dueDate`. */
  dueMode: "keep" | "clear" | "set";
  dueDate: string;
  /** "add" and "remove" change each task's own tags; "replace" gives every task exactly `tags` (empty clears them). */
  tagMode: "keep" | "add" | "remove" | "replace";
  tags: string;
}

export const EMPTY_BULK_EDIT: BulkEditValues = { priority: "keep", dueMode: "keep", dueDate: "", tagMode: "keep", tags: "" };

type BulkPatch = Pick<ItemInput, "priority" | "due_date" | "tags">;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Why the typed tags cannot be used, or null. */
export function bulkTagProblem(values: BulkEditValues): string | null {
  if (values.tagMode === "keep") return null;
  const typed = readTagInput(values.tags);
  if (typed.length === 0 && values.tagMode !== "replace") return "Type at least one tag.";
  return tagProblem(typed);
}

/**
 * The patch to send for one task, or null when the form changes nothing (or a field is not valid).
 * Without `currentTags` it answers for the form as a whole: is there anything to apply?
 */
export function bulkPatch(values: BulkEditValues, currentTags?: readonly string[]): BulkPatch | null {
  const patch: BulkPatch = {};
  if (values.priority === "none") patch.priority = null;
  else if (values.priority !== "keep") patch.priority = values.priority;
  if (values.dueMode === "clear") patch.due_date = null;
  else if (values.dueMode === "set") {
    if (!DAY.test(values.dueDate)) return null;
    patch.due_date = values.dueDate;
  }
  if (values.tagMode !== "keep") {
    if (bulkTagProblem(values)) return null;
    const typed = readTagInput(values.tags);
    if (currentTags === undefined) patch.tags = typed.join(",");
    else {
      const next =
        values.tagMode === "replace" ? typed
        : values.tagMode === "add" ? [...currentTags, ...typed.filter((t) => !currentTags.includes(t))]
        : currentTags.filter((t) => !typed.includes(t));
      const same = next.length === currentTags.length && next.every((t, i) => t === currentTags[i]);
      if (!same) patch.tags = next.length ? next.join(",") : null;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** True when adding the typed tags would give this task more than the server allows. */
export function tooManyTags(values: BulkEditValues, currentTags: readonly string[]): boolean {
  const patch = bulkPatch(values, currentTags);
  return typeof patch?.tags === "string" && tagProblem(patch.tags.split(",")) !== null;
}
