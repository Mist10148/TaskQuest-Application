import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PreferencesProvider, useLocale, usePreferences } from "./PreferencesContext";

const KEY = "tq.prefs";

const Probe = () => {
  const { locale, reduceMotion, sound, setLocale } = usePreferences();
  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="motion">{String(reduceMotion)}</p>
      <p data-testid="sound">{String(sound)}</p>
      <button onClick={() => setLocale("en")}>english</button>
    </div>
  );
};

describe("PreferencesProvider", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("defaults to English with no stored preferences", () => {
    render(<PreferencesProvider><Probe /></PreferencesProvider>);
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(screen.getByTestId("motion")).toHaveTextContent("false");
  });

  it("keeps stored preferences and falls back to English for an unknown stored language", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ reduceMotion: true, sound: true, locale: "klingon" }));
    render(<PreferencesProvider><Probe /></PreferencesProvider>);
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(screen.getByTestId("motion")).toHaveTextContent("true");
    expect(screen.getByTestId("sound")).toHaveTextContent("true");
  });

  it("survives a corrupt stored value", () => {
    window.localStorage.setItem(KEY, "{not json");
    render(<PreferencesProvider><Probe /></PreferencesProvider>);
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
  });

  it("sets the page language and saves the choice", () => {
    render(<PreferencesProvider><Probe /></PreferencesProvider>);
    act(() => screen.getByRole("button", { name: "english" }).click());
    expect(document.documentElement.lang).toBe("en");
    expect(JSON.parse(window.localStorage.getItem(KEY) as string).locale).toBe("en");
  });
});

describe("useLocale", () => {
  it("is English without a provider", () => {
    const Bare = () => <p data-testid="bare">{useLocale()}</p>;
    render(<Bare />);
    expect(screen.getByTestId("bare")).toHaveTextContent("en");
  });

  it("applies high contrast and text size to the page and remembers them", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ highContrast: true, textSize: "large" }));
    render(<PreferencesProvider><Probe /></PreferencesProvider>);
    expect(document.documentElement.dataset.contrast).toBe("high");
    expect(document.documentElement.dataset.textSize).toBe("large");
  });

  it("ignores an unknown text size", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ textSize: "huge" }));
    render(<PreferencesProvider><Probe /></PreferencesProvider>);
    expect(document.documentElement.dataset.textSize).toBe("normal");
  });
});
