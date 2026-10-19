/** Tags are stored as one comma-separated string; these helpers keep every view reading them the same way. */

/** Split a stored tag string into clean, unique tags ("a, b,,a" -> ["a", "b"]). */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

/** The server's limits (packages/shared/src/validation.js). */
export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 20;
const TAG = /^[\p{L}\p{N}_-]+$/u;

/** Typed tags ("#Work, home  errands") read the way the server stores them: no #, lower case, unique. */
export function readTagInput(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,\s]+/)) {
    const tag = part.replace(/^#+/, "").toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Why these tags would be refused, or null when they are fine. */
export function tagProblem(tags: readonly string[]): string | null {
  if (tags.length > MAX_TAGS) return `Use at most ${MAX_TAGS} tags.`;
  if (tags.some((t) => t.length > MAX_TAG_LENGTH)) return `A tag can be at most ${MAX_TAG_LENGTH} characters.`;
  if (tags.some((t) => !TAG.test(t))) return "Tags may only contain letters, numbers, - and _.";
  return null;
}
