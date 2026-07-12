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

/* ── Web Build website-output language authority (Phase 12F.2) ──────────────────
 * The generated WEBSITE's content language is SEPARATE from the Chat/Korvix UI
 * language. A Turkish website request must produce a Turkish site even when the app UI
 * is English, and a revision preserves the existing website language unless the user
 * explicitly asks to change it. This authority is used ONLY by Web Build — normal Chat /
 * Research / other workspaces keep the global getRequestLocale behavior unchanged. */

/** Fold to lower-case ASCII (strip diacritics) so `İngilizce`/`ingilizce`/`türkçe`
 *  all match plain patterns regardless of Turkish casing. */
function foldLocale(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Explicit website-OUTPUT language requests (matched on folded text). "ingilizce" /
// "turkce" are distinctive enough as substrings; the English words require site context.
const REQUEST_ENGLISH_RE = /\bin english\b|\benglish (?:website|site|copy|content|version|language|text)\b|(?:website|site|copy|content|text)(?: in)? english\b|ingilizce/g;
const REQUEST_TURKISH_RE = /\bin turkish\b|\bturkish (?:website|site|copy|content|version|language|text)\b|(?:website|site|copy|content|text)(?: in)? turkish\b|turkce/g;

/** Index of the LAST match of `re` in `text`, or -1. `re` must be global. */
function lastMatchIndex(text: string, re: RegExp): number {
  re.lastIndex = 0;
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    idx = m.index;
    if (m.index === re.lastIndex) re.lastIndex += 1; // guard zero-width
  }
  return idx;
}

/**
 * Resolve the website's OUTPUT language for a Web Build request. Pure, deterministic,
 * fail-open. Precedence:
 *   1. an explicit website-output language request in the CURRENT prompt (last wins);
 *   2. the existing website language (a revision keeps its language);
 *   3. the language of the current fresh-build prompt;
 *   4. the UI language;
 *   5. English as the final safe default.
 */
export function resolveWebsiteOutputLanguage(
  prompt: string,
  options?: { existingLanguage?: Language; uiLanguage?: Language },
): Language {
  try {
    // 1. Explicit request in the current prompt — the last-mentioned language wins.
    const folded = foldLocale(prompt);
    const lastEng = lastMatchIndex(folded, REQUEST_ENGLISH_RE);
    const lastTur = lastMatchIndex(folded, REQUEST_TURKISH_RE);
    if (lastEng >= 0 || lastTur >= 0) return lastEng >= lastTur ? 'en' : 'tr';
    // 2. Existing website language (revision) preserves its language.
    if (options?.existingLanguage) return options.existingLanguage;
    // 3. The language of the current (fresh) prompt.
    if ((prompt || '').trim()) return detectMessageLanguage(prompt);
    // 4. UI language fallback. 5. English default.
    return options?.uiLanguage || 'en';
  } catch {
    return options?.existingLanguage || options?.uiLanguage || 'en';
  }
}

/** The Web Build request locale block. Sets the resolved website language as the
 *  authoritative answer language (auto mode + message_language), so it wins over the
 *  app UI language. Web Build only — never used by normal Chat/Research. */
export function getWebBuildRequestLocale(websiteLanguage: Language): RequestLocale {
  return { locale: websiteLanguage, language_mode: 'auto', message_language: websiteLanguage };
}
