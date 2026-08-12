/**
 * Tests — Phase 5: app structural validation (adds to, never replaces, web validation).
 *
 * Conservative + fail-open: only a provably-missing structural element is faulted —
 * entry file, per-screen source files, routes resolving to real screens, router wiring.
 * A real multi-file app passes; a single-screen app may inline its one screen.
 */
import { describe, it, expect } from 'vitest';
import { deriveAppArchitectureContract, deriveNavigationContract } from '@/lib/appBuildArchitecture';
import { validateAppStructure, hasBlockingAppStructuralFindings } from '@/lib/appBuildValidation';
import type { AppSourceFile } from '@/lib/appBuildScreenDepth';

const file = (path: string, content = '<div/>'): AppSourceFile => ({ path, content });
const CRM = 'Build a CRM for a sales team with contacts and a deal pipeline';
const crmArch = deriveAppArchitectureContract({ prompt: CRM });
const crmNav = deriveNavigationContract(crmArch)!;

function crmFiles(): AppSourceFile[] {
  const screens = crmArch.screens.map((s) => file(`src/screens/${s.id}.tsx`, `export default function ${s.id}(){return <div/>}`));
  return [
    file('src/App.tsx', 'import { Routes, Route } from "react-router"; export default function App(){ return <Routes>{/* /pipeline /contacts /contact-detail /contact-edit /settings */}</Routes> }'),
    file('src/main.tsx', 'import App from "./App"'),
    ...screens,
  ];
}

describe('app structural validation — real multi-file app passes', () => {
  it('a full screen set + entry + router passes', () => {
    const res = validateAppStructure(crmFiles(), crmArch, crmNav);
    expect(res.status).toBe('pass');
    expect(res.legacy).toBe(true);
    expect(res.screenFilesFound).toBe(crmArch.screens.length);
    expect(hasBlockingAppStructuralFindings(res)).toBe(false);
  });
});

describe('app structural validation — provable gaps are faulted', () => {
  it('flags a missing entry file', () => {
    const files = crmFiles().filter((f) => !/App\.tsx|main\.tsx|index\./i.test(f.path));
    const res = validateAppStructure(files, crmArch, crmNav);
    expect(res.issues.map((i) => i.code)).toContain('missing-entry-file');
    expect(hasBlockingAppStructuralFindings(res)).toBe(true);
  });

  it('flags a declared screen with no source file', () => {
    const files = crmFiles().filter((f) => !f.path.includes('contact-detail'));
    const res = validateAppStructure(files, crmArch, crmNav);
    expect(res.issues.map((i) => i.code)).toContain('missing-screen-file');
  });

  it('flags routes when the router is not wired at all', () => {
    const screens = crmArch.screens.map((s) => file(`src/screens/${s.id}.tsx`));
    const files = [file('src/App.tsx', 'export default function App(){ return <div>hello</div> }'), file('src/main.tsx'), ...screens];
    const res = validateAppStructure(files, crmArch, crmNav);
    // Screen files exist, but no router wiring nor route-path references.
    expect(res.issues.map((i) => i.code)).toContain('router-not-wired');
  });

  it('fails open on empty inputs', () => {
    expect(validateAppStructure(undefined, crmArch, crmNav).legacy).toBe(false);
    expect(validateAppStructure([], crmArch, crmNav).status).toBe('pass');
    expect(validateAppStructure([file('x.tsx')], undefined, undefined).status).toBe('pass');
  });
});

describe('app structural validation — a single-screen utility may inline its screen', () => {
  it('does not require a separate screen file for a one-screen app', () => {
    const uArch = deriveAppArchitectureContract({ prompt: 'Build a tip calculator' });
    const uNav = deriveNavigationContract(uArch)!;
    const files = [file('src/App.tsx', 'export default function App(){ return <div><input/><output/></div> }'), file('src/main.tsx')];
    const res = validateAppStructure(files, uArch, uNav);
    expect(res.status).toBe('pass');
  });
});
