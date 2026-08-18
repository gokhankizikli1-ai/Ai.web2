/**
 * Tests — MULTILINGUAL SHORT-PROMPT CLASSIFICATION.
 *
 * The request-understanding authorities (site archetype, app type, sector) are what every
 * downstream media / content / optimization decision is read from. They had English + Turkish
 * channels and no German at all, and the Turkish channel had holes — so an equivalent concise
 * request resolved differently depending on the language it was written in, and a correctly
 * understood product could still be told its imagery was optional.
 *
 * These prove the SAME concept, stated concisely in English, Turkish and German, reaches the same
 * classification and the same media verdict — and that genuinely ambiguous prompts still resolve
 * to the adaptive fallback in every language rather than being over-classified.
 *
 * Asserted on the real production spine (planning reply → payload → spec). No provider call.
 */
import { describe, it, expect } from 'vitest';
import { parseBuildSections } from '@/lib/gameBuilderApi';
import { buildWebBuildPayload } from '@/lib/webBuildPayload';
import type { WebBuildResult } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';

const SECTIONS = ['hero', 'overview', 'detail', 'offering', 'proof', 'faq', 'contact', 'footer'];

function planningReply(): string {
  const l = ['## Build Plan', 'Website type: site', 'Audience: visitors', 'Goal: convert', '', '## Page Sections'];
  for (const s of SECTIONS) l.push(`- ${s}: the ${s} section of the page`);
  l.push('', '## Generated Copy');
  for (const s of SECTIONS) {
    l.push(`### ${s}`);
    l.push(`Headline: ${s} headline for this concept`);
    l.push(`Subheadline: ${s} supporting line with a concrete detail`);
    for (let i = 0; i < 4; i += 1) l.push(`- ${s} point ${i}`);
    l.push(`CTA: Continue from ${s}`);
    l.push('');
  }
  l.push('## Next Steps', '- ship');
  return l.join('\n');
}

function specFor(prompt: string, lang: string, buildType: 'web' | 'app' = 'web'): FrontendBuildSpecification {
  const reply = planningReply();
  const res = {
    reply, sections: parseBuildSections(reply), partial: false,
    model: 'x', mode: 'website_builder', requestId: '1',
  } as WebBuildResult;
  const payload = buildWebBuildPayload(prompt, res, undefined, lang, buildType);
  return (payload.steps[payload.steps.length - 1]?.artifacts?.frontendBuildSpec
    || payload.artifacts?.frontendBuildSpec) as FrontendBuildSpecification;
}

/** The classification + media verdict, as one comparable value per request. */
function verdict(prompt: string, lang: string, buildType: 'web' | 'app' = 'web') {
  const spec = specFor(prompt, lang, buildType);
  const xi = spec.experienceIntelligence;
  return {
    archetype: String(spec.designIntelligence?.archetype ?? spec.appArchitecture?.appType ?? 'none'),
    coverage: String(spec.imageCoverage?.mode),
    necessity: String(xi?.media.necessity),
    medium: String(xi?.media.primaryKind),
    leadVisual: String(xi?.media.leadVisual),
    lead: String(xi?.experience.lead),
  };
}

/** Each family: the classification every language must agree on, and one concise prompt each. */
const FAMILIES: Array<{
  family: string;
  buildType: 'web' | 'app';
  archetype: string;
  /** Imagery is product-defining for this family ⇒ the floor must not stay optional. */
  imageryIsCore: boolean;
  prompts: { en: string; tr: string; de: string };
}> = [
  {
    family: 'restaurant', buildType: 'web', archetype: 'restaurant-hospitality', imageryIsCore: true,
    prompts: {
      en: 'a restaurant website',
      tr: 'bir meyhane sitesi',
      de: 'eine Website für ein Restaurant',
    },
  },
  {
    family: 'cafe', buildType: 'web', archetype: 'restaurant-hospitality', imageryIsCore: true,
    prompts: {
      en: 'a cafe website',
      tr: 'bir kafe sitesi',
      de: 'eine Website für ein Café',
    },
  },
  {
    family: 'photography portfolio', buildType: 'web', archetype: 'portfolio', imageryIsCore: true,
    prompts: {
      en: 'a photography portfolio',
      tr: 'bir fotoğrafçı portfolyosu',
      de: 'ein Fotografie-Portfolio',
    },
  },
  {
    family: 'product shop', buildType: 'web', archetype: 'ecommerce-brand', imageryIsCore: true,
    prompts: {
      en: 'an online shop selling ceramics',
      tr: 'seramik satan bir online mağaza',
      de: 'ein Onlineshop für Keramik',
    },
  },
  {
    family: 'local service', buildType: 'web', archetype: 'local-service', imageryIsCore: false,
    prompts: {
      en: 'a plumber website',
      tr: 'bir tesisatçı sitesi',
      de: 'eine Website für einen Klempner',
    },
  },
  {
    family: 'saas/devtool', buildType: 'web', archetype: 'saas-software', imageryIsCore: false,
    prompts: {
      en: 'a project management SaaS',
      tr: 'bir proje yönetimi yazılımı',
      de: 'eine SaaS für Projektmanagement',
    },
  },
  {
    family: 'editorial', buildType: 'web', archetype: 'editorial-media', imageryIsCore: false,
    prompts: {
      en: 'an online magazine',
      tr: 'bir online dergi',
      de: 'ein Online-Magazin',
    },
  },
  {
    family: 'productivity app', buildType: 'app', archetype: 'productivity', imageryIsCore: false,
    prompts: {
      en: 'a task manager app',
      tr: 'bir görev yönetimi uygulaması',
      de: 'eine App zur Aufgabenverwaltung',
    },
  },
];

/* ────────────────────────────────────────────────────────────────────────────
 * 1. THE SAME CONCEPT RESOLVES THE SAME WAY IN EVERY LANGUAGE
 * ──────────────────────────────────────────────────────────────────────────── */
describe('multilingual classification — consistency', () => {
  for (const f of FAMILIES) {
    it(`"${f.family}" resolves identically in English, Turkish and German`, () => {
      const en = verdict(f.prompts.en, 'en', f.buildType);
      const tr = verdict(f.prompts.tr, 'tr', f.buildType);
      const de = verdict(f.prompts.de, 'de', f.buildType);
      expect(en.archetype, `${f.family} EN`).toBe(f.archetype);
      expect(tr, `${f.family} TR vs EN`).toEqual(en);
      expect(de, `${f.family} DE vs EN`).toEqual(en);
    });
  }

  it('imagery is never left optional where it is product-defining, in any language', () => {
    for (const f of FAMILIES.filter((x) => x.imageryIsCore)) {
      for (const [lang, prompt] of Object.entries(f.prompts)) {
        const v = verdict(prompt, lang, f.buildType);
        expect(v.necessity, `${f.family} ${lang}`).toBe('required');
        expect(v.coverage, `${f.family} ${lang}`).toBe('image-led');
        expect(v.leadVisual, `${f.family} ${lang}`).toBe('required');
      }
    }
  });

  it('imagery is NOT forced where it is not product-defining, in any language', () => {
    for (const f of FAMILIES.filter((x) => !x.imageryIsCore)) {
      for (const [lang, prompt] of Object.entries(f.prompts)) {
        const v = verdict(prompt, lang, f.buildType);
        expect(v.coverage, `${f.family} ${lang}`).not.toBe('image-led');
        expect(v.leadVisual, `${f.family} ${lang}`).not.toBe('required');
      }
    }
  });

  it('a software product reads as interface-led in every language', () => {
    for (const [lang, prompt] of Object.entries(FAMILIES.find((f) => f.family === 'saas/devtool')!.prompts)) {
      const v = verdict(prompt, lang);
      expect(v.lead, lang).toBe('interface-led');
      expect(v.medium, lang).toBe('interface-preview');
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. AMBIGUOUS PROMPTS ARE NOT OVER-CLASSIFIED
 * ──────────────────────────────────────────────────────────────────────────── */
describe('multilingual classification — no over-classification', () => {
  const AMBIGUOUS: Array<[string, string]> = [
    ['en', 'a website for my business'],
    ['tr', 'işim için bir web sitesi'],
    ['de', 'eine Website für mein Unternehmen'],
    ['en', 'a nice website'],
    ['tr', 'güzel bir site'],
    ['de', 'eine schöne Website'],
    ['en', 'something simple and clean'],
    ['en', 'a website'],
    ['de', 'eine neue Seite für uns'],
  ];

  it('an ambiguous request stays adaptive — it never becomes a software product', () => {
    for (const [lang, prompt] of AMBIGUOUS) {
      const spec = specFor(prompt, lang);
      const ctx = `${lang}: ${prompt}`;
      // The archetype authority must stay on its explicitly adaptive value…
      expect(spec.designIntelligence?.archetype, ctx).toBe('general');
      expect(spec.designIntelligence?.basis, ctx).toBe('adaptive-fallback');
      // …and the sector authority must not assert a software product either. Measured before the
      // fix: "a website for my business" resolved to `ai-saas` in ENGLISH ONLY, because the
      // experience blueprint defaults to a b2b-product-landing for vague English text.
      expect(spec.identity.sector, ctx).not.toBe('ai-saas');
    }
  });

  it('an ambiguous request never gets a forced image floor or a required lead visual', () => {
    for (const [lang, prompt] of AMBIGUOUS) {
      const v = verdict(prompt, lang);
      const ctx = `${lang}: ${prompt}`;
      expect(v.coverage, ctx).not.toBe('image-led');
      expect(v.coverage, ctx).not.toBe('required');
      expect(v.leadVisual, ctx).not.toBe('required');
      expect(v.necessity, ctx).not.toBe('required');
    }
  });

  it('the SAME ambiguous request resolves the same way in all three languages', () => {
    const en = verdict('a website for my business', 'en');
    expect(verdict('işim için bir web sitesi', 'tr')).toEqual(en);
    expect(verdict('eine Website für mein Unternehmen', 'de')).toEqual(en);
  });

  it('a language keyword table never fires on an unrelated word that merely contains it', () => {
    // German compounds are matched as substrings by design, so the terms must be long enough to
    // be safe. These are the shapes that would break that: an unrelated word containing a stem.
    const cases: Array<[string, string]> = [
      ['de', 'eine Website über Diskurs und Konkurs in der Wirtschaft'],   // …kurs (course)
      ['de', 'eine Website über Artikel des Grundgesetzes'],               // Artikel (article)
      ['tr', 'hatalar ve çözümleri hakkında bir site'],                    // "hata" contains "ata"
      ['tr', 'yazılım olmayan bir konu hakkında okul sitesi'],             // "okul" contains "oku"
    ];
    for (const [lang, prompt] of cases) {
      const spec = specFor(prompt, lang);
      const ctx = `${lang}: ${prompt}`;
      // None of these is a shop, a restaurant, a portfolio or a software product.
      expect(['general', 'education', 'editorial-media', 'community'], ctx)
        .toContain(String(spec.designIntelligence?.archetype));
      expect(spec.imageCoverage?.mode, ctx).not.toBe('image-led');
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. ONE CLASSIFIER, NOT THREE — the media verdict READS the classification
 * ──────────────────────────────────────────────────────────────────────────── */
describe('multilingual classification — single authority', () => {
  it('the media medium follows the archetype, so a new language is taught in ONE place', () => {
    // Every language below reaches the SAME archetype, and therefore the same medium — without
    // the media layer knowing a single Turkish or German word.
    for (const f of FAMILIES.filter((x) => x.buildType === 'web')) {
      const mediums = Object.entries(f.prompts).map(([lang, p]) => [lang, verdict(p, lang).medium] as const);
      const distinct = new Set(mediums.map(([, m]) => m));
      expect(distinct.size, `${f.family}: ${JSON.stringify(mediums)}`).toBe(1);
    }
  });

  it('an explicit request still outranks the category default', () => {
    // The classification decides the DEFAULT medium; what the user explicitly asked for wins.
    const plain = verdict('a project management SaaS', 'en');
    const withPhotos = verdict('a project management SaaS — include photography of our team', 'en');
    expect(plain.medium).toBe('interface-preview');
    expect(withPhotos.medium).not.toBe('interface-preview');
    expect(withPhotos.necessity).toBe('required');
  });
});
