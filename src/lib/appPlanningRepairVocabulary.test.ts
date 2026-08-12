import { describe, it, expect } from 'vitest';
import { buildWebBuildRepairRequest, buildWebBuildDesignPlanRepairRequest } from '@/lib/webBuildApi';

/**
 * PR #614 review fix — the PLANNING REPAIR path must stay build-type aware. A thin
 * first app plan that falls through to strict repair must NOT be re-planned with
 * website vocabulary (hero / Website Experience Plan / conversion journey / landing
 * scope), which would overwrite the app-framed plan. Web repair stays byte-for-byte.
 */
const diag = { canonicalSectionsMissing: ['Page Sections', 'Generated Copy'] } as never;

describe('planning STRICT repair — build-type aware', () => {
  const webRepair = buildWebBuildRepairRequest('Build a bakery site', 'prev reply', diag, 'website');
  const webDefault = buildWebBuildRepairRequest('Build a bakery site', 'prev reply', diag);
  const appRepair = buildWebBuildRepairRequest('Build a fitness coaching app', 'prev reply', diag, 'app');

  it('B. WEB strict repair is byte-for-byte unchanged (website framing preserved)', () => {
    expect(webRepair).toBe(webDefault); // no-mode === website
    expect(webRepair).toContain('Website Experience Plan');
    expect(webRepair).toContain('Conversion Journey');
    expect(webRepair).toContain('Hero composition decision');
    expect(webRepair).toContain('SCOPE: WEBSITE + FRONT-END DEMO ONLY');
    expect(webRepair).not.toContain('App Experience Plan');
    expect(webRepair).not.toContain('MULTI-SCREEN APPLICATION');
  });

  it('C. APP strict repair uses screen/navigation/state vocabulary', () => {
    expect(appRepair).toContain('MULTI-SCREEN APPLICATION');
    expect(appRepair).toContain('Product / Application Strategy');
    expect(appRepair).toContain('App Experience Plan');
    expect(appRepair).toContain('Navigation model:');
    expect(appRepair).toContain('State model:');
    expect(appRepair).toContain('app SCREENS');
    expect(appRepair).toContain('SCOPE: APPLICATION + FRONT-END ONLY');
  });

  it('D. APP strict repair excludes website hero / WEP / conversion / landing framing', () => {
    expect(appRepair).not.toContain('Website Experience Plan');
    expect(appRepair).not.toContain('Conversion Journey');
    expect(appRepair).not.toContain('Hero composition decision');
    expect(appRepair).not.toContain('Section rhythm decision');
    expect(appRepair).not.toContain('WEBSITE + FRONT-END DEMO ONLY');
    expect(appRepair).not.toContain('Landing required');
    expect(appRepair).not.toContain('Primary entry CTA');
  });

  it('E. APP strict repair keeps the parser-required H2 headers (still parses, no extra call)', () => {
    for (const h of ['## Design Thinking Plan', '## Build Plan', '## Design Direction', '## Page Sections', '## Generated Copy', '## Next Steps']) {
      expect(appRepair).toContain(h);
    }
    expect(appRepair).toContain('[WEB BUILD REQUEST]'); // backend planning-mode selector
    expect(appRepair).toContain('[WEB BUILD PLANNING REPAIR REQUEST]'); // zero-research repair marker
  });
});

describe('planning DESIGN-PLAN repair — build-type aware (defense-in-depth)', () => {
  const web = buildWebBuildDesignPlanRepairRequest('Build a bakery site', 'prev', undefined, 'website');
  const webDefault = buildWebBuildDesignPlanRepairRequest('Build a bakery site', 'prev');
  const app = buildWebBuildDesignPlanRepairRequest('Build a fitness app', 'prev', undefined, 'app');

  it('web nudge byte-for-byte unchanged; app nudge is app-framed', () => {
    expect(web).toBe(webDefault);
    expect(web).toContain('Hero composition decision');
    expect(web).toContain('WEBSITE + FRONT-END DEMO ONLY');
    expect(app).toContain('App shell decision');
    expect(app).toContain('APPLICATION + FRONT-END ONLY');
    expect(app).not.toContain('Hero composition decision');
    expect(app).not.toContain('WEBSITE + FRONT-END DEMO ONLY');
    // Parser headers preserved.
    expect(app).toContain('## Page Sections');
  });
});
