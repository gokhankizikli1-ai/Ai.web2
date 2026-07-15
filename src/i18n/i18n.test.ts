import { describe, it, expect } from 'vitest';
import {
  LOCALES,
  SUPPORTED_LANGUAGES,
  translate,
  toSupported,
  languageNameEn,
  isSupported,
} from '@/i18n';

/**
 * Central i18n guarantees:
 *  - every supported locale mirrors the English key set exactly (no gaps,
 *    which is what prevents mixed-language UI),
 *  - resolution falls back English → raw key,
 *  - {param} interpolation works,
 *  - unsupported codes clamp to English (no fake languages leak through).
 */

const SUPPORTED = SUPPORTED_LANGUAGES.map((l) => l.code);

describe('locale key parity', () => {
  const enKeys = Object.keys(LOCALES.en).sort();
  for (const code of SUPPORTED) {
    it(`${code} has the exact same keys as en (no missing / extra)`, () => {
      const keys = Object.keys(LOCALES[code]).sort();
      expect(keys).toEqual(enKeys);
      // no empty values
      expect(Object.values(LOCALES[code]).every((v) => String(v).trim())).toBe(true);
    });
  }
});

describe('translate', () => {
  it('returns the localized value for a supported language', () => {
    expect(translate('tr', 'newChat')).toBe(LOCALES.tr.newChat);
    expect(translate('de', 'settings')).toBe(LOCALES.de.settings);
    expect(translate('tr', 'newChat')).not.toBe(LOCALES.en.newChat);
  });

  it('falls back to English for an unsupported language', () => {
    expect(translate('zz', 'newChat')).toBe(LOCALES.en.newChat);
  });

  it('falls back to the raw key when the key is unknown', () => {
    expect(translate('en', 'totally_missing_key')).toBe('totally_missing_key');
  });

  it('resolves a removed language to English (no fake language leaks)', () => {
    // fr/it/es/ru are no longer shipped (Phase 14C.1) → English fallback.
    expect(translate('fr', 'newChat')).toBe(LOCALES.en.newChat);
    expect(translate('ru', 'settings')).toBe(LOCALES.en.settings);
  });

  it('interpolates {param} tokens', () => {
    // sourceSearchingWebFor contains a {subject} placeholder in every locale.
    const out = translate('en', 'sourceSearchingWebFor', { subject: 'NVDA' });
    expect(out).toContain('NVDA');
    expect(out).not.toContain('{subject}');
  });
});

describe('language helpers', () => {
  it('ships exactly the three launch languages (Phase 14C.1)', () => {
    expect(SUPPORTED).toEqual(['en', 'tr', 'de']);
  });

  it('toSupported clamps unknown/removed → en, keeps shipped', () => {
    expect(toSupported('de')).toBe('de');
    expect(toSupported('tr')).toBe('tr');
    expect(toSupported('fr')).toBe('en'); // no longer shipped → English
    expect(toSupported('ru')).toBe('en');
    expect(toSupported('zz')).toBe('en');
  });

  it('isSupported only accepts the 3 shipped languages', () => {
    expect(SUPPORTED.every(isSupported)).toBe(true);
    expect(isSupported('fr')).toBe(false);
    expect(isSupported('ru')).toBe(false);
    expect(isSupported('zh')).toBe(false);
  });

  it('languageNameEn gives the English name for the AI directive', () => {
    expect(languageNameEn('de')).toBe('German');
    expect(languageNameEn('tr')).toBe('Turkish');
    expect(languageNameEn('fr')).toBe('English'); // removed → English fallback
    expect(languageNameEn('zz')).toBe('English');
  });
});
