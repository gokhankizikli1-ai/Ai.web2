/**
 * Quality V2 — deterministic OPTIMIZATION PASS.
 *
 * These tests pin the two properties that make the pass safe to run on every build:
 *   1. it finds REAL, measurable waste (and reports the measurement, not an estimate);
 *   2. it stays quiet on healthy code, and its output can never outrank real work.
 */
import { describe, it, expect } from 'vitest';
import { analyzeOptimization, optimizationToReviewIssues, isOptimizationClean } from '@/lib/webBuildOptimizationPass';
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

function file(path: string, content: string): FrontendGeneratedFile {
  return {
    path,
    content,
    language: path.endsWith('.css') ? 'css' : 'tsx',
    lineCount: content.split('\n').length,
    charCount: content.length,
  } as FrontendGeneratedFile;
}

const CLEAN_HERO = `import { motion } from 'framer-motion';
export default function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Bosphorus Table</motion.h1>
      <img src="https://images.example.com/dining.jpg?w=1200" alt="The dining room at dusk" width={1200} height={800} />
    </section>
  );
}`;

describe('optimization pass — finds real, measurable waste', () => {
  it('reports an imported binding that is never used, and names it', () => {
    const r = analyzeOptimization([
      file('src/components/Menu.tsx', `import { useState, useMemo } from 'react';
export default function Menu() {
  const [open, setOpen] = useState(false);
  return <div onClick={() => setOpen(!open)}>Menu</div>;
}`),
    ]);
    expect(r.measured.deadImportCount).toBe(1);          // useMemo, not useState
    const f = r.findings.find((x) => x.code === 'dead-import');
    expect(f).toBeTruthy();
    expect(f!.evidence).toContain('useMemo');
    expect(f!.evidence).not.toContain('useState');
  });

  it('does not flag a binding that is only used inside JSX', () => {
    const r = analyzeOptimization([
      file('src/components/Card.tsx', `import { Star } from 'lucide-react';
export default function Card() { return <div><Star /></div>; }`),
    ]);
    expect(r.measured.deadImportCount).toBe(0);
  });

  it('never flags React itself (the automatic JSX runtime makes it legitimately unreferenced)', () => {
    const r = analyzeOptimization([
      file('src/components/Plain.tsx', `import React from 'react';
export default function Plain() { return <div>hi</div>; }`),
    ]);
    expect(r.measured.deadImportCount).toBe(0);
  });

  it('reports a component file nothing imports', () => {
    const r = analyzeOptimization([
      file('src/App.tsx', `import Hero from './components/Hero';
export default function App() { return <Hero />; }`),
      file('src/components/Hero.tsx', CLEAN_HERO),
      file('src/components/Orphan.tsx', 'export default function Orphan() { return <div>never rendered</div>; }'),
    ]);
    expect(r.measured.unreferencedComponentCount).toBe(1);
    expect(r.findings.find((x) => x.code === 'unreferenced-component')!.files).toContain('src/components/Orphan.tsx');
  });

  it('measures duplicated CSS as real characters saved, not a guess', () => {
    const body = 'display:flex; align-items:center; justify-content:space-between; padding:1.5rem 2rem;';
    const r = analyzeOptimization([
      file('src/styles.css', `.a { ${body} }\n.b { ${body} }\n.c { ${body} }`),
    ]);
    expect(r.measured.duplicateCssRuleCount).toBe(1);
    const f = r.findings.find((x) => x.code === 'duplicate-css-rule')!;
    // Two redundant copies of a ~84-char body.
    expect(f.magnitude).toBeGreaterThan(100);
    expect(r.measured.duplicateCssCharCount).toBe(f.magnitude);
  });

  it('reports an oversized remote image request with the offending file', () => {
    const r = analyzeOptimization([
      file('src/components/Gallery.tsx',
        '<img src="https://images.example.com/x.jpg?w=3200&h=2400" alt="a" loading="lazy" />'),
    ]);
    expect(r.measured.oversizedImageCount).toBe(1);
    const f = r.findings.find((x) => x.code === 'oversized-remote-image')!;
    expect(f.severity).toBe('high');
    expect(f.files).toContain('src/components/Gallery.tsx');
  });

  it('exempts the hero from lazy-loading but flags images below the fold', () => {
    const files = [
      file('src/components/Hero.tsx', '<img src="/hero.jpg" alt="hero" />'),
      file('src/components/Gallery.tsx', '<img src="/g1.jpg" alt="g1" /><img src="/g2.jpg" alt="g2" />'),
    ];
    const r = analyzeOptimization(files, { heroComponentPath: 'src/components/Hero.tsx' });
    expect(r.measured.imageCount).toBe(3);
    expect(r.measured.eagerOffscreenImageCount).toBe(2);   // the hero is correctly excluded
  });

  it('flags a dependency-less effect that writes state, but not one with a dependency array', () => {
    const bad = analyzeOptimization([
      file('src/components/Live.tsx', `useEffect(() => { setCount(count + 1); });`),
    ]);
    expect(bad.measured.unboundedEffectCount).toBe(1);

    const good = analyzeOptimization([
      file('src/components/Live.tsx', `useEffect(() => { setCount(1); }, []);`),
    ]);
    expect(good.measured.unboundedEffectCount).toBe(0);
  });

  it('does not mistake nested braces inside an effect body for a missing dependency array', () => {
    const r = analyzeOptimization([
      file('src/components/Live.tsx',
        `useEffect(() => { if (a) { setX({ deep: { nested: [1, 2] } }); } }, [a]);`),
    ]);
    expect(r.measured.unboundedEffectCount).toBe(0);
  });
});

describe('optimization pass — stays quiet and stays subordinate', () => {
  it('finds nothing in a healthy project', () => {
    const r = analyzeOptimization([
      file('src/App.tsx', `import Hero from './components/Hero';
export default function App() { return <Hero />; }`),
      file('src/components/Hero.tsx', CLEAN_HERO),
      file('src/styles.css', '@tailwind base;\n.brand { color: #123; }'),
    ], { heroComponentPath: 'src/components/Hero.tsx' });
    expect(r.findings).toEqual([]);
    expect(isOptimizationClean(r)).toBe(true);
    expect(optimizationToReviewIssues(r)).toEqual([]);
  });

  it('emits AT MOST ONE review issue, always minor, always in the performance category', () => {
    const r = analyzeOptimization([
      file('src/components/A.tsx', `import { useMemo, useRef } from 'react';\n<img src="/a.jpg?w=4000" alt="a" />`),
      file('src/components/B.tsx', `import { useCallback } from 'react';\nuseEffect(() => { setX(1); });`),
      file('src/styles.css', '.a { display:flex; align-items:center; justify-content:space-between; padding:1rem; }\n.b { display:flex; align-items:center; justify-content:space-between; padding:1rem; }\n.c { display:flex; align-items:center; justify-content:space-between; padding:1rem; }'),
    ]);
    expect(r.findings.length).toBeGreaterThan(2);
    const issues = optimizationToReviewIssues(r);
    // Exactly one issue means it consumes exactly one advisory slot in the fixed repair budget,
    // so it can never crowd out a functional or visual obligation.
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('minor');
    expect(issues[0].category).toBe('performance');
  });

  it('instructs the repair not to change the design', () => {
    const r = analyzeOptimization([
      file('src/components/A.tsx', `import { useMemo } from 'react';\nexport const A = 1;`),
    ]);
    const [issue] = optimizationToReviewIssues(r);
    expect(issue.repairInstruction.toLowerCase()).toContain('without changing the design');
  });

  it('fails open on unusable input instead of throwing', () => {
    expect(analyzeOptimization(undefined).findings).toEqual([]);
    expect(analyzeOptimization([]).findings).toEqual([]);
    expect(optimizationToReviewIssues(undefined)).toEqual([]);
    // A wrong-version artifact must be ignored rather than trusted.
    expect(optimizationToReviewIssues({ version: 'nope' } as never)).toEqual([]);
  });
});
