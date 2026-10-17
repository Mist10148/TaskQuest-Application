import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, LOCALE_NAMES, catalogs, en, isLocale, type MessageKey } from "./messages";
import { format, translate } from "./translate";

const keys = Object.keys(en) as MessageKey[];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("format", () => {
  it("fills placeholders, including numbers", () => {
    expect(format("Week of {week}: +{xp} XP", { week: "7 Jan", xp: 40 })).toBe("Week of 7 Jan: +40 XP");
  });

  it("repeats a placeholder wherever it appears", () => {
    expect(format("{a} and {a}", { a: "x" })).toBe("x and x");
  });

  it("leaves a placeholder with no value as written, so the gap is visible", () => {
    expect(format("Hello {name}", {})).toBe("Hello {name}");
    expect(format("Hello {name}")).toBe("Hello {name}");
  });

  it("does not treat a value as a template (no double substitution)", () => {
    expect(format("{a}", { a: "{b}", b: "oops" })).toBe("{b}");
  });
});

describe("translate", () => {
  it("returns the English text for the default locale", () => {
    expect(translate(DEFAULT_LOCALE, "notFound.message")).toBe("Oops! Page not found");
  });

  it("applies variables", () => {
    expect(translate("en", "review.bonus", { reward: 40 })).toBe("Weekly review bonus: +40 XP");
  });

  it("uses a translation when there is one and English for a key it lacks", () => {
    const source = { xx: { "notFound.message": "[xx] not found" } };
    expect(translate("xx", "notFound.message", undefined, source)).toBe("[xx] not found");
    expect(translate("xx", "notFound.home", undefined, source)).toBe(en["notFound.home"]);
  });

  it("falls back to English for an unknown locale", () => {
    expect(translate("zz", "review.title")).toBe(en["review.title"]);
  });
});

describe("the catalog", () => {
  it("has a non-empty text for every key", () => {
    for (const key of keys) expect(en[key].length, key).toBeGreaterThan(0);
  });

  it("keeps every translation's placeholders identical to English", () => {
    for (const locale of LOCALES) {
      for (const [key, text] of Object.entries(catalogs[locale])) {
        expect(placeholders(text as string), `${locale}:${key}`).toEqual(placeholders(en[key as MessageKey]));
      }
    }
  });

  it("only contains keys that exist in English", () => {
    for (const locale of LOCALES) {
      for (const key of Object.keys(catalogs[locale])) expect(keys, `${locale}:${key}`).toContain(key);
    }
  });

  it("names every locale and recognises only the real ones", () => {
    for (const locale of LOCALES) expect(LOCALE_NAMES[locale]).toBeTruthy();
    expect(isLocale("en")).toBe(true);
    expect(isLocale("klingon")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
