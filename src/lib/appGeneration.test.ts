import { describe, it, expect } from 'vitest';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { buildFrontendBuilderRequest } from '@/lib/webBuildApi';
import { parseAndValidateFrontendBuilderRaw } from '@/lib/webBuildFrontendValidation';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';
import type { FrontendBuilderRawArtifact } from '@/lib/webBuildAgents';

function specFor(prompt: string, buildType: 'app' | 'web'): FrontendBuildSpecification {
  const brief: WebBuildBrief = { type: buildType === 'app' ? 'app' : 'website' };
  const sections = [{ id: 'home', name: 'Home' }, { id: 'detail', name: 'Detail' }];
  const input: FrontendBuildSpecInput = {
    prompt, lang: 'en', buildType, brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
  };
  return deriveFrontendBuildSpecification(input);
}

/** Build a minimal-but-VALID frontend-files-v1 envelope for the app spec: the three
 *  entry files plus one component per required screen file, with a react-router App. */
function buildAppEnvelope(spec: FrontendBuildSpecification, opts?: { omitFirstScreen?: boolean }): string {
  const req = spec.outputContract.requiredFiles;
  const screenFiles = req.filter((f) => f.startsWith('src/screens/'));
  const kept = opts?.omitFirstScreen ? screenFiles.slice(1) : screenFiles;
  const compFor = (f: string) => f.replace('src/screens/', '').replace('.tsx', '');
  const file = (path: string, lang: string, content: string) =>
    `### FILE ${path}\n\`\`\`${lang}\n${content}\n\`\`\`\n### END_FILE`;

  const imports = kept.map((f) => `import ${compFor(f)} from './screens/${compFor(f)}';`).join('\n');
  const routes = kept.map((f, i) => `        <Route path="${i === 0 ? '/' : '/' + compFor(f).toLowerCase()}" element={<${compFor(f)} />} />`).join('\n');
  const appTsx = `import { HashRouter, Routes, Route } from 'react-router';\n${imports}\n\nexport default function App() {\n  return (\n    <HashRouter>\n      <Routes>\n${routes}\n      </Routes>\n    </HashRouter>\n  );\n}`;
  const mainTsx = `import { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\n\ncreateRoot(document.getElementById('root')!).render(<App />);`;
  const stylesCss = `@tailwind base;\n@tailwind components;\n@tailwind utilities;`;
  const screenBodies = kept.map((f) => {
    const c = compFor(f);
    return file(f, 'tsx', `import { useState } from 'react';\n\nexport default function ${c}() {\n  const [q, setQ] = useState('');\n  return (\n    <div className="p-4">\n      <h1 className="text-xl font-semibold">${c}</h1>\n      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />\n      <button onClick={() => setQ('')}>Clear</button>\n    </div>\n  );\n}`);
  });

  return [
    '## FRONTEND_FILES_V1',
    file('src/main.tsx', 'tsx', mainTsx),
    file('src/App.tsx', 'tsx', appTsx),
    file('src/styles.css', 'css', stylesCss),
    ...screenBodies,
    '## END_FRONTEND_FILES_V1',
  ].join('\n');
}

function rawFor(envelope: string): FrontendBuilderRawArtifact {
  return {
    version: 'frontend-builder-raw-v1',
    status: 'completed',
    requestedFormat: 'frontend-files-v1',
    mode: 'frontend_builder',
    rawResponse: envelope,
    responseCharCount: envelope.length,
    truncatedForStorage: false,
    validationStatus: 'not-run',
    reason: 'test fixture',
    warnings: [],
  };
}

describe('Phase 5 — app generation request', () => {
  it('C. an app request declares frontend-files-v1 + the app authority blocks', () => {
    const spec = specFor('Build a CRM for a sales team with contacts and deals', 'app');
    const req = buildFrontendBuilderRequest(spec);
    // A/B. Uses the [FRONTEND BUILDER REQUEST] header → backend resolves initial-generation
    // = gpt-5.6 / reasoning low / 24k (same mode + header as web; no extra call).
    expect(req).toContain('[FRONTEND BUILDER REQUEST]');
    expect(req).toContain('Required response format: frontend-files-v1');
    expect(req).toContain('[APP ARCHITECTURE]');
    expect(req).toContain('[APP NAVIGATION]');
    expect(req).toContain('[APP SCREEN DEPTH & STATE LIFECYCLE]');
    expect(req).toContain('[APP VISUAL SYSTEM]');
    expect(req).toMatch(/MULTI-SCREEN React \+ TypeScript \+ Tailwind application/);
    // It must NOT frame the app as scrolling page sections / publicCopy.
    expect(req).not.toContain('Render ONLY each');
  });

  it('G. a web request is unchanged — still page-section framing, no app blocks', () => {
    const spec = specFor('Build a landing page for a bakery', 'web');
    const req = buildFrontendBuilderRequest(spec);
    expect(req).toContain('[FRONTEND BUILDER REQUEST]');
    expect(req).toContain('Render ONLY each');           // web section framing preserved
    expect(req).not.toContain('[APP ARCHITECTURE]');     // no app blocks leak into web
    expect(req).not.toContain('[APP NAVIGATION]');
  });
});

describe('Phase 5 — app structural validation', () => {
  it('F. a valid multi-screen app project passes static validation', () => {
    const spec = specFor('Build a personal productivity task manager with projects', 'app');
    const envelope = buildAppEnvelope(spec);
    const result = parseAndValidateFrontendBuilderRaw(rawFor(envelope), spec);
    expect(result.status).toBe('valid');
    expect(result.errors.length).toBe(0);
  });

  it('E. a dead nav target (a planned screen the model never generated) is rejected/repairable', () => {
    const spec = specFor('Build a personal productivity task manager with projects', 'app');
    const envelope = buildAppEnvelope(spec, { omitFirstScreen: true });
    const result = parseAndValidateFrontendBuilderRaw(rawFor(envelope), spec);
    expect(result.status).toBe('invalid');
    expect(result.errors.some((e) => e.code === 'missing-required-file')).toBe(true);
  });

  it('the app spec requires screen component files (no scrolling section files)', () => {
    const spec = specFor('Build a SaaS analytics dashboard', 'app');
    expect(spec.outputContract.requiredFiles.some((f) => f.startsWith('src/screens/'))).toBe(true);
    expect(spec.outputContract.requiredSectionComponentFiles).toHaveLength(0);
  });

  it('D. an app spec carries the app contracts and the web page-composition contracts are absent', () => {
    const spec = specFor('Build a CRM for a sales team', 'app');
    expect(spec.buildType).toBe('app');
    expect(spec.appArchitecture).toBeDefined();
    expect(spec.navigation).toBeDefined();
    expect(spec.screenDepth).toBeDefined();
    expect(spec.appVisual).toBeDefined();
    // Web page-composition contracts must NOT be derived for an app.
    expect(spec.composition).toBeUndefined();
    expect(spec.siteDepth).toBeUndefined();
    expect(spec.visualConcept).toBeUndefined();
    expect(spec.contentNarrative).toBeUndefined();
  });
});
