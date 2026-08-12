import { describe, it, expect } from 'vitest';
import {
  detectRawNativeControls, detectLightSurfaceInDarkApp, detectFlatButtonHierarchy,
  type AppUiSourceFile,
} from '@/lib/appUiQuality';

const tsx = (path: string, content: string): AppUiSourceFile => ({ path, content, language: 'tsx' });
const has = (out: { code: string }[], code: string) => out.some((f) => f.code === code);

/* ── Bugbot #1 — JSX arrow ">" must not truncate the tag scan ─────────────────── */
describe('Bugbot #1 — JSX-aware tag scanning (arrow handlers no longer truncate attributes)', () => {
  it('A. select with onChange arrow BEFORE className → themed → PASS', () => {
    const f = tsx('a.tsx', `<select onChange={(e) => setValue(e.target.value)} className="bg-slate-800 border rounded">
      <option>x</option></select>`);
    expect(detectRawNativeControls({ files: [f], appType: 'crm' })).toEqual([]);
  });

  it('B. className BEFORE the handler → PASS', () => {
    const f = tsx('a.tsx', `<select className="bg-slate-800" onChange={(e) => setV(e.target.value)}><option>x</option></select>`);
    expect(detectRawNativeControls({ files: [f], appType: 'crm' })).toEqual([]);
  });

  it('C. multiline attributes with an arrow → PASS', () => {
    const f = tsx('a.tsx', `<select\n  value={v}\n  onChange={(e) => {\n    setV(e.target.value);\n  }}\n  className="border rounded-md"\n>\n<option>x</option>\n</select>`);
    expect(detectRawNativeControls({ files: [f], appType: 'crm' })).toEqual([]);
  });

  it('D. a quoted ">" inside an attribute does not end the tag → PASS', () => {
    const f = tsx('a.tsx', `<select data-tip="a > b" className="bg-slate-800" onChange={(e) => setV(e.target.value)}><option>x</option></select>`);
    expect(detectRawNativeControls({ files: [f], appType: 'crm' })).toEqual([]);
  });

  it('E. a genuinely unstyled native select → finding', () => {
    const f = tsx('a.tsx', `<select onChange={(e) => setV(e.target.value)}><option>x</option></select>`);
    expect(has(detectRawNativeControls({ files: [f], appType: 'crm' }), 'app-native-control-theme')).toBe(true);
  });

  it('F. malformed / unterminated tag → fail open, no false positive', () => {
    const f = tsx('a.tsx', `<select onChange={(e) => setV(`); // never closed
    expect(detectRawNativeControls({ files: [f], appType: 'crm' })).toEqual([]);
  });
});

/* ── Bugbot #2 — popup-surface finding must not match icon names ──────────────── */
describe('Bugbot #2 — light-surface check is scoped to actual popup surfaces', () => {
  it('A. lucide Menu icon import + bg-white/10 badge in a dark app → PASS', () => {
    const f = tsx('a.tsx', `import { Menu } from 'lucide-react';
      export default function H(){return <header><Menu className="h-5 w-5"/><span className="bg-white/10 px-2 rounded">3</span></header>;}`);
    expect(detectLightSurfaceInDarkApp({ files: [f], colorMode: 'dark' })).toEqual([]);
  });

  it('B. dark app + an actual *Content menu surface with bg-white → finding', () => {
    const f = tsx('a.tsx', `<DropdownMenuContent className="bg-white text-black rounded-md shadow">...</DropdownMenuContent>`);
    expect(has(detectLightSurfaceInDarkApp({ files: [f], colorMode: 'dark' }), 'app-surface-theme-mismatch')).toBe(true);
  });

  it('C. dark app + a themed dark menu surface → PASS', () => {
    const f = tsx('a.tsx', `<DropdownMenuContent className="bg-slate-800 text-slate-100 border border-slate-700">...</DropdownMenuContent>`);
    expect(detectLightSurfaceInDarkApp({ files: [f], colorMode: 'dark' })).toEqual([]);
  });

  it('D. an unrelated white card (not a popup surface) → PASS', () => {
    const f = tsx('a.tsx', `<div className="bg-white rounded-lg p-4 shadow">a card</div>`);
    expect(detectLightSurfaceInDarkApp({ files: [f], colorMode: 'dark' })).toEqual([]);
  });

  it('E. a Dialog content surface with a light background in a dark app → finding', () => {
    const f = tsx('a.tsx', `<DialogContent className="bg-white p-6 rounded-xl">confirm?</DialogContent>`);
    expect(has(detectLightSurfaceInDarkApp({ files: [f], colorMode: 'dark' }), 'app-surface-theme-mismatch')).toBe(true);
  });

  it('E2. a native role="menu" surface with a light background → finding (role-scoped, provable)', () => {
    const f = tsx('a.tsx', `<div role="menu" className="bg-white text-black rounded shadow">...</div>`);
    expect(has(detectLightSurfaceInDarkApp({ files: [f], colorMode: 'dark' }), 'app-surface-theme-mismatch')).toBe(true);
  });
});

/* ── Bugbot #3 — button hierarchy is per-button, not whole-file ───────────────── */
describe('Bugbot #3 — button hierarchy classifies actual buttons only', () => {
  it('A. three primary buttons + a bordered card elsewhere → finding (card border does not suppress)', () => {
    const f = tsx('a.tsx', `<div className="border rounded-lg p-4">
      <input className="border rounded px-2"/>
      <button className="bg-indigo-600 text-white" onClick={()=>{}}>One</button>
      <button className="bg-indigo-600 text-white" onClick={()=>{}}>Two</button>
      <button className="bg-indigo-600 text-white" onClick={()=>{}}>Three</button>
    </div>`);
    expect(has(detectFlatButtonHierarchy({ files: [f], appType: 'crm' }), 'app-button-hierarchy')).toBe(true);
  });

  it('B. a primary + a secondary button → PASS', () => {
    const f = tsx('a.tsx', `<div>
      <button className="bg-indigo-600 text-white" onClick={()=>{}}>Save</button>
      <button className="bg-slate-100 text-slate-700" onClick={()=>{}}>Cancel</button>
      <button className="bg-indigo-600 text-white" onClick={()=>{}}>Add</button>
      <button className="bg-indigo-600 text-white" onClick={()=>{}}>Send</button>
    </div>`);
    expect(detectFlatButtonHierarchy({ files: [f], appType: 'crm' })).toEqual([]);
  });

  it('C. a primary + a ghost (border-only) button → PASS', () => {
    const f = tsx('a.tsx', `<div>
      <button className="bg-indigo-600 text-white" onClick={()=>{}}>Save</button>
      <button className="border border-slate-300 text-slate-700" onClick={()=>{}}>Cancel</button>
      <button className="bg-indigo-600 text-white" onClick={()=>{}}>Add</button>
      <button className="bg-indigo-600 text-white" onClick={()=>{}}>Send</button>
    </div>`);
    expect(detectFlatButtonHierarchy({ files: [f], appType: 'crm' })).toEqual([]);
  });

  it('D. only one button → PASS', () => {
    const f = tsx('a.tsx', `<button className="bg-indigo-600 text-white" onClick={()=>{}}>Only</button>`);
    expect(detectFlatButtonHierarchy({ files: [f], appType: 'crm' })).toEqual([]);
  });

  it('E. custom Button components with primary/secondary variants → PASS', () => {
    const f = tsx('a.tsx', `<div>
      <Button variant="default" onClick={()=>{}}>Save</Button>
      <Button variant="secondary" onClick={()=>{}}>Cancel</Button>
      <Button variant="default" onClick={()=>{}}>Add</Button>
    </div>`);
    expect(detectFlatButtonHierarchy({ files: [f], appType: 'crm' })).toEqual([]);
  });

  it('F. an ambiguous unstyled wrapper with buttons but no style evidence → no false positive', () => {
    const f = tsx('a.tsx', `<Toolbar>
      <IconButton onClick={()=>{}}><Icon/></IconButton>
      <IconButton onClick={()=>{}}><Icon/></IconButton>
      <IconButton onClick={()=>{}}><Icon/></IconButton>
    </Toolbar>`);
    // No strong-fill / primary variant → 'neutral' → never reaches the dominant threshold.
    expect(detectFlatButtonHierarchy({ files: [f], appType: 'crm' })).toEqual([]);
  });

  it('G. custom *Button components all styled primary (variant) → finding', () => {
    const f = tsx('a.tsx', `<div>
      <Button variant="primary" onClick={()=>{}}>One</Button>
      <Button variant="primary" onClick={()=>{}}>Two</Button>
      <Button variant="primary" onClick={()=>{}}>Three</Button>
    </div>`);
    expect(has(detectFlatButtonHierarchy({ files: [f], appType: 'crm' }), 'app-button-hierarchy')).toBe(true);
  });
});
