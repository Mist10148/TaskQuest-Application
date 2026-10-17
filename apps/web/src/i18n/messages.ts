/**
 * The message catalog. English is the source of truth: every key lives here, and a
 * translation is a `Partial` of it, so a missing key falls back to English instead of
 * showing a raw key. To add a language: add its code to LOCALES, add a catalog to
 * `catalogs` below, and give it a name in LOCALE_NAMES.
 *
 * Only the NotFound and Review pages are extracted so far; the rest of the app still
 * uses inline English (see docs/PRD.md, roadmap). Placeholders are written `{name}`.
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
