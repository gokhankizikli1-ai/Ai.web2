import { describe, it, expect } from 'vitest';
import { detectLeakedFieldLabels } from '@/lib/webBuildContentNarrative';
import { deriveMissingCriticalCopy } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification, FrontendBuilderValidationArtifact } from '@/lib/webBuildAgents';

/**
 * Internal field-label leak (Fix B) + fidelity-conflict removal (Fix C).
 *
 * Fix B: a `Headline:`/`Subheadline:`/… prefix rendered as the START of a visible text node is a
 * deterministic gate-critical leak; ordinary prose containing a colon must NOT be flagged.
 * Fix C: an authoritative spec copy value written with such a prefix must have ONLY the prefix
 * stripped before verbatim fidelity, so the repair is never told to preserve the internal label.
 *
 * Pure: no model/provider call, no network, no live build.
 */

describe('detectLeakedFieldLabels — anchored visible-copy prefix leak (Fix B)', () => {
  it('detects a leaked "Headline:" at a text-node start', () => {
    expect(detectLeakedFieldLabels('<h1>Headline: Foo</h1>')).toEqual(['headline']);
  });

  it('detects a leaked "Subheadline:"', () => {
    expect(detectLeakedFieldLabels('<p>Subheadline: Bar</p>')).toEqual(['subheadline']);
  });

  it('detects each listed field-label prefix at a node start', () => {
    for (const label of ['headline', 'subheadline', 'subtitle', 'eyebrow', 'cta', 'body', 'description', 'label']) {
      const cap = label[0].toUpperCase() + label.slice(1);
      expect(detectLeakedFieldLabels(`<span>${cap}: real text</span>`)).toEqual([label]);
    }
  });

  it('does NOT flag legitimate prose containing a colon ("Pricing: simple")', () => {
    expect(detectLeakedFieldLabels('<p>Pricing: simple</p>')).toEqual([]);
  });

  it('does NOT flag a non-field word before a colon, nor a mid-node colon', () => {
    expect(detectLeakedFieldLabels('<p>Our pricing: simple and clear</p>')).toEqual([]);
    // "headline" appears, but mid-sentence (not at the node start) → not anchored → not flagged
    expect(detectLeakedFieldLabels('<p>A good headline: keep it short</p>')).toEqual([]);
    expect(detectLeakedFieldLabels('<h2>Everything you need: shipped weekly</h2>')).toEqual([]);
  });

  it('does NOT flag a prefix inside an attribute value (not visible text)', () => {
    expect(detectLeakedFieldLabels('<img alt="Headline: x" src="/a.png" />')).toEqual([]);
    expect(detectLeakedFieldLabels('<div data-note="CTA: click">real copy</div>')).toEqual([]);
    // `>` may appear inside a quoted attribute; that is not a text-node boundary
    expect(detectLeakedFieldLabels('<div data-hint="see >Headline: above">real copy</div>')).toEqual([]);
  });

  it('does NOT flag a prefix inside a string literal or JSX braced expression', () => {
    expect(detectLeakedFieldLabels("const tip = '>Headline: ignore'; return <p>ok</p>;")).toEqual([]);
    expect(detectLeakedFieldLabels("<h1>{'>Headline: ' + title}</h1>")).toEqual([]);
    expect(detectLeakedFieldLabels('<p>{"Subheadline: hidden"}</p>')).toEqual([]);
  });

  it('collects distinct prefixes across multiple nodes', () => {
    const got = detectLeakedFieldLabels('<h1>Headline: Foo</h1><p>Subheadline: Bar</p><a>CTA: Book</a>');
    expect(new Set(got)).toEqual(new Set(['headline', 'subheadline', 'cta']));
  });

  it('is case-insensitive and tolerant of whitespace before the colon', () => {
    expect(detectLeakedFieldLabels('<h1>HEADLINE : Foo</h1>')).toEqual(['headline']);
  });
});

/** Minimal spec carrying only architecture.sections[].headline/primaryCTA (cast through unknown). */
function spec(sections: Array<{ id: string; headline?: string; primaryCTA?: string }>): FrontendBuildSpecification {
  return { architecture: { sections } } as unknown as FrontendBuildSpecification;
}
/** Minimal validation artifact carrying only the bounded missingCriticalCopy previews. */
function validation(previews: string[]): FrontendBuilderValidationArtifact {
  return { missingCriticalCopy: previews } as unknown as FrontendBuilderValidationArtifact;
}

describe('deriveMissingCriticalCopy — strips internal field-label prefix from required copy (Fix C)', () => {
  it('requires only the real public text "Foo", never "Headline: Foo"', () => {
    const out = deriveMissingCriticalCopy(spec([{ id: 'hero', headline: 'Headline: Foo' }]), validation(['Foo']));
    expect(out).toEqual([{ sectionId: 'hero', field: 'headline', value: 'Foo' }]);
  });

  it('strips a leaked CTA prefix too', () => {
    const out = deriveMissingCriticalCopy(spec([{ id: 'cta', primaryCTA: 'CTA: Book now' }]), validation(['Book now']));
    expect(out).toEqual([{ sectionId: 'cta', field: 'primaryCTA', value: 'Book now' }]);
  });

  it('leaves clean authoritative copy untouched', () => {
    const out = deriveMissingCriticalCopy(spec([{ id: 'hero', headline: 'Real headline copy' }]), validation(['Real headline copy']));
    expect(out).toEqual([{ sectionId: 'hero', field: 'headline', value: 'Real headline copy' }]);
  });

  it('does NOT strip a non-field-label word before a colon (narrow)', () => {
    const out = deriveMissingCriticalCopy(spec([{ id: 'plans', headline: 'Pricing: simple' }]), validation(['Pricing: simple']));
    expect(out).toEqual([{ sectionId: 'plans', field: 'headline', value: 'Pricing: simple' }]);
  });

  it('the stripped required value contains no prefix the repair could re-introduce', () => {
    const out = deriveMissingCriticalCopy(spec([{ id: 'hero', headline: 'Subheadline: Ship faster' }]), validation(['Ship faster']));
    expect(out[0].value).toBe('Ship faster');
    expect(out[0].value.toLowerCase()).not.toContain('subheadline:');
  });
});
