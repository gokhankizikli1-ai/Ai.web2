import { describe, it, expect } from 'vitest';
import {
  FIELD_LABEL_PREFIXES,
  stripLeadingFieldLabel,
  hasLeadingFieldLabel,
  leadingFieldLabelOf,
  detectLeakedFieldLabels,
} from '@/lib/webBuildFieldLabel';

/**
 * Canonical field-label boundary (Phase 1 strip + Phase 2 detection). Pure: no model/provider call,
 * no network, no live build.
 */

describe('stripLeadingFieldLabel — authoritative value normalization (Phase 1)', () => {
  it('strips a leading known field label, keeping the real copy', () => {
    expect(stripLeadingFieldLabel('Headline: Foo')).toBe('Foo');
    expect(stripLeadingFieldLabel('Subheadline: Bar')).toBe('Bar');
    expect(stripLeadingFieldLabel('CTA: Book a Demo')).toBe('Book a Demo');
    expect(stripLeadingFieldLabel('Body: Example')).toBe('Example');
    expect(stripLeadingFieldLabel('Description: Example')).toBe('Example');
    expect(stripLeadingFieldLabel('Label: Example')).toBe('Example');
    expect(stripLeadingFieldLabel('Subtitle: Example')).toBe('Example');
    expect(stripLeadingFieldLabel('Eyebrow: Example')).toBe('Example');
  });

  it('leaves legitimate colon-bearing prose intact (not a known field label)', () => {
    expect(stripLeadingFieldLabel('Pricing: simple and transparent')).toBe('Pricing: simple and transparent');
    expect(stripLeadingFieldLabel('Note: this is important')).toBe('Note: this is important');
    expect(stripLeadingFieldLabel('Status: operational')).toBe('Status: operational');
  });

  it('strips ONLY the leading prefix — later colons in the real copy survive', () => {
    expect(stripLeadingFieldLabel('Subheadline: Ship faster: now')).toBe('Ship faster: now');
  });

  it('tolerates case and whitespace variants', () => {
    expect(stripLeadingFieldLabel('HEADLINE : Foo')).toBe('Foo');
    expect(stripLeadingFieldLabel('  headline:Foo')).toBe('Foo');
    expect(stripLeadingFieldLabel('cta:   Book')).toBe('Book');
  });

  it('is a no-op on clean copy and empty input', () => {
    expect(stripLeadingFieldLabel('Automate everything')).toBe('Automate everything');
    expect(stripLeadingFieldLabel('')).toBe('');
    expect(stripLeadingFieldLabel(undefined as unknown as string)).toBe('');
  });

  it('hasLeadingFieldLabel / leadingFieldLabelOf agree with strip', () => {
    expect(hasLeadingFieldLabel('Headline: Foo')).toBe(true);
    expect(hasLeadingFieldLabel('Pricing: x')).toBe(false);
    expect(leadingFieldLabelOf('CTA: Book')).toBe('cta');
    expect(leadingFieldLabelOf('Pricing: x')).toBeNull();
  });

  it('exposes the full vocabulary', () => {
    expect([...FIELD_LABEL_PREFIXES]).toEqual(['headline', 'subheadline', 'subtitle', 'eyebrow', 'cta', 'body', 'description', 'label']);
  });
});

describe('detectLeakedFieldLabels — visible-copy leak detection (Phase 2)', () => {
  it('1. detects a plain text-node leak', () => {
    expect(detectLeakedFieldLabels('<h1>Headline: Foo</h1>')).toEqual(['headline']);
    expect(detectLeakedFieldLabels('<p>Subheadline: Bar</p>')).toEqual(['subheadline']);
  });

  it('2. detects a start-of-node string-literal expression leak', () => {
    expect(detectLeakedFieldLabels(`<h1>{'Headline: Foo'}</h1>`)).toEqual(['headline']);
    expect(detectLeakedFieldLabels('<h1>{"Headline: Foo"}</h1>')).toEqual(['headline']);
    expect(detectLeakedFieldLabels('<h1>{`Headline: Foo`}</h1>')).toEqual(['headline']);
  });

  it('3. detects a statically-resolvable const-backed leak', () => {
    const src = `const heroTitle = 'Headline: Foo';\nfunction Hero(){ return <h1>{heroTitle}</h1>; }`;
    expect(detectLeakedFieldLabels(src)).toEqual(['headline']);
  });

  it('4. does NOT flag an unresolved dynamic expression (no fake evaluator)', () => {
    expect(detectLeakedFieldLabels('<h1>{makeTitle()}</h1>')).toEqual([]);
    expect(detectLeakedFieldLabels('<h1>{a + b}</h1>')).toEqual([]);
    expect(detectLeakedFieldLabels('<h1>{props.title}</h1>')).toEqual([]);
    // const bound to a non-literal is not resolvable → not flagged
    expect(detectLeakedFieldLabels('const t = makeTitle();\n<h1>{t}</h1>')).toEqual([]);
  });

  it('5. does NOT flag legitimate colon prose, mid-node colons, or attribute values', () => {
    expect(detectLeakedFieldLabels('<p>Pricing: simple</p>')).toEqual([]);
    expect(detectLeakedFieldLabels('<p>Our pricing: simple</p>')).toEqual([]);
    expect(detectLeakedFieldLabels('<p>A good headline: keep it short</p>')).toEqual([]);
    expect(detectLeakedFieldLabels('<img alt="Headline: x" src="/a.png" />')).toEqual([]);
    expect(detectLeakedFieldLabels('<div data-note="CTA: click">real copy</div>')).toEqual([]);
    // const bound to legit prose → not a field label → not flagged
    expect(detectLeakedFieldLabels(`const t = 'Pricing: simple';\n<h1>{t}</h1>`)).toEqual([]);
  });

  it('collects distinct prefixes across mixed forms', () => {
    const src = `const cta = 'CTA: Book';\n<h1>Headline: Foo</h1><p>{'Subheadline: Bar'}</p><a>{cta}</a>`;
    expect(new Set(detectLeakedFieldLabels(src))).toEqual(new Set(['headline', 'subheadline', 'cta']));
  });
});
