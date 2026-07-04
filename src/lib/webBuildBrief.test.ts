import { describe, it, expect } from 'vitest';
import { inferWebsiteBrief, detectIndustry, fallbackSectionItems, checkQuality } from '@/lib/webBuildBrief';
import { sectionKind } from '@/lib/webBuildFiles';

const kindsFor = (prompt: string) =>
  new Set(fallbackSectionItems(inferWebsiteBrief(prompt, 'tr'), 'tr').map((s) => sectionKind(s.id, s.name)));

describe('web build brief intelligence', () => {
  it('detects industry from low-detail prompts (TR + EN)', () => {
    expect(detectIndustry('Peyzaj mimarı için site yap')).toBe('landscaping');
    expect(detectIndustry('AI müşteri destek chatbotu için site yap')).toBe('ai_saas');
    expect(detectIndustry('Mobilyacı için web sitesi yap')).toBe('furniture');
    expect(detectIndustry('Araba satıcısı için site kur')).toBe('automotive');
    expect(detectIndustry('build a site for my fitness coaching business')).toBe('fitness');
    expect(detectIndustry('a website for my restaurant')).toBe('restaurant');
    expect(detectIndustry('something for my thing')).toBe('generic');
  });

  it('infers a full, industry-specific brief with a concrete CTA (Turkish)', () => {
    const b = inferWebsiteBrief('Peyzaj mimarı için site yap', 'tr');
    expect(b.industry).toBe('landscaping');
    expect(b.primaryCTA).toMatch(/keşif/i);
    expect(b.recommendedSections).toContain('gallery');
    expect(b.heroHeadline.length).toBeGreaterThan(12);
    // Turkish copy, not English filler.
    expect(b.heroHeadline).not.toMatch(/your (website|headline)/i);
  });

  it('AI/SaaS brief books a demo and plans a product-demo section', () => {
    const b = inferWebsiteBrief('AI müşteri destek chatbotu için site yap', 'tr');
    expect(b.industry).toBe('ai_saas');
    expect(b.primaryCTA).toMatch(/demo|dene/i);
    expect(b.recommendedSections).toContain('product-demo');
  });

  it('fallbackSectionItems produces a real hero + card sections with copy', () => {
    const b = inferWebsiteBrief('Araba satıcısı için site kur', 'tr');
    const items = fallbackSectionItems(b, 'tr');
    expect(items.length).toBeGreaterThanOrEqual(5);
    const hero = items.find((s) => /hero/.test(s.id))!;
    expect(hero.headline).toBeTruthy();
    expect(hero.cta).toMatch(/araç|test/i);
    // Card sections carry real industry bullets.
    const cards = items.filter((s) => (s.bullets || []).length > 0 && !/hero|footer/.test(s.id));
    expect(cards.length).toBeGreaterThanOrEqual(2);
  });

  it('quality gate flags a thin/generic build and passes a full one', () => {
    const weak = checkQuality([{ id: 'hero', name: 'Hero', headline: 'Your website' }], 1);
    expect(weak.ok).toBe(false);
    const strong = fallbackSectionItems(inferWebsiteBrief('Mobilyacı için site yap', 'tr'), 'tr');
    expect(checkQuality(strong, 8, 'tr').ok).toBe(true);
  });

  it('quality gate rejects English headings in a Turkish build', () => {
    const mixed = [
      { id: 'hero', name: 'Hero', headline: 'Premium fitness koçluğu', cta: 'Randevu al' },
      { id: 'testimonials', name: 'What our clients say' },
      { id: 'services', name: 'Hizmetler' },
      { id: 'cta', name: 'Randevu', cta: 'Randevu al' },
    ];
    expect(checkQuality(mixed, 6, 'tr').hasLocalizedCopy).toBe(false);
    expect(checkQuality(mixed, 6, 'en').hasLocalizedCopy).toBe(true);
  });

  it('different industries produce genuinely different section layouts', () => {
    const land = kindsFor('Peyzaj mimarı için site yap');
    const saas = kindsFor('AI müşteri destek chatbotu için site yap');
    const auto = kindsFor('Araba satıcısı için site kur');

    // Landscaping → gallery + before/after; NOT product-demo or inventory.
    expect(land.has('gallery')).toBe(true);
    expect(land.has('beforeAfter')).toBe(true);
    expect(land.has('productDemo')).toBe(false);
    expect(land.has('inventory')).toBe(false);

    // AI/SaaS → product demo + metrics + integrations; NOT gallery.
    expect(saas.has('productDemo')).toBe(true);
    expect(saas.has('metrics')).toBe(true);
    expect(saas.has('integrations')).toBe(true);

    // Dealership → inventory + financing; NOT product demo.
    expect(auto.has('inventory')).toBe(true);
    expect(auto.has('financing')).toBe(true);
    expect(auto.has('productDemo')).toBe(false);

    // The three layouts are not the same set of section kinds.
    const key = (s: Set<string>) => [...s].sort().join(',');
    expect(new Set([key(land), key(saas), key(auto)]).size).toBe(3);
  });
});
