import { describe, it, expect } from 'vitest';
import {
  detectAppUiQuality, detectRawNativeControls, detectLightSurfaceInDarkApp,
  detectFlatButtonHierarchy, detectDeadTabs, detectGenericDashboard,
  type AppUiSourceFile,
} from '@/lib/appUiQuality';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';

const tsx = (path: string, content: string): AppUiSourceFile => ({ path, content, language: 'tsx' });
const codes = (fs: AppUiSourceFile[], appType?: string, colorMode?: 'light' | 'dark' | 'mixed') =>
  detectAppUiQuality({ files: fs, appType, colorMode }).map((f) => f.code);

describe('UI Quality Phase 1 — component-quality static detection (conservative)', () => {
  // 1. polished custom dark select → PASS
  it('1. a polished themed select (Radix) produces no finding', () => {
    const f = tsx('src/screens/Filters.tsx',
      `import * as Select from '@radix-ui/react-select';
       export default function Filters(){return <Select.Root><Select.Trigger className="bg-slate-800 border border-slate-700 rounded-md text-slate-100 focus-visible:ring-2"/><Select.Content className="bg-slate-800 text-slate-100"/></Select.Root>}`);
    expect(detectRawNativeControls({ files: [f], appType: 'crm' })).toEqual([]);
  });

  // 2. intentionally simple native select in a minimal utility → PASS
  it('2. a raw native select inside a minimal utility is allowed (utility relaxes control polish)', () => {
    const f = tsx('src/screens/Convert.tsx', `export default function C(){return <select><option>m</option></select>}`);
    expect(detectRawNativeControls({ files: [f], appType: 'utility' })).toEqual([]);
    expect(codes([f], 'utility')).not.toContain('app-native-control-theme');
  });

  // 3. raw native-looking select inside premium dark dashboard → finding
  it('3. a raw browser-default select in a themed dark dashboard is flagged', () => {
    const f = tsx('src/screens/Dashboard.tsx', `export default function D(){return <div className="bg-slate-900"><select><option>Today</option></select></div>}`);
    const out = detectRawNativeControls({ files: [f], appType: 'analytics-dashboard' });
    expect(out.map((x) => x.code)).toContain('app-native-control-theme');
    expect(out[0].files).toContain('src/screens/Dashboard.tsx');
  });

  // 4. coherent primary/secondary buttons → PASS
  it('4. buttons with a real primary/secondary tier are not flagged', () => {
    const f = tsx('src/screens/Deals.tsx',
      `export default function Deals(){return <div>
        <button className="bg-indigo-600 text-white rounded-md px-4 py-2">Save</button>
        <button className="bg-slate-100 text-slate-700 rounded-md px-4 py-2">Cancel</button>
        <button className="bg-indigo-600 text-white rounded-md px-4 py-2">Add</button>
        <button className="bg-indigo-600 text-white rounded-md px-4 py-2">Send</button>
        <button className="bg-indigo-600 text-white rounded-md px-4 py-2">Go</button>
      </div>}`);
    expect(detectFlatButtonHierarchy({ files: [f], appType: 'crm' })).toEqual([]);
  });

  // 5. every action styled as primary → finding
  it('5. many equally-dominant primary buttons with no secondary tier are flagged', () => {
    const f = tsx('src/screens/Deals.tsx',
      `export default function Deals(){return <div>
        <button className="bg-indigo-600 text-white rounded-md px-4 py-2">Save</button>
        <button className="bg-indigo-600 text-white rounded-md px-4 py-2">Add</button>
        <button className="bg-indigo-600 text-white rounded-md px-4 py-2">Send</button>
        <button className="bg-indigo-600 text-white rounded-md px-4 py-2">Export</button>
        <button className="bg-indigo-600 text-white rounded-md px-4 py-2">Share</button>
      </div>}`);
    expect(detectFlatButtonHierarchy({ files: [f], appType: 'crm' }).map((x) => x.code)).toContain('app-button-hierarchy');
  });

  // 6. dead tabs → finding
  it('6. tab markup with no active-state tracking is flagged', () => {
    const f = tsx('src/screens/Reports.tsx',
      `export default function R(){return <div><button role="tab">Daily</button><button role="tab">Weekly</button><div>content</div></div>}`);
    expect(detectDeadTabs({ files: [f] }).map((x) => x.code)).toContain('app-interaction-state-missing');
  });

  // 7. working tabs → PASS
  it('7. tabs that track a selected state are not flagged', () => {
    const f = tsx('src/screens/Reports.tsx',
      `import {useState} from 'react';
       export default function R(){const [t,setT]=useState('daily');return <div><button role="tab" aria-selected={t==='daily'} onClick={()=>setT('daily')}>Daily</button></div>}`);
    expect(detectDeadTabs({ files: [f] })).toEqual([]);
  });

  // 8. theme-consistent modal → PASS (no light surface flagged in a dark app)
  it('8. a themed dark dialog surface produces no surface-mismatch finding', () => {
    const f = tsx('src/components/ConfirmDialog.tsx',
      `import * as Dialog from '@radix-ui/react-dialog';
       export default function C(){return <Dialog.Content className="bg-slate-800 text-slate-100 border border-slate-700 rounded-lg"/>}`);
    expect(detectLightSurfaceInDarkApp({ files: [f], colorMode: 'dark' })).toEqual([]);
  });

  // 9. white unstyled popup-like surface inside dark UI → finding
  it('9. a white menu/dialog surface in a dark app is flagged where statically provable', () => {
    const f = tsx('src/components/Menu.tsx',
      `export default function M(){return <div role="menu" className="bg-white text-black rounded-md shadow">...</div>}`);
    const out = detectLightSurfaceInDarkApp({ files: [f], colorMode: 'dark' });
    expect(out.map((x) => x.code)).toContain('app-surface-theme-mismatch');
    // In a LIGHT app the same surface is fine — the check is dark-app-only.
    expect(detectLightSurfaceInDarkApp({ files: [f], colorMode: 'light' })).toEqual([]);
  });

  it('generic-dashboard: a wall of identical stat cards with no chart/table/hierarchy is flagged; a real dashboard is not', () => {
    const wall = tsx('src/screens/Home.tsx',
      `export default function H(){return <div>${Array.from({ length: 6 }, () => '<div className="StatCard"/>').join('')}</div>}`);
    expect(detectGenericDashboard({ files: [wall] }).map((x) => x.code)).toContain('app-generic-dashboard-pattern');
    const real = tsx('src/screens/Home.tsx',
      `export default function H(){return <div><div className="lg:col-span-2"><LineChart/></div>${Array.from({ length: 6 }, () => '<div className="StatCard"/>').join('')}</div>}`);
    expect(detectGenericDashboard({ files: [real] })).toEqual([]);
  });

  it('runs all detectors together and is fail-open on junk input', () => {
    expect(detectAppUiQuality({ files: [] })).toEqual([]);
    expect(detectAppUiQuality({ files: [tsx('x.tsx', 'export const x = 1;')], appType: 'crm', colorMode: 'dark' })).toEqual([]);
  });
});

/* ── Contract: AppVisual now carries a bounded component-quality section ──────── */
function appSpec(prompt: string) {
  const brief: WebBuildBrief = { type: 'app' };
  const sections = [{ id: 'dashboard', name: 'Dashboard' }, { id: 'list', name: 'List' }, { id: 'settings', name: 'Settings' }];
  const input: FrontendBuildSpecInput = {
    prompt, lang: 'en', buildType: 'app', brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
  };
  return deriveFrontendBuildSpecification(input);
}

describe('UI Quality Phase 1 — AppVisual component-quality contract', () => {
  it('the derived app spec carries a bounded componentQuality contract for the key control families', () => {
    const spec = appSpec('Build a CRM for a sales team with contacts and deals');
    const cq = spec.appVisual?.componentQuality;
    expect(cq).toBeDefined();
    const joined = [cq!.buildStrategy, ...cq!.controls, cq!.interactionStates, cq!.surfaces].join(' ').toLowerCase();
    for (const family of ['button', 'input', 'select', 'tab', 'toggle', 'menu', 'table']) {
      expect(joined).toContain(family);
    }
    // It names the available primitives so no new dependency is introduced.
    expect(joined).toMatch(/radix/);
    // It forbids the browser-default popup failure mode.
    expect(joined).toMatch(/browser-default|native/);
  });

  it('a minimal utility relaxes the control build strategy (native control acceptable if themed)', () => {
    const util = appSpec('Build a small unit converter utility');
    const cq = util.appVisual?.componentQuality;
    expect(cq).toBeDefined();
    expect(cq!.buildStrategy.toLowerCase()).toContain('native');
  });
});
