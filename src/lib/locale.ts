/**
 * Locale helpers for request tagging.
 *
 * The UI language lives in the language store (Auto / en / tr). For AI
 * requests we send the resolved locale plus the user's mode so the backend
 * can apply the answer-language policy:
 *   - manual (en/tr): respond in that language
 *   - auto: respond in the language of the user's latest message
 *
 * `detectMessageLanguage` is a lightweight tr-vs-en heuristic used only to
 * TAG the request for logging / the Auto hint — the backend model remains
 * the authority on the actual reply language.
 */
import { useLanguageStore, type Language } from '@/stores/languageStore';

// Turkish-specific letters + very common Turkish function words. Enough to
// distinguish Turkish from English for routing/logging; not a full detector.
const TR_CHARS = /[çğıöşü]/i;
const TR_WORDS = /\b(ve|bir|için|kaç|nasıl|nedir|ne|mi|mı|mu|mü|değil|çok|daha|ile|bu|şu|var|yok|güncel|fiyat|dolar|hava|hisse|şikayet|müşteri|nasılsın|merhaba|selam|lütfen)\b/i;

/** Best-effort language of a single user message. Returns a code we ship
 *  (currently 'tr' or 'en'); defaults to 'en' when unsure. */
export function detectMessageLanguage(text: string): Language {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return 'en';
  if (TR_CHARS.test(t)) return 'tr';
  if (TR_WORDS.test(t)) return 'tr';
  return 'en';
}

export interface RequestLocale {
  /** Resolved UI language code (what the app is currently showing). */
  locale: Language;
  /** User's choice: 'auto' | 'en' | 'tr' | … */
  language_mode: string;
  /** For Auto mode: detected language of the given message (hint only). */
  message_language?: Language;
}

/** Build the locale block to attach to an AI request body. Reads the store
 *  synchronously so it always reflects the current selection. */
export function getRequestLocale(message?: string): RequestLocale {
  const { lang, mode } = useLanguageStore.getState();
  const out: RequestLocale = { locale: lang, language_mode: String(mode) };
  if (mode === 'auto' && message) out.message_language = detectMessageLanguage(message);
  return out;
}
