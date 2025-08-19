// lib/i18n/index.js
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { translations, defaultLocale as defaultLocaleFromFile } from "./translations";

/* ----------------------------------------
 * Config / helpers
 * -------------------------------------- */
const STORAGE_KEY = "app_locale";
const FALLBACK_LOCALE =
  typeof defaultLocaleFromFile === "string" && defaultLocaleFromFile
    ? defaultLocaleFromFile
    : "it";

function safeGet(obj, path) {
  if (!obj || typeof path !== "string" || !path) return undefined;
  try {
    return path
      .split(".")
      .reduce((acc, k) => (acc && acc[k] != null ? acc[k] : undefined), obj);
  } catch {
    return undefined;
  }
}

function interpolate(str, params) {
  if (str == null) return str;
  const s = String(str);
  if (!params || typeof params !== "object") return s;
  return Object.keys(params).reduce(
    (acc, key) => acc.replace(new RegExp(`{${key}}`, "g"), String(params[key])),
    s
  );
}

/* ----------------------------------------
 * Context
 * -------------------------------------- */
const I18nContext = createContext({
  locale: FALLBACK_LOCALE,
  setLocale: () => {},
  t: (key, fallback, params) => fallback ?? String(key ?? ""),
  hydrated: false,
});

/* ----------------------------------------
 * Provider
 * -------------------------------------- */
export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(FALLBACK_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  // Hydration da AsyncStorage
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) setLocaleState(saved);
      } catch {
        /* ignore */
      }
      setHydrated(true);
    })();
  }, []);

  // setLocale persistente
  const setLocale = useCallback(async (code) => {
    const next = typeof code === "string" && code ? code : FALLBACK_LOCALE;
    setLocaleState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  // Funzione t(key, fallback?, params?)
  const t = useMemo(() => {
    return (key, fallback, params) => {
      try {
        const active = typeof locale === "string" && locale ? locale : FALLBACK_LOCALE;
        const dict = translations?.[active] || {};
        const val = safeGet(dict, key);
        const out = val ?? fallback ?? key ?? "";
        return interpolate(out, params);
      } catch {
        return String(fallback ?? key ?? "");
      }
    };
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t, hydrated }),
    [locale, setLocale, t, hydrated]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/* ----------------------------------------
 * Hooks
 * -------------------------------------- */
// Hook “ufficiale” del tuo progetto
export function useI18n() {
  return useContext(I18nContext);
}

// Alias compatibile con ecosistemi “i18next-like”
export function useTranslation() {
  // Restituiamo lo stesso oggetto, così puoi fare: const { t, locale, setLocale, hydrated } = useTranslation();
  return useContext(I18nContext);
}

/* ----------------------------------------
 * Utility opzionali
 * -------------------------------------- */
// Getter “grezzo” per t senza hook (sconsigliato in componenti React, ma utile fuori da React).
// ATTENZIONE: funziona solo dopo che il Provider ha impostato lo stato; altrimenti usi il fallback.
let _lastContext = {
  locale: FALLBACK_LOCALE,
  t: (key, fallback, params) => interpolate(safeGet(translations[FALLBACK_LOCALE], key) ?? fallback ?? key ?? "", params),
};
export function I18nStateBridge() {
  // Piccolo bridge per aggiornare il riferimento globale (solo se lo vuoi usare fuori da React).
  const ctx = useI18n();
  useEffect(() => {
    _lastContext = ctx;
  }, [ctx]);
  return null;
}

// tGlobal: evita hook in file non-React (script, helper). In componenti React preferisci useI18n()/useTranslation().
export function tGlobal(key, fallback, params) {
  return _lastContext.t(key, fallback, params);
}
