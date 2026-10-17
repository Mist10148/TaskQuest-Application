import { useCallback } from "react";
import { useLocale } from "@/contexts/PreferencesContext";
import type { MessageKey } from "./messages";
import { translate, type Vars } from "./translate";

/** `const t = useT(); t("review.title")`: the text in the player's language, English where it is missing. */
export function useT() {
  const locale = useLocale();
  return useCallback((key: MessageKey, vars?: Vars) => translate(locale, key, vars), [locale]);
}
