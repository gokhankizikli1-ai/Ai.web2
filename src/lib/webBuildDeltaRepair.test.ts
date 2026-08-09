import { describe, it, expect } from 'vitest';
import {
  reconstructProjectFiles,
  reconstructRepairRawFromDelta,
  type DeltaUpsert,
} from '@/lib/webBuildDeltaRepair';
import { findDeltaIntroducedStructuralIssues } from '@/lib/webBuildFrontendValidation';
import type { FrontendBuilderRawArtifact, FrontendGeneratedFile } from '@/lib/webBuildAgents';

/**
 * Delta-repair structural-safety regression suite.
 *
 * Production case (FlowPilot): the bounded delta repair produced a reconstructed project that
 * failed Phase 12C static re-validation ("repair-failed-validation"), dropping the whole build to
 * Safe Preview. These tests pin the prevention:
 *   - a bounded delta that introduces an unresolved import / unsupported package / node builtin /
 *     unsafe path is REJECTED deterministically by the delta module (fail open to the original
 *     validated project, NO second call);
 *   - a valid bounded delta is still accepted;
 *   - untouched files are preserved byte-for-byte;
 *   - a case-variant upsert REPLACES the intended file instead of being added as a stray duplicate.
 * The guard reuses the exact Phase 12C rules, so it can never be stricter than the full validator.
 */

function file(path: string, content: string): FrontendGeneratedFile {
  const language = path.endsWith('.css') ? 'css' : path.endsWith('.tsx') ? 'tsx' : 'ts';
  return { path, language, content, charCount: content.length, lineCount: content.split('\n').length } as FrontendGeneratedFile;
}

// A minimal, structurally-valid original project (already passed Phase 12C).
function originalProject(): FrontendGeneratedFile[] {
  return [
    file('src/main.tsx', "import { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<App/>);"),
    file('src/App.tsx', "import Hero from './components/Hero';\nexport default function App(){ return <div><Hero/></div>; }"),
    file('src/components/Hero.tsx', "export default function Hero(){ return <section>Hero</section>; }"),
    file('src/styles.css', '@tailwind base;\n@tailwind components;\n@tailwind utilities;'),
  ];
}

function deltaRaw(upserts: Array<Partial<DeltaUpsert>>): FrontendBuilderRawArtifact {
  return {
    version: 'frontend-builder-raw-v1',
    status: 'completed',
    requestedFormat: 'frontend-files-v1',
    mode: 'frontend_builder',
    rawResponse: JSON.stringify({ upserts }),
    responseCharCount: 0,
    truncatedForStorage: false,
    validationStatus: 'not-run',
    reason: '',
    warnings: [],
    model: 'test-model', provider: 'test-provider', requestId: 'req-123',
  } as FrontendBuilderRawArtifact;
}

const reconstruct = (upserts: Array<Partial<DeltaUpsert>>) =>
  reconstructRepairRawFromDelta({ deltaRaw: deltaRaw(upserts), originalFiles: originalProject() });

describe('delta guard — invalid repair fails open to the original validated candidate', () => {
  it('unresolved import target introduced by the repair → rejected, fail-open, no second call', () => {
    const out = reconstruct([
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "import Chart from './Chart';\nexport default function Hero(){ return <section><Chart/></section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('failed');            // fail open — original preserved
    expect(out.diagnostics.accepted).toBe(false);
    expect(out.diagnostics.rejectionReason).toMatch(/unresolved-import/);
    // No second provider call — the failed raw carries the DELTA call's telemetry, nothing new.
    expect(out.repairRaw.provider).toBe('test-provider');
    expect(out.repairRaw.requestId).toBe('req-123');
  });

  it('unsupported package import introduced by the repair → rejected', () => {
    const out = reconstruct([
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "import axios from 'axios';\nexport default function Hero(){ return <section>{String(axios)}</section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('failed');
    expect(out.diagnostics.rejectionReason).toMatch(/unsupported-package/);
  });

  it('node built-in import introduced by the repair → rejected', () => {
    const out = reconstruct([
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "import fs from 'fs';\nexport default function Hero(){ return <section>{typeof fs}</section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('failed');
    expect(out.diagnostics.rejectionReason).toMatch(/node-builtin/);
  });

  it('unsafe added path (outside src/) introduced by the repair → rejected', () => {
    const out = reconstruct([
      { path: 'components/Widget.tsx', language: 'tsx', content: 'export default function Widget(){ return <div/>; }' },
    ]);
    expect(out.repairRaw.status).toBe('failed');
    expect(out.diagnostics.rejectionReason).toMatch(/unsafe-added-path/);
  });

  it('path-alias import (@/…) introduced by the repair → rejected', () => {
    const out = reconstruct([
      { path: 'src/App.tsx', language: 'tsx', content: "import Hero from '@/components/Hero';\nexport default function App(){ return <div><Hero/></div>; }" },
    ]);
    expect(out.repairRaw.status).toBe('failed');
    expect(out.diagnostics.rejectionReason).toMatch(/unsupported-alias/);
  });
});

describe('delta guard — valid bounded repairs remain accepted', () => {
  it('a valid in-place edit (no new imports) is accepted', () => {
    const out = reconstruct([
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "export default function Hero(){ return <section className='hero'>Premium Hero</section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('completed');
    expect(out.diagnostics.accepted).toBe(true);
  });

  it('a new component that is also included as an upsert (import resolves) is accepted', () => {
    const out = reconstruct([
      { path: 'src/components/Chart.tsx', language: 'tsx', content: "export default function Chart(){ return <div>chart</div>; }" },
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "import Chart from './Chart';\nexport default function Hero(){ return <section><Chart/></section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('completed');
    expect(out.diagnostics.accepted).toBe(true);
    expect(out.changedPaths).toEqual(['src/components/Chart.tsx', 'src/components/Hero.tsx']);
  });
});

describe('reconstructProjectFiles — preservation + case-variant replace', () => {
  it('untouched files are preserved byte-for-byte', () => {
    const original = originalProject();
    const upserts: DeltaUpsert[] = [
      { path: 'src/components/Hero.tsx', language: 'tsx', content: 'export default function Hero(){ return <section>New</section>; }' },
    ];
    const rebuilt = reconstructProjectFiles(original, upserts);
    for (const p of ['src/main.tsx', 'src/App.tsx', 'src/styles.css']) {
      expect(rebuilt.find((f) => f.path === p)!.content).toBe(original.find((f) => f.path === p)!.content);
    }
    // The edited file changed; no file was added or removed.
    expect(rebuilt).toHaveLength(original.length);
    expect(rebuilt.find((f) => f.path === 'src/components/Hero.tsx')!.content).toContain('New');
  });

  it('a case-variant upsert REPLACES the intended file (keeps original exact path, no duplicate)', () => {
    const original = originalProject(); // has src/components/Hero.tsx
    const rebuilt = reconstructProjectFiles(original, [
      { path: 'src/components/hero.tsx', language: 'tsx', content: 'export default function Hero(){ return <section>Cased</section>; }' },
    ]);
    // No stray duplicate; still the same file count; path keeps the ORIGINAL case.
    expect(rebuilt).toHaveLength(original.length);
    const hero = rebuilt.filter((f) => f.path.toLowerCase() === 'src/components/hero.tsx');
    expect(hero).toHaveLength(1);
    expect(hero[0].path).toBe('src/components/Hero.tsx'); // original exact path preserved
    expect(hero[0].content).toContain('Cased');          // the edit WAS applied
  });

  it('a genuinely new file is added with its own path', () => {
    const original = originalProject();
    const rebuilt = reconstructProjectFiles(original, [
      { path: 'src/components/Footer.tsx', language: 'tsx', content: 'export default function Footer(){ return <footer/>; }' },
    ]);
    expect(rebuilt).toHaveLength(original.length + 1);
    expect(rebuilt.find((f) => f.path === 'src/components/Footer.tsx')).toBeTruthy();
  });
});

describe('findDeltaIntroducedStructuralIssues — subset of Phase 12C, changed files only', () => {
  const reconstructed = [
    { path: 'src/main.tsx', content: "import App from './App';" },
    { path: 'src/App.tsx', content: "import Hero from './components/Hero';" },
    { path: 'src/components/Hero.tsx', content: 'export default function Hero(){ return null; }' },
    { path: 'src/styles.css', content: '@tailwind base;' },
  ];

  it('reports nothing when the changed file only uses resolvable imports', () => {
    expect(findDeltaIntroducedStructuralIssues(reconstructed, ['src/App.tsx'])).toEqual([]);
  });

  it('does NOT re-check untouched files (only the changed set)', () => {
    // A pre-existing (untouched) file with a bad import is NOT reported — it was already validated.
    const withBad = [...reconstructed, { path: 'src/Other.tsx', content: "import X from './Nope';" }];
    expect(findDeltaIntroducedStructuralIssues(withBad, ['src/App.tsx'])).toEqual([]);
    // But when that file IS the changed one, it is reported.
    const issues = findDeltaIntroducedStructuralIssues(withBad, ['src/Other.tsx']);
    expect(issues.map((i) => i.code)).toContain('unresolved-import');
  });

  it('owner/non-owner: pure function, no owner input — identical output for identical input', () => {
    const a = findDeltaIntroducedStructuralIssues(reconstructed, ['src/App.tsx']);
    const b = findDeltaIntroducedStructuralIssues(reconstructed, ['src/App.tsx']);
    expect(a).toEqual(b);
  });
});
