/**
 * Class colors come from the theme tokens (--class-*), so they are readable in
 * both the dark and the light theme (contrast is tested in theme.test.ts).
 */

const TOKENS: Record<string, string> = {
  DEFAULT: "--class-default",
  HERO: "--class-hero",
  GAMBLER: "--class-gambler",
  ASSASSIN: "--class-assassin",
  WIZARD: "--class-wizard",
  ARCHER: "--class-archer",
  TANK: "--class-tank",
  MONK: "--class-monk",
  ARTISAN: "--class-artisan",
  RANGER: "--class-ranger",
  NECROMANCER: "--class-necromancer",
  PALADIN: "--class-paladin",
  CHRONOMANCER: "--class-chronomancer",
  DRUID: "--class-druid",
  ALCHEMIST: "--class-alchemist",
  BARD: "--class-bard",
};

/** A CSS color for a class, optionally translucent: classColor("HERO", 0.25). */
export function classColor(classKey: string, alpha?: number): string {
  const token = TOKENS[classKey] ?? TOKENS.DEFAULT;
  return alpha === undefined ? `hsl(var(${token}))` : `hsl(var(${token}) / ${alpha})`;
}
