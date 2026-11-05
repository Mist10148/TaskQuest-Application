/** A copy of a task as a new, open task: everything that describes it, nothing about who did what. Pure, so it can be tested. */

import type { Item, ItemInput } from "./api";
import { parseTags } from "./tags";
import { TEXT_LIMITS } from "@/components/tasks/constants";

const SUFFIX = " (copy)";

/**
 * The fields for the copy: the name gets " (copy)" (shortened to fit the name limit), and the description, due date,
 * priority, tags, repeat, estimate and parent carry over. Completion, the assignee, comments and history do not, and a
 * parent's subtasks are not copied.
 */
export function duplicateInput(item: Item): ItemInput {
  const room = TEXT_LIMITS.ITEM_NAME - SUFFIX.length;
  return {
    name: `${item.name.slice(0, room).trimEnd()}${SUFFIX}`,
    description: item.description ?? null,
    due_date: item.due_date ? String(item.due_date).slice(0, 10) : null,
    priority: item.priority ?? null,
    tags: parseTags(item.tags),
    recurrence: item.recurrence ?? null,
    estimate_minutes: item.estimate_minutes ?? null,
    parent_id: item.parent_id ?? null,
  };
}
