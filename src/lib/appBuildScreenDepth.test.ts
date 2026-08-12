/**
 * Tests — Phase 3: App Screen Depth & Completeness + honest simulation.
 *
 * Exit gate (A–I): depth is role-derived (not a universal count); a heading-only
 * screen shell is caught while a real/dynamic screen is not; loading/empty/error
 * states appear only where relevant; a simple utility is never over-engineered; a
 * dishonest "backend success" claim is caught; honest simulation passes. Deterministic
 * and fail-open — never a false block.
 */
import { describe, it, expect } from 'vitest';
import { deriveAppArchitectureContract } from '@/lib/appBuildArchitecture';
import {
  deriveScreenDepthContract, analyzeAppCompleteness, hasBlockingAppCompletenessFindings,
  renderScreenDepthBlock, type AppSourceFile,
} from '@/lib/appBuildScreenDepth';

const archOf = (p: string) => deriveAppArchitectureContract({ prompt: p });
const depthOf = (p: string) => deriveScreenDepthContract(archOf(p))!;
const file = (path: string, content: string): AppSourceFile => ({ path, content });

const CRM = 'Build a CRM for a sales team with contacts and a deal pipeline';
const DASH = 'Build a SaaS analytics dashboard with KPIs and reports';
const TIP = 'Build a tip calculator';

describe('screen depth — role-derived substance & interaction patterns (A/D/E/F)', () => {
  it('A — a dashboard expects metrics/chart substance on its overview/progress screens', () => {
    const d = depthOf(DASH);
    const overview = d.screens.find((s) => s.screenId === 'overview')!;
    expect(overview.expects).toEqual(expect.arrayContaining(['metrics']));
  });

  it('D — list screens carry search + filter + list-detail patterns', () => {
    const d = depthOf(CRM);
    const contacts = d.screens.find((s) => s.screenId === 'contacts')!;
    expect(contacts.interactionPatterns).toEqual(expect.arrayContaining(['search', 'filter', 'list-detail']));
    expect(contacts.expects).toContain('list-items');
  });

  it('E — form screens expect form-fields (feedback states owned by the architecture)', () => {
    const d = depthOf(CRM);
    const edit = d.screens.find((s) => s.screenId === 'contact-edit')!;
    expect(edit.expects).toContain('form-fields');
    expect(edit.interactionPatterns).toContain('form');
  });

  it('F — a sidebar app declares the sidebar pattern; a tabbed app declares tabs', () => {
    expect(depthOf(CRM).interactionPatterns).toContain('sidebar');
    expect(depthOf('Build a shopping app with a product catalog, cart and checkout').interactionPatterns).toContain('tabs');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(depthOf(CRM))).toBe(JSON.stringify(depthOf(CRM)));
  });
});

describe('screen depth — H: intentionally-simple utility is not over-engineered', () => {
  it('a tip calculator gets one minimal screen with no browse depth', () => {
    const d = depthOf(TIP);
    expect(d.intentionallySimple).toBe(true);
    expect(d.screens).toHaveLength(1);
    expect(d.screens[0].intentionallyMinimal).toBe(true);
    expect(d.screens[0].interactionPatterns).toHaveLength(0);
  });
});

describe('app completeness — G: heading-only screen shells are caught, real screens are not', () => {
  const crmArch = archOf(CRM);
  const crmDepth = deriveScreenDepthContract(crmArch)!;

  it('catches a heading-only entry screen (pipeline) as a MAJOR gap', () => {
    const files = [
      file('src/screens/pipeline.tsx', '<section><h1>Pipeline</h1></section>'),
      file('src/screens/contacts.tsx', '<ul>{contacts.map(c => <li key={c.id}>{c.name}</li>)}</ul>'),
    ];
    const res = analyzeAppCompleteness(files, crmArch, crmDepth);
    expect(res.status).toBe('fail');
    expect(res.issues.map((i) => i.code)).toContain('entry-screen-empty');
    expect(hasBlockingAppCompletenessFindings(res)).toBe(true);
  });

  it('does NOT fault a real (dynamic / control-bearing) screen', () => {
    const files = [
      file('src/screens/pipeline.tsx', '<div>{deals.map(d => <Card key={d.id}>{d.title}<button onClick={move}>Move</button></Card>)}</div>'),
      file('src/screens/contacts.tsx', '<div><input onChange={onSearch}/><table><tr><td>Ada</td></tr></table></div>'),
      file('src/screens/contact-detail.tsx', '<form><label>Name<input/></label><button>Log activity</button></form>'),
      file('src/screens/contact-edit.tsx', '<form><input/><button type="submit">Save contact</button></form>'),
      file('src/screens/settings.tsx', '<form><label><input type="checkbox"/> Notifications</label><button>Save changes</button></form>'),
    ];
    const res = analyzeAppCompleteness(files, crmArch, crmDepth);
    expect(res.status).toBe('pass');
    expect(res.screensSubstantive).toBeGreaterThanOrEqual(4);
  });

  it('H — a simple utility with one honest screen never fails completeness', () => {
    const uArch = archOf(TIP);
    const uDepth = deriveScreenDepthContract(uArch)!;
    const files = [file('src/screens/main.tsx', '<div><input value={bill}/><output>{tip}</output><button onClick={calc}>Run</button></div>')];
    const res = analyzeAppCompleteness(files, uArch, uDepth);
    expect(res.status).toBe('pass');
    expect(hasBlockingAppCompletenessFindings(res)).toBe(false);
  });

  it('fails open on empty inputs (never a false block)', () => {
    expect(analyzeAppCompleteness(undefined, crmArch, crmDepth).legacy).toBe(false);
    expect(analyzeAppCompleteness([], crmArch, crmDepth).status).toBe('pass');
    expect(analyzeAppCompleteness([file('x.tsx', '<div/>')], undefined, undefined).status).toBe('pass');
  });
});

describe('app completeness — I: honest simulation (no fake backend success)', () => {
  const arch = archOf('Build a shopping app with a product catalog, cart and checkout');
  const depth = deriveScreenDepthContract(arch)!;
  const realScreens: AppSourceFile[] = [
    file('src/screens/catalog.tsx', '<div>{products.map(p => <Card key={p.id}/>)}</div>'),
    file('src/screens/product.tsx', '<div><img/><button>Add to cart</button></div>'),
    file('src/screens/cart.tsx', '<div>{items.map(i => <li key={i.id}/>)}<button>Checkout</button></div>'),
    file('src/screens/orders.tsx', '<ul>{orders.map(o => <li key={o.id}/>)}</ul>'),
    file('src/screens/settings.tsx', '<form><input/><button>Save changes</button></form>'),
  ];

  it('catches a bare "payment successful" claim with no simulated framing', () => {
    const files = [
      ...realScreens,
      file('src/screens/checkout.tsx', '<div><h2>Payment successful — charged your card</h2></div>'),
    ];
    const res = analyzeAppCompleteness(files, arch, depth);
    expect(res.issues.map((i) => i.code)).toContain('fake-backend-claim');
    expect(hasBlockingAppCompletenessFindings(res)).toBe(true);
  });

  it('does NOT flag an honestly-simulated confirmation', () => {
    const files = [
      ...realScreens,
      file('src/screens/checkout.tsx', '<div><h2>Order placed</h2><p>This is a front-end only demo — no real payment was processed.</p><button>Place order</button></div>'),
    ];
    const res = analyzeAppCompleteness(files, arch, depth);
    expect(res.issues.map((i) => i.code)).not.toContain('fake-backend-claim');
  });
});

describe('screen depth — bounded builder block', () => {
  it('renders a bounded, app-framed depth block with honest-simulation rules', () => {
    const block = renderScreenDepthBlock(depthOf(CRM)).join('\n');
    expect(block).toMatch(/APP SCREEN DEPTH/);
    expect(block).toMatch(/HONEST SIMULATION/);
    expect(block.length).toBeLessThanOrEqual(2600);
    expect(renderScreenDepthBlock(undefined)).toEqual([]);
  });
});
