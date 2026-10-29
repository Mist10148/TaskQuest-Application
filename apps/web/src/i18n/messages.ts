/**
 * The message catalog. English is the source of truth: every key lives here, and a
 * translation is a `Partial` of it, so a missing key falls back to English instead of
 * showing a raw key. To add a language: add its code to LOCALES, add a catalog to
 * `catalogs` below, and give it a name in LOCALE_NAMES.
 *
 * Extracted so far: the NotFound and Review pages, the quest, task and template dialogs
 * and the shared dialog buttons; the rest of the app still uses inline English (see
 * docs/ROADMAP.md). Placeholders are written `{name}`.
 */

export const en = {
  "notFound.title": "404",
  "notFound.message": "Oops! Page not found",
  "notFound.home": "Return to Home",

  "review.title": "Weekly review",
  "review.subtitle": "Look back at this week and collect a once-a-week bonus.",
  "review.what": "your weekly review",
  "review.tasksCompleted": "tasks completed",
  "review.xpEarned": "XP earned",
  "review.dayStreak": "day streak",
  "review.bonus": "Weekly review bonus: +{reward} XP",
  "review.hint.claimed": "You claimed this week's review. A new one opens on Monday.",
  "review.hint.none": "Finish at least one task this week to unlock the bonus.",
  "review.hint.ready": "Nice week so far. Claim your bonus before the week resets.",
  "review.claimed": "Claimed",
  "review.claim": "Claim review bonus",
  "review.footer": "Week of {week} · resets in {left} (Monday 00:00 in your time zone)",

  "common.cancel": "Cancel",
  "common.close": "Close",

  "quest.createTitle": "Create Quest",
  "quest.editTitle": "Edit Quest",
  "quest.createHint": "Name your quest and set its details.",
  "quest.editHint": "Change this quest's details.",
  "quest.name": "Name *",
  "quest.namePlaceholder": "Quest name...",
  "quest.nameMissing": "Give your quest a name.",
  "quest.description": "Description (optional)",
  "quest.descriptionPlaceholder": "What's this quest about?",
  "quest.category": "Category",
  "quest.priority": "Priority",
  "quest.deadline": "Deadline (optional)",
  "quest.create": "Create",
  "quest.save": "Save Changes",

  "task.addTitle": "Add Task",
  "task.editTitle": "Edit Task",
  "task.addHint": "Name your task and set its details.",
  "task.editHint": "Change this task's details.",
  "task.name": "Task Name *",
  "task.namePlaceholder": "What needs to be done?",
  "task.nameMissing": "Give your task a name.",
  "task.description": "Description (optional)",
  "task.descriptionPlaceholder": "Add more details...",
  "task.due": "Due date",
  "task.quickDue": "Quick due dates",
  "task.priority": "Priority",
  "task.repeat": "Repeat",
  "task.repeat.none": "No repeat",
  "task.repeat.daily": "🔁 Daily",
  "task.repeat.weekly": "🔁 Weekly",
  "task.repeat.monthly": "🔁 Monthly",
  "task.tags": "Tags",
  "task.estimate": "Estimate (minutes)",
  "task.estimateHint": "Finish it right after a focus session of about that length for a bonus.",
  "task.parent": "Subtask of",
  "task.noParent": "Not a subtask",
  "task.add": "Add Task",
  "task.save": "Save",

  "template.saveTitle": "Save as template",
  "template.saveHint": "Keeps this quest's tasks (names, notes, priorities, tags and repeats) so you can start a new quest from them later.",
  "template.name": "Template name",
  "template.nameMissing": "Give your template a name.",
  "template.save": "Save template",
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = Partial<Record<MessageKey, string>>;

export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Shown in a language picker, in the language's own name. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English" };

export const catalogs: Record<Locale, Catalog> = { en };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
