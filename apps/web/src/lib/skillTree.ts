/** Layout of a skill tree: the skills grouped in tiers by how many prerequisites lead to them. */

interface Node {
  id: string;
  requires?: string | null;
}

/** The number of prerequisites in the chain above a skill (0 for a root). Unknown prerequisites count as roots. */
export function skillDepth(skill: Node, byId: Map<string, Node>): number {
  let depth = 0;
  let cursor: Node | undefined = skill;
  const seen = new Set<string>();
  while (cursor?.requires && byId.has(cursor.requires) && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    depth++;
    cursor = byId.get(cursor.requires);
  }
  return depth;
}

/** The skills in tiers (first tier: no prerequisite), each tier in the order the tree lists them. */
export function skillTiers<T extends Node>(skills: readonly T[]): T[][] {
  const byId = new Map(skills.map((s) => [s.id, s as Node]));
  const tiers: T[][] = [];
  for (const skill of skills) {
    const depth = skillDepth(skill, byId);
    (tiers[depth] ??= []).push(skill);
  }
  return tiers.filter(Boolean);
}
