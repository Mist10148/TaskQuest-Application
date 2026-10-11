/** Helpers for searching inside task names and descriptions on the Quest Log. */

/** Shorter queries match far too much to be useful, so they are not sent. */
export const MIN_SEARCH_CHARS = 2;

/** The trimmed query when it is long enough to search, otherwise null. */
export function searchableQuery(raw: string): string | null {
  const q = raw.trim();
  return q.length >= MIN_SEARCH_CHARS ? q : null;
}

/**
 * A short piece of `text` around the first match of `query` (case-insensitive), with an ellipsis on a
 * trimmed side. Falls back to the start of the text when the match is somewhere else (e.g. in the name).
 */
export function snippetAround(text: string | null | undefined, query: string, radius = 40): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const at = flat.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0 || flat.length <= radius * 2) return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + query.trim().length + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
