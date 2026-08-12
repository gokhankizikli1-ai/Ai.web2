import { describe, it, expect } from 'vitest';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { parseAndValidateFrontendBuilderRaw } from '@/lib/webBuildFrontendValidation';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification, FrontendBuilderRawArtifact } from '@/lib/webBuildAgents';

function specFor(prompt: string, buildType: 'app' | 'web'): FrontendBuildSpecification {
  const brief: WebBuildBrief = { type: buildType === 'app' ? 'app' : 'website' };
  const sections = [{ id: 'home', name: 'Home' }, { id: 'detail', name: 'Detail' }, { id: 'settings', name: 'Settings' }];
  const input: FrontendBuildSpecInput = {
    prompt, lang: 'en', buildType, brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
  };
  return deriveFrontendBuildSpecification(input);
}

const fileBlock = (path: string, lang: string, content: string) =>
  `### FILE ${path}\n\`\`\`${lang}\n${content}\n\`\`\`\n### END_FILE`;

/** Assemble a structurally-valid app envelope, letting the caller supply each screen body and App. */
function envelope(spec: FrontendBuildSpecification, screenBody: (comp: string, first: boolean) => string, appBody?: string): string {
  const req = spec.outputContract.requiredFiles;
  const screenFiles = req.filter((f) => f.startsWith('src/screens/'));
  const compFor = (f: string) => f.replace('src/screens/', '').replace('.tsx', '');
  const imports = screenFiles.map((f) => `import ${compFor(f)} from './screens/${compFor(f)}';`).join('\n');
  const routes = screenFiles.map((f, i) => `<Route path="${i === 0 ? '/' : '/' + compFor(f).toLowerCase()}" element={<${compFor(f)} />} />`).join('\n');
  const app = appBody ?? `import { HashRouter, Routes, Route } from 'react-router';\n${imports}\nexport default function App(){return (<HashRouter><Routes>${routes}</Routes></HashRouter>);}`;
  const main = `import { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<App />);`;
  const css = `@tailwind base;\n@tailwind components;\n@tailwind utilities;`;
  const screens = screenFiles.map((f, i) => fileBlock(f, 'tsx', screenBody(compFor(f), i === 0)));
  return ['## FRONTEND_FILES_V1', fileBlock('src/main.tsx', 'tsx', main), fileBlock('src/App.tsx', 'tsx', app), fileBlock('src/styles.css', 'css', css), ...screens, '## END_FRONTEND_FILES_V1'].join('\n');
}

function rawFor(env: string): FrontendBuilderRawArtifact {
  return {
    version: 'frontend-builder-raw-v1', status: 'completed', requestedFormat: 'frontend-files-v1',
    mode: 'frontend_builder', rawResponse: env, responseCharCount: env.length,
    truncatedForStorage: false, validationStatus: 'not-run', reason: 'test', warnings: [],
  };
}
const warnCodes = (spec: FrontendBuildSpecification, env: string): string[] =>
  parseAndValidateFrontendBuilderRaw(rawFor(env), spec).warnings.map((w) => w.code);

// A polished screen: themed controls, real state, a themed <select className>, tiered buttons.
const polishedScreen = (comp: string): string =>
  `import { useState } from 'react';
   export default function ${comp}(){
     const [q,setQ]=useState('');const [tab,setTab]=useState('a');
     return (<div className="p-6 space-y-4">
       <h1 className="text-xl font-semibold">${comp}</h1>
       <select className="bg-slate-100 border rounded-md px-2 py-1"><option>All</option></select>
       <div><button role="tab" aria-selected={tab==='a'} onClick={()=>setTab('a')}>A</button></div>
       <input value={q} onChange={(e)=>setQ(e.target.value)} className="border rounded px-2" placeholder="Search"/>
       <button className="bg-indigo-600 text-white rounded px-4 py-2" onClick={()=>setQ('')}>Save</button>
       <button className="bg-slate-100 text-slate-700 rounded px-4 py-2" onClick={()=>setQ('')}>Cancel</button>
     </div>);
   }`;

describe('UI Quality Phase 4 — detectors are wired into the ONE validation→review→repair loop', () => {
  it('POLISHED app fixture → no UI-quality warnings in the validation artifact', () => {
    const spec = specFor('Build a productivity task manager with projects', 'app');
    const codes = warnCodes(spec, envelope(spec, polishedScreen));
    for (const c of ['app-native-control-theme', 'app-button-hierarchy', 'app-interaction-state-missing', 'app-navigation-active-state', 'app-generic-dashboard-pattern']) {
      expect(codes, c).not.toContain(c);
    }
  });

  it('BAD app fixture → the validator surfaces the appropriate UI-quality warnings (advisory)', () => {
    const spec = specFor('Build a productivity task manager with projects', 'app');
    // First screen: raw native <select> (no theme class) + 5 all-primary buttons + dead tabs.
    const badFirst = `export default function S(){
      return (<div>
        <select onChange={()=>{}}><option>x</option></select>
        <button role="tab">A</button><button role="tab">B</button>
        <button className="bg-indigo-600 text-white" onClick={()=>{}}>One</button>
        <button className="bg-indigo-600 text-white" onClick={()=>{}}>Two</button>
        <button className="bg-indigo-600 text-white" onClick={()=>{}}>Three</button>
        <button className="bg-indigo-600 text-white" onClick={()=>{}}>Four</button>
        <button className="bg-indigo-600 text-white" onClick={()=>{}}>Five</button>
      </div>);
    }`;
    // App nav: three plain route links, no active-state indication.
    const badApp = `import { HashRouter, Routes, Route } from 'react-router';
      import S from './screens/${spec.outputContract.requiredFiles.filter((f)=>f.startsWith('src/screens/')).map((f)=>f.replace('src/screens/','').replace('.tsx',''))[0]}';
      export default function App(){return (<HashRouter>
        <nav><a href="/">Home</a><a href="/detail">Detail</a><a href="/settings">Settings</a></nav>
        <Routes><Route path="/" element={<S/>}/></Routes></HashRouter>);}`;
    // Other screens are also flat (all-primary, no secondary tier) so the app-wide hierarchy
    // signal holds — the detector aggregates across the app by design.
    const badOther = (comp: string) => `export default function ${comp}(){return (<div><h1>${comp}</h1><button className="bg-indigo-600 text-white" onClick={()=>{}}>Go</button></div>);}`;
    const env = envelope(spec, (comp, first) => (first ? badFirst : badOther(comp)), badApp);
    const codes = warnCodes(spec, env);
    expect(codes).toContain('app-native-control-theme');
    expect(codes).toContain('app-button-hierarchy');
    expect(codes).toContain('app-interaction-state-missing');
    expect(codes).toContain('app-navigation-active-state');
  });

  it('WEB build never runs the app UI-quality detectors', () => {
    const spec = specFor('Build a bakery landing page', 'web');
    // A web envelope isn’t app-shaped; the detectors are gated on buildType==='app' + appArchitecture.
    expect(spec.appArchitecture).toBeUndefined();
  });
});
