import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  SUPPORTED_LANGUAGES,
  isSupported,
  translate,
  type Language,
  type SupportedLanguage,
} from '@/i18n';

/**
 * Language store — the React binding over the central i18n layer (`src/i18n`).
 *
 * Exposes `t(key, params?)` plus the user's language choice (`mode`) and the
 * resolved effective language (`lang`). Dictionaries, the supported-language
 * list, and key resolution all live in `src/i18n`; this store only tracks
 * selection + persistence and re-renders consumers on change.
 */

export type { Language } from '@/i18n';

/** Menu list — ONLY languages we ship a complete dictionary for. Rendered by
 *  the sidebar account menu and the settings language picker, so we never
 *  advertise a language the product can't fully render. */
export const LANGUAGES: { code: Language; label: string; flag: string; coverage: 'complete' }[] =
  SUPPORTED_LANGUAGES.map((l) => ({ code: l.code, label: l.label, flag: l.flag, coverage: 'complete' as const }));

/** A language has complete UI coverage iff it's in the supported registry. */
export function isLanguageComplete(lang: Language): boolean {
  return isSupported(lang);
}

/** Effective translation language — falls back to English for anything we
 *  don't ship a complete dictionary for. */
export function getEffectiveLanguage(lang: Language): SupportedLanguage {
  return isSupported(lang) ? lang : 'en';
}

/** User's language choice. 'auto' resolves from the browser/device locale
 *  (and, for the AI, the language of the latest message). A concrete code
 *  pins the UI + AI to that language. */
export type LangMode = 'auto' | Language;

/** Resolve the browser/device UI language, clamped to a language we actually
 *  ship translations for. */
export function resolveBrowserLang(): SupportedLanguage {
  try {
    const nav = (
      (typeof navigator !== 'undefined' &&
        (navigator.languages?.[0] || navigator.language)) || 'en'
    ).toLowerCase();
    const base = nav.split('-')[0];
    return getEffectiveLanguage(base as Language);
  } catch {
    return 'en';
  }
}

/** Mode → effective UI language. */
function resolveLang(mode: LangMode): SupportedLanguage {
  return mode === 'auto' ? resolveBrowserLang() : getEffectiveLanguage(mode);
}

/** Bind a `t` helper to a concrete resolved language. */
function makeT(lang: SupportedLanguage) {
  return (key: string, params?: Record<string, string | number>) => translate(lang, key, params);
}

const _bootMode: LangMode = 'auto';
const _bootLang = resolveLang(_bootMode);

interface LanguageState {
  /** The user's choice: 'auto' | 'en' | 'tr' | … */
  mode: LangMode;
  /** The resolved effective UI language actually rendered. */
  lang: SupportedLanguage;
  /** Translate a key. Supports {param} interpolation via the second arg. */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Preferred setter — accepts 'auto' or a concrete code. */
  setMode: (mode: LangMode) => void;
  /** Back-compat: existing callers pass a concrete code. */
  setLang: (lang: Language) => void;
}

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      mode: _bootMode,
      lang: _bootLang,
      t: makeT(_bootLang),
      setMode: (mode: LangMode) => {
        const lang = resolveLang(mode);
        set({ mode, lang, t: makeT(lang) });
      },
      setLang: (lang: Language) => {
        const eff = resolveLang(lang);
        set({ mode: lang, lang: eff, t: makeT(eff) });
      },
    }),
    {
      name: 'korvix-language',
      // Persist the CHOICE (mode), not the resolved value — so Auto keeps
      // tracking the device locale on the next visit.
      partialize: (state) => ({ mode: state.mode }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Migrate legacy persisted shape ({ lang } from before Auto mode),
        // and any language that's no longer supported → its effective code.
        const legacyLang = (state as unknown as { lang?: Language }).lang;
        let mode: LangMode = state.mode ?? legacyLang ?? 'auto';
        // A previously-persisted now-unsupported concrete code degrades to Auto.
        if (mode !== 'auto' && !isSupported(mode)) mode = 'auto';
        const lang = resolveLang(mode);
        state.mode = mode;
        state.lang = lang;
        state.t = makeT(lang);
      },
    }
  )
);
