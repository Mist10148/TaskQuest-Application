import { catalogs, en, type Catalog, type Locale, type MessageKey } from "./messages";

export type Vars = Record<string, string | number>;

/** Replace each `{name}` with its value; a placeholder with no value is left as written, so a gap is visible. */
export function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole));
}

/**
 * The text for `key` in `locale`, falling back to English for a missing key or an unknown locale.
 * `source` exists for tests; the app uses the real catalogs.
 */
export function translate(locale: Locale | string, key: MessageKey, vars?: Vars, source: Record<string, Catalog> = catalogs): string {
  const text = source[locale]?.[key] ?? en[key];
  return format(text, vars);
}
