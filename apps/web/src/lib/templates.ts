/** Small helpers for the task template dialogs. */
import type { TaskTemplate } from "@/lib/api";

/** Templates hold at most this many tasks and a user keeps at most this many templates (server limits). */
export const TEMPLATE_MAX_ITEMS = 30;
export const TEMPLATE_MAX_COUNT = 20;
const NAME_MAX = 100;

/** "3 tasks: Laundry, Plan meals, Water plants…" for a template row. */
export function templateSummary(template: Pick<TaskTemplate, "items" | "itemCount">, show = 3): string {
  const names = template.items.slice(0, show).map((i) => i.name).join(", ");
  const count = `${template.itemCount} task${template.itemCount === 1 ? "" : "s"}`;
  return `${count}: ${names}${template.itemCount > show ? "…" : ""}`;
}

/** Why a quest can't be saved as a template (or null): it needs 1-30 tasks. */
export function saveTemplateProblem(taskCount: number): string | null {
  if (taskCount === 0) return "Add some tasks first: a template needs at least one.";
  if (taskCount > TEMPLATE_MAX_ITEMS) return `A template holds at most ${TEMPLATE_MAX_ITEMS} tasks, and this quest has ${taskCount}.`;
  return null;
}

/** The quest's name, cut to the 100 characters a template name may have. */
export const defaultTemplateName = (listName: string) => listName.trim().slice(0, NAME_MAX);
