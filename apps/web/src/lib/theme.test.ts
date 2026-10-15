// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { blend, contrastRatio, parseHsl, type Hsl } from "./contrast";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/** Token map for one selector block, e.g. ":root" or ".light". */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in index.css`);
  const body = css.slice(start, css.indexOf("\n  }", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const dark = tokens(":root");
const light = { ...dark, ...tokens(".light") };

const CLASSES = ["default", "hero", "gambler", "assassin", "wizard", "archer", "tank", "monk", "artisan", "ranger", "necromancer", "paladin", "alchemist", "bard"];

/**
 * Text-on-surface pairs the UI actually renders, with the minimum contrast each needs.
 * Body text needs 4.5:1 (WCAG AA). The brand blurple and the destructive red double as button
 * backgrounds under white text, so the raw tokens (primary, destructive) are held to 3:1, the WCAG
 * minimum for icons and large or bold text. Text uses the separate primary-text and
 * destructive-text tokens (text-primary-text / text-destructive-text), which must reach 4.5:1 on
 * every surface they can sit on, in both themes.
 */
const PAIRS: Array<[string, string, number]> = [
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["foreground", "background-secondary", 4.5],
  ["foreground-muted", "background", 4.5],
  ["foreground-muted", "card", 4.5],
  ["foreground-muted", "background-secondary", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["xp", "card", 4.5],
  ["success", "card", 4.5],
  ["primary", "card", 3],
  ["destructive", "card", 3],
  ...["background", "background-secondary", "background-tertiary", "card"].flatMap((bg): Array<[string, string, number]> => [
    ["primary-text", bg, 4.5],
    ["destructive-text", bg, 4.5],
  ]),
  ...CLASSES.flatMap((c): Array<[string, string, number]> => [[`class-${c}`, "card", 4.5], [`class-${c}`, "background", 4.5]]),
];

describe.each([
  ["dark", dark],
  ["light", light],
])("%s theme contrast (WCAG AA)", (_name, theme) => {
  it.each(PAIRS)("%s on %s (min %s:1)", (fg, bg, min) => {
    const ratio = contrastRatio(parseHsl(theme[fg]), parseHsl(theme[bg]));
    expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });

  it.each(CLASSES)("class-%s text on its own 10 percent tint over the card", (c) => {
    const card = parseHsl(theme.card);
    const tint = blend(parseHsl(theme[`class-${c}`]), card, 0.1);
    const ratio = contrastRatio(parseHsl(theme[`class-${c}`]), tint);
    expect(ratio, `class-${c} on its tint is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

// Profile accents (Shop cosmetics) are drawn as text on the card surfaces, so each one needs 4.5:1 in the theme it is shown in.
const { COSMETICS } = createRequire(import.meta.url)("../../../../packages/shared/src/constants.js") as {
  COSMETICS: Record<string, { kind: string; name: string; color?: string; colorDark?: string }>;
};

/** "#rrggbb" as an Hsl, so the same contrast helper applies. */
function hexToHsl(hex: string): Hsl {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

const ACCENTS = Object.entries(COSMETICS).filter(([, c]) => c.kind === "accent");

describe("profile accent colours (WCAG AA)", () => {
  it("there are accents to check", () => expect(ACCENTS.length).toBeGreaterThanOrEqual(6));

  describe.each([
    ["dark", dark, "colorDark" as const],
    ["light", light, "color" as const],
  ])("%s theme", (_name, theme, field) => {
    it.each(ACCENTS.flatMap(([id, c]) => ["card", "background", "background-secondary"].map((bg) => [id, bg, c] as const)))(
      "%s on %s needs 4.5:1",
      (id, bg, c) => {
        const hex = c[field];
        expect(hex, `${id} has a ${field}`).toMatch(/^#[0-9a-f]{6}$/);
        const ratio = contrastRatio(hexToHsl(hex as string), parseHsl(theme[bg]));
        expect(ratio, `${id} ${field} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      },
    );
  });
});
