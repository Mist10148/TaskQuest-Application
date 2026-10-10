/** WCAG 2.x contrast helpers for the HSL design tokens in index.css. */

export interface Hsl {
  h: number;
  s: number; // 0-100
  l: number; // 0-100
}

/** Parse a token value like "215 20% 65%". */
export function parseHsl(value: string): Hsl {
  const m = /^\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/.exec(value);
  if (!m) throw new Error(`Not an HSL token: "${value}"`);
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

function toRgb({ h, s, l }: Hsl): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function luminance(color: Hsl): number {
  const [r, g, b] = toRgb(color).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colors (1 to 21). */
export function contrastRatio(a: Hsl, b: Hsl): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-blend `fg` at `alpha` over `bg` (both HSL), returning an approximate HSL for contrast checks. */
export function blend(fg: Hsl, bg: Hsl, alpha: number): Hsl {
  const [fr, fgc, fb] = toRgb(fg);
  const [br, bgc, bb] = toRgb(bg);
  const mix = (x: number, y: number) => x * alpha + y * (1 - alpha);
  const [r, g, b] = [mix(fr, br), mix(fgc, bgc), mix(fb, bb)];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: s * 100, l: l * 100 };
}
