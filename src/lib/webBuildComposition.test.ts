import { describe, it, expect } from 'vitest';
import {
  deriveCompositionContract,
  renderCompositionBlock,
  buildCompositionDiagnostics,
  type CompositionInput,
} from '@/lib/webBuildComposition';

function sections(n: number) {
  const base = [
    { id: 'hero', name: 'Hero', purpose: 'introduce the product', order: 0, interactionHints: [] },
    { id: 'features', name: 'Features', purpose: 'feature overview', order: 1 },
    { id: 'tool', name: 'Estimator', purpose: 'interactive estimator tool', order: 2, interactionHints: ['calculator'] },
    { id: 'proof', name: 'Proof', purpose: 'customer testimonials and results', order: 3 },
    { id: 'gallery', name: 'Gallery', purpose: 'showcase gallery', order: 4 },
    { id: 'cta', name: 'Get started', purpose: 'convert the visitor', order: 5 },
  ];
  return base.slice(0, n);
}
function input(over: Partial<CompositionInput> = {}): CompositionInput {
  return {
    identity: { sector: 'ai-saas', primaryConcept: 'workflow platform' } as CompositionInput['identity'],
    sections: sections(6) as unknown as CompositionInput['sections'],
    ...over,
  };
}

describe('webBuildComposition — whole-page rhythm (Phases 2–3)', () => {
  it('derives a bounded rhythm with EXACTLY one visual peak and is deterministic', () => {
    const a = deriveCompositionContract(input())!;
    const b = deriveCompositionContract(input())!;
    expect(a.pageRhythm).toBeTruthy();
    expect(JSON.stringify(a.pageRhythm)).toBe(JSON.stringify(b.pageRhythm));
    const r = a.pageRhythm!;
    expect(r.beats.length).toBe(a.sections.length);
    const peaks = r.beats.filter((x) => x.intensity === 'peak');
    expect(peaks.length).toBe(1);                              // never two climaxes
    expect(r.peakSectionId).toBe(peaks[0].sectionId);
    // the opening beat is the hero; each beat carries a role/intensity/background
    expect(r.beats[0].role).toBe('opening');
    for (const beat of r.beats) {
      expect(beat.role.length).toBeGreaterThan(0);
      expect(['low', 'medium', 'high', 'peak']).toContain(beat.intensity);
      expect(['canvas', 'tinted', 'inverted', 'media']).toContain(beat.background);
      expect(['same', 'step-up', 'step-down', 'flip']).toContain(beat.contrastWithPrev);
    }
  });

  it('marks the interactive tool as the demonstration beat and the finale as conversion/resolution', () => {
    const c = deriveCompositionContract(input())!;
    const byId = new Map(c.pageRhythm!.beats.map((b) => [b.sectionId, b]));
    expect(byId.get('tool')!.role).toBe('demonstration');
    const lastBeat = c.pageRhythm!.beats[c.pageRhythm!.beats.length - 1];
    expect(['conversion', 'resolution']).toContain(lastBeat.role);
  });

  it('renders the rhythm into the composition block and ties each section line to its beat', () => {
    const c = deriveCompositionContract(input())!;
    const text = renderCompositionBlock(c).join('\n');
    expect(text).toMatch(/WHOLE-PAGE RHYTHM/);
    expect(text).toMatch(/single visual climax|visual peak/i);
    expect(text).toMatch(/beat:opening\//);
  });

  it('surfaces rhythm in diagnostics', () => {
    const c = deriveCompositionContract(input())!;
    const d = buildCompositionDiagnostics(c, undefined, 100)!;
    expect(d.pageRhythmBeatCount).toBe(c.sections.length);
    expect(d.pageRhythmPeakSectionId.length).toBeGreaterThan(0);
  });

  it('handles a minimal one-section page without throwing (hero is the peak)', () => {
    const c = deriveCompositionContract(input({ sections: sections(1) as unknown as CompositionInput['sections'] }))!;
    expect(c.pageRhythm!.beats.length).toBe(1);
    expect(c.pageRhythm!.peakSectionId).toBe('hero');
    expect(c.pageRhythm!.beats[0].intensity).toBe('peak');
  });

  it('is backward-compatible: legacy (no sections) returns undefined contract', () => {
    expect(deriveCompositionContract({ identity: { sector: 'general' } as CompositionInput['identity'], sections: [] })).toBeUndefined();
  });
});
