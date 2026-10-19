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
