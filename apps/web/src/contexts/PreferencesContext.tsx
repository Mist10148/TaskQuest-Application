/**
 * Per-device display preferences (reduce motion, game sounds, language). They live in
 * localStorage only: they are about this screen, not the account, and the app
 * must work when storage is blocked.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/messages";

interface Preferences {
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
  setLocale: (value: Locale) => void;
}

const KEY = "tq.prefs";
const DEFAULTS: Preferences = { reduceMotion: false, sound: false, locale: DEFAULT_LOCALE };

function load(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
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
    document.documentElement.lang = prefs.locale;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* storage blocked: the preference lasts for this visit only */
    }
  }, [prefs]);

  const setReduceMotion = useCallback((reduceMotion: boolean) => setPrefs((p) => ({ ...p, reduceMotion })), []);
  const setSound = useCallback((sound: boolean) => setPrefs((p) => ({ ...p, sound })), []);
  const setLocale = useCallback((locale: Locale) => setPrefs((p) => ({ ...p, locale })), []);
  const value = useMemo(() => ({ ...prefs, setReduceMotion, setSound, setLocale }), [prefs, setReduceMotion, setSound, setLocale]);

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
