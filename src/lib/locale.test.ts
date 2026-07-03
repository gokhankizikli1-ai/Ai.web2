import { describe, it, expect, beforeEach } from 'vitest';
import { detectMessageLanguage, getRequestLocale } from '@/lib/locale';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * i18n request-tagging tests. Cover the message-language heuristic and the
 * getRequestLocale contract the backend answer-language policy relies on:
 *  - manual mode (en/tr) → locale pinned, no message_language sent
 *  - auto mode → message_language attached from the detected message language
 */

describe('detectMessageLanguage', () => {
  it('detects Turkish via special characters', () => {
    expect(detectMessageLanguage('Bugün İstanbul’da hava nasıl?')).toBe('tr');
    expect(detectMessageLanguage('şirket için bir plan')).toBe('tr');
  });

  it('detects Turkish via common function words (no special chars)', () => {
    expect(detectMessageLanguage('bir startup fikri var')).toBe('tr');
    expect(detectMessageLanguage('dolar kac TL')).toBe('tr');
  });

  it('defaults to English for English/ambiguous text', () => {
    expect(detectMessageLanguage('Build me a fitness app')).toBe('en');
    expect(detectMessageLanguage('what is the price of NVDA')).toBe('en');
    expect(detectMessageLanguage('')).toBe('en');
  });
});

describe('getRequestLocale', () => {
  beforeEach(() => {
    // Reset to a known state before each case.
    useLanguageStore.getState().setMode('en');
  });

  it('manual English: pins locale, no message_language', () => {
    useLanguageStore.getState().setMode('en');
    const r = getRequestLocale('merhaba dünya');
    expect(r.locale).toBe('en');
    expect(r.language_mode).toBe('en');
    expect(r.message_language).toBeUndefined();
  });

  it('manual Turkish: pins locale, no message_language', () => {
    useLanguageStore.getState().setMode('tr');
    const r = getRequestLocale('hello world');
    expect(r.locale).toBe('tr');
    expect(r.language_mode).toBe('tr');
    expect(r.message_language).toBeUndefined();
  });

  it('auto mode: attaches detected message language', () => {
    useLanguageStore.getState().setMode('auto');
    const tr = getRequestLocale('bir fikir için yardım');
    expect(tr.language_mode).toBe('auto');
    expect(tr.message_language).toBe('tr');

    const en = getRequestLocale('help me with an idea');
    expect(en.language_mode).toBe('auto');
    expect(en.message_language).toBe('en');
  });
});
