import { describe, it, expect } from 'vitest';
import { detectMissingNavActiveState, detectDeadTabs, type AppUiSourceFile } from '@/lib/appUiQuality';
import { findDeadControls } from '@/lib/appScreenDepth';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { buildFrontendBuilderRequest } from '@/lib/webBuildApi';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';

const tsx = (path: string, content: string): AppUiSourceFile => ({ path, content, language: 'tsx' });

function spec(prompt: string, buildType: 'app' | 'web' = 'app'): FrontendBuildSpecification {
  const brief: WebBuildBrief = { type: buildType === 'app' ? 'app' : 'website' };
  const sections = [{ id: 'dashboard', name: 'Dashboard' }, { id: 'list', name: 'List' }, { id: 'settings', name: 'Settings' }];
  const input: FrontendBuildSpecInput = {
    prompt, lang: 'en', buildType, brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
  };
  return deriveFrontendBuildSpecification(input);
}

describe('UI Quality Phase 3 — interaction polish contract + provable interaction detection', () => {
  const appReq = buildFrontendBuilderRequest(spec('Build a CRM', 'app'));

  it('the app spec carries an interaction-polish contract (motion + feedback + navigation)', () => {
    const ip = spec('Build a CRM for a sales team').appVisual?.interactionPolish;
    expect(ip).toBeDefined();
    expect(ip!.motion.toLowerCase()).toMatch(/reduced-motion/);
    expect(ip!.motion.toLowerCase()).toMatch(/no new dependency/);
    expect(ip!.feedback.toLowerCase()).toMatch(/honest|never a faked|faked remote/);
    expect(ip!.navigation.toLowerCase()).toMatch(/active/);
  });

  it('the polish contract reaches app generation but never web generation', () => {
    expect(appReq).toContain('Interaction polish (feel intentional when operated');
    const web = buildFrontendBuilderRequest(spec('Build a bakery landing page', 'web'));
    expect(web).not.toContain('Interaction polish (feel intentional when operated');
  });

  // C. tabs switch visible content — the inverse (dead tabs) is detected; working tabs pass.
  it('C. working tabs (with active state) pass; dead tabs are flagged', () => {
    expect(detectDeadTabs({ files: [tsx('a.tsx', '<button role="tab" aria-selected={true}>X</button>')] })).toEqual([]);
    expect(detectDeadTabs({ files: [tsx('a.tsx', '<button role="tab">X</button><button role="tab">Y</button>')] }).length).toBe(1);
  });

  // D. sidebar current route clear — nav active-state detection.
  it('D. a nav with active-route indication passes; a nav without one is flagged', () => {
    const good = tsx('src/App.tsx',
      `<nav><NavLink to="/">Home</NavLink><NavLink to="/deals">Deals</NavLink></nav>`);
    expect(detectMissingNavActiveState({ files: [good] })).toEqual([]);
    const goodAria = tsx('src/App.tsx',
      `<nav><a href="/" aria-current="page">Home</a><a href="/deals">Deals</a></nav>`);
    expect(detectMissingNavActiveState({ files: [goodAria] })).toEqual([]);
    const bad = tsx('src/App.tsx',
      `<nav><a href="/">Home</a><a href="/deals">Deals</a><a href="/settings">Settings</a></nav>`);
    const out = detectMissingNavActiveState({ files: [bad] });
    expect(out.map((x) => x.code)).toContain('app-navigation-active-state');
  });

  it('D2. a single-link header or a non-nav region is not over-policed', () => {
    expect(detectMissingNavActiveState({ files: [tsx('h.tsx', `<header><a href="/">Logo</a></header>`)] })).toEqual([]);
    expect(detectMissingNavActiveState({ files: [tsx('h.tsx', `<nav><a href="/">Home</a></nav>`)] })).toEqual([]); // only one link
  });

  // H. no new dead controls — the existing detector still holds (a wired control passes).
  it('H. a wired control passes dead-control detection; an unwired one is flagged', () => {
    expect(findDeadControls('s', `<button onClick={go}>Go</button>`)).toEqual([]);
    expect(findDeadControls('s', `<button>Go</button>`).length).toBe(1);
  });

  // E/F/I are owned by the screen-depth + honesty contracts — assert they are present for an app.
  it('E/F/I. feedback + honesty obligations remain owned by screen depth (not duplicated here)', () => {
    // create/edit screens require a visible success/error; lists require filter→results; honesty forbids fake remote success.
    expect(appReq).toContain('[APP SCREEN DEPTH & STATE LIFECYCLE]');
    expect(appReq).toMatch(/visible (?:local )?consequence|success or error/i);
    expect(appReq).toMatch(/never simulate real payments|faked backend|honest/i);
  });
});
