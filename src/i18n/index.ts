/**
 * Central i18n layer.
 *
 * Single source of truth for:
 *   - the locale registry (one dictionary per supported language),
 *   - the list of languages we actually ship (SUPPORTED_LANGUAGES) — the UI
 *     menus render from this, so we never advertise a language we can't
 *     fully render,
 *   - the `translate()` resolver: exact key → language dict, fall back to
 *     English, then to the raw key; interpolates {param} tokens; warns in
 *     development when a key is missing so gaps surface during QA.
 *
 * The React binding lives in `src/stores/languageStore.ts` (a Zustand store
 * exposing `t(key, params?)`), which delegates here. Components keep calling
 * `useLanguageStore().t` — this module is the data + resolution core.
 */
import { en } from './locales/en';
import { tr } from './locales/tr';
import { de } from './locales/de';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { es } from './locales/es';
import { ru } from './locales/ru';

/** Every language code the app understands (some may be aliases/pending). */
export type Language =
  | 'en' | 'tr' | 'de' | 'fr' | 'it' | 'es'
  | 'ru' | 'zh' | 'ja' | 'ar' | 'pt' | 'ko' | 'nl';

/** Languages with a COMPLETE dictionary — the only ones we expose in menus. */
export type SupportedLanguage = 'en' | 'tr' | 'de' | 'fr' | 'it' | 'es' | 'ru';

/** Registry of complete dictionaries. English is the master/fallback. */
export const LOCALES: Record<SupportedLanguage, Record<string, string>> = {
  en, tr, de, fr, it, es, ru,
};

/**
 * Human-facing language name (endonym) per language — used both in the
 * picker UI and injected into the AI system prompt so the model answers in
 * the right language. `nameEn` is the English name for logs/AI directives.
 */
export const SUPPORTED_LANGUAGES: {
  code: SupportedLanguage; label: string; nameEn: string; flag: string;
}[] = [
  { code: 'en', label: 'English',    nameEn: 'English',    flag: 'EN' },
  { code: 'tr', label: 'Türkçe',     nameEn: 'Turkish',    flag: 'TR' },
  { code: 'de', label: 'Deutsch',    nameEn: 'German',     flag: 'DE' },
  { code: 'fr', label: 'Français',   nameEn: 'French',     flag: 'FR' },
  { code: 'it', label: 'Italiano',   nameEn: 'Italian',    flag: 'IT' },
  { code: 'es', label: 'Español',    nameEn: 'Spanish',    flag: 'ES' },
  { code: 'ru', label: 'Русский',    nameEn: 'Russian',    flag: 'RU' },
];

const SUPPORTED_SET = new Set<string>(SUPPORTED_LANGUAGES.map((l) => l.code));

/** Is this a language we ship a complete dictionary for? */
export function isSupported(lang: string): lang is SupportedLanguage {
  return SUPPORTED_SET.has(lang);
}

/** Clamp any language code to one we can fully render (else English). */
export function toSupported(lang: string): SupportedLanguage {
  return isSupported(lang) ? lang : 'en';
}

/** English name of a language, for AI directives / logs. Falls back to code. */
export function languageNameEn(lang: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.nameEn ?? 'English';
}

const isDev = (() => {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
})();

// De-dupe dev warnings so a missing key logs once, not on every render.
const warned = new Set<string>();

function interpolate(value: string, params?: Record<string, string | number>): string {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (m, k) =>
    k in params ? String(params[k]) : m,
  );
}

/**
 * Resolve a translation key for a language.
 *   1. exact hit in the language dict,
 *   2. fall back to English,
 *   3. fall back to the raw key (and warn in dev).
 * Interpolates {param} placeholders when `params` is supplied.
 */
export function translate(
  lang: string,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = LOCALES[toSupported(lang)] ?? en;
  let value = dict[key];
  if (value === undefined) {
    value = en[key];
    if (value === undefined) {
      if (isDev && !warned.has(key)) {
        warned.add(key);
        // eslint-disable-next-line no-console
        console.warn(`[i18n] missing translation key: "${key}"`);
      }
      return interpolate(key, params);
    }
    if (isDev && lang !== 'en' && !warned.has(`${lang}:${key}`)) {
      warned.add(`${lang}:${key}`);
      // eslint-disable-next-line no-console
      console.warn(`[i18n] "${key}" missing for "${lang}" — using English fallback`);
    }
  }
  return interpolate(value, params);
}

/** Build the full resolved dictionary for a language (English-backed). */
export function buildDictionary(lang: string): Record<string, string> {
  return { ...en, ...(LOCALES[toSupported(lang)] ?? {}) };
}
