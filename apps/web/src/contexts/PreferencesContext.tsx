/**
 * Per-device display preferences (reduce motion, high contrast, text size, game sounds, language). They live in
 * localStorage only: they are about this screen, not the account, and the app
 * must work when storage is blocked.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/messages";

export const TEXT_SIZES = ["normal", "large", "larger"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
const isTextSize = (v: unknown): v is TextSize => TEXT_SIZES.includes(v as TextSize);

interface Preferences {
  /** Stronger text and border colours (the CSS reads html[data-contrast="high"]). */
  highContrast: boolean;
  /** Scales every rem-based size (html[data-text-size]). */
  textSize: TextSize;
  /** Turn animations off even if the OS does not ask for it. */
  reduceMotion: boolean;
  /** Sound effects in the arcade games (off by default). */
  sound: boolean;
  /** The language of the pages that use the message catalog (src/i18n). */
  locale: Locale;
}

interface PreferencesContextType extends Preferences {
  setReduceMotion: (value: boolean) => void;
  setSound: (value: boolean) => void;
  setHighContrast: (value: boolean) => void;
  setTextSize: (value: TextSize) => void;
  setLocale: (value: Locale) => void;
}

const KEY = "tq.prefs";
const DEFAULTS: Preferences = { highContrast: false, textSize: "normal", reduceMotion: false, sound: false, locale: DEFAULT_LOCALE };

function load(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      highContrast: parsed.highContrast === true,
      textSize: isTextSize(parsed.textSize) ? parsed.textSize : "normal",
      reduceMotion: parsed.reduceMotion === true,
      sound: parsed.sound === true,
      locale: isLocale(parsed.locale) ? parsed.locale : DEFAULT_LOCALE, // an unknown or removed language falls back to English
    };
  } catch {
    return DEFAULTS; // storage blocked or corrupt: fall back to defaults
  }
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(load);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = prefs.reduceMotion ? "true" : "false";
    document.documentElement.dataset.contrast = prefs.highContrast ? "high" : "normal";
    document.documentElement.dataset.textSize = prefs.textSize;
    document.documentElement.lang = prefs.locale;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* storage blocked: the preference lasts for this visit only */
    }
  }, [prefs]);

  const setReduceMotion = useCallback((reduceMotion: boolean) => setPrefs((p) => ({ ...p, reduceMotion })), []);
  const setSound = useCallback((sound: boolean) => setPrefs((p) => ({ ...p, sound })), []);
  const setHighContrast = useCallback((highContrast: boolean) => setPrefs((p) => ({ ...p, highContrast })), []);
  const setTextSize = useCallback((textSize: TextSize) => setPrefs((p) => ({ ...p, textSize })), []);
  const setLocale = useCallback((locale: Locale) => setPrefs((p) => ({ ...p, locale })), []);
  const value = useMemo(() => ({ ...prefs, setReduceMotion, setSound, setHighContrast, setTextSize, setLocale }), [prefs, setReduceMotion, setSound, setHighContrast, setTextSize, setLocale]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (context === undefined) throw new Error("usePreferences must be used within a PreferencesProvider");
  return context;
}

/** The language to show; English when there is no provider (a test, or a page rendered on its own). */
// eslint-disable-next-line react-refresh/only-export-components
export function useLocale(): Locale {
  return useContext(PreferencesContext)?.locale ?? DEFAULT_LOCALE;
}
