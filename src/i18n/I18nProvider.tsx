"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Bilingual, Lang } from "@/lib/types";
import { dictionaries } from "./dictionary";
import { translate } from "./translate";
import type { TranslateVars } from "./types";

const STORAGE_KEY = "aegis.lang";
const DEFAULT_LANG: Lang = "en";

export interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** UI string by key, with {name} interpolation. Returns the key when missing. */
  t: (key: string, vars?: TranslateVars) => string;
  /** Pick the current language out of a bilingual pair (text produced by code). */
  pick: (b: Bilingual) => string;
}

function isLang(value: unknown): value is Lang {
  return value === "en" || value === "mn";
}

const fallbackValue: I18nValue = {
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key, vars) => translate(dictionaries[DEFAULT_LANG], key, vars),
  pick: (b) => b[DEFAULT_LANG],
};

// Without a provider (isolated tests) components still render in English.
const I18nContext = createContext<I18nValue>(fallbackValue);

export function I18nProvider({
  children,
  initialLang = DEFAULT_LANG,
}: {
  children: ReactNode;
  initialLang?: Lang;
}) {
  // Hydration-safe: the server and the first client render both use `initialLang`;
  // the stored preference is applied in an effect after hydration.
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLang(stored)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage after hydration
        setLangState(stored);
      }
    } catch {
      // storage blocked or unavailable: keep the default
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not persisted; the choice still applies for this session
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = dictionaries[lang];
    return {
      lang,
      setLang,
      t: (key, vars) => translate(dict, key, vars),
      pick: (b) => b[lang],
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
