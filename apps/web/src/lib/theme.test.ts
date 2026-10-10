import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blend, contrastRatio, parseHsl } from "./contrast";

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

const CLASSES = ["default", "hero", "gambler", "assassin", "wizard", "archer", "tank"];

/**
 * Text-on-surface pairs the UI actually renders, with the minimum contrast each needs.
 * Body text needs 4.5:1 (WCAG AA). The brand blurple and the destructive red are also used as
 * button backgrounds under white text, so as text-on-card colors they are held to 3:1, the WCAG
 * minimum for icons and large or bold text (a color cannot be both a 4.5:1 text color on a dark
 * card and a 4.5:1 background for white text).
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
