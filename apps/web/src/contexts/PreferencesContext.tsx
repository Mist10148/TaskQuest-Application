/**
 * Per-device display preferences (reduce motion, game sounds). They live in
 * localStorage only: they are about this screen, not the account, and the app
 * must work when storage is blocked.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface Preferences {
  /** Turn animations off even if the OS does not ask for it. */
  reduceMotion: boolean;
  /** Sound effects in the arcade games (off by default). */
  sound: boolean;
}

interface PreferencesContextType extends Preferences {
  setReduceMotion: (value: boolean) => void;
  setSound: (value: boolean) => void;
}

const KEY = "tq.prefs";
const DEFAULTS: Preferences = { reduceMotion: false, sound: false };

function load(): Preferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { reduceMotion: parsed.reduceMotion === true, sound: parsed.sound === true };
  } catch {
    return DEFAULTS; // storage blocked or corrupt: fall back to defaults
  }
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(load);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = prefs.reduceMotion ? "true" : "false";
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* storage blocked: the preference lasts for this visit only */
    }
  }, [prefs]);

  const setReduceMotion = useCallback((reduceMotion: boolean) => setPrefs((p) => ({ ...p, reduceMotion })), []);
  const setSound = useCallback((sound: boolean) => setPrefs((p) => ({ ...p, sound })), []);
  const value = useMemo(() => ({ ...prefs, setReduceMotion, setSound }), [prefs, setReduceMotion, setSound]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (context === undefined) throw new Error("usePreferences must be used within a PreferencesProvider");
  return context;
}
