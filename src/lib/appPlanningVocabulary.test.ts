import { describe, it, expect } from 'vitest';
import { buildWebBuildRequest } from '@/lib/webBuildApi';

/**
 * Post-merge audit — the PLANNING model call (buildWebBuildRequest) must be app-framed
 * for buildType='app' and byte-for-byte website-framed for web. This proves the
 * "Researching the website direction" symptom had a real model-facing cause and that
 * it is now fixed at the source, without disturbing the web planning prompt.
 */
describe('planning request — model-facing vocabulary is build-type aware', () => {
  const web = buildWebBuildRequest('Build a bakery landing page', { mode: 'website' });
  const webDefault = buildWebBuildRequest('Build a bakery landing page');
  const app = buildWebBuildRequest('Build a premium fitness coaching app', { mode: 'app' });

  it('the WEB planning prompt is unchanged (website persona/scope/contracts present)', () => {
    for (const req of [web, webDefault]) {
      expect(req).toContain('[WEB BUILD REQUEST]');
      expect(req).toContain('SENIOR Website Strategy, UX Architecture and Conversion Copy Director');
      expect(req).toContain('WEBSITE + FRONT-END DEMO ONLY');
      expect(req).toContain('WEBSITE EXPERIENCE PLAN');
      expect(req).toContain('CONVERSION JOURNEY');
      expect(req).toContain('Hero composition decision');
      // No app framing leaks into a web request.
      expect(req).not.toContain('Application Strategy');
      expect(req).not.toContain('APP EXPERIENCE PLAN');
      expect(req).not.toContain('MULTI-SCREEN application');
    }
    // website vs default (no mode) produce the same website prompt body.
    expect(web).toBe(webDefault);
  });

  it('the APP planning prompt is app-framed (screens/navigation/flows), no website persona', () => {
    expect(app).toContain('[WEB BUILD REQUEST]'); // backend planning-mode selector stays
    expect(app).toContain('SENIOR Product / Application Strategy');
    expect(app).toContain('CLIENT-ROUTED, MULTI-SCREEN application');
    expect(app).toContain('APP EXPERIENCE PLAN');
    expect(app).toContain('app SCREENS');
    expect(app).toContain('Navigation model:');
    expect(app).toContain('App shell:');
  });

  it('the APP planning prompt drops the website persona / scope / hero / conversion framing', () => {
    expect(app).not.toContain('SENIOR Website Strategy');
    expect(app).not.toContain('Conversion Copy Director');
    expect(app).not.toContain('WEBSITE + FRONT-END DEMO ONLY');
    expect(app).not.toContain('WEBSITE EXPERIENCE PLAN');
    expect(app).not.toContain('CONVERSION JOURNEY');
    expect(app).not.toContain('Hero composition decision');
    expect(app).not.toContain('Section rhythm decision');
    expect(app).not.toContain('above the fold');
  });

  it('the APP planning prompt keeps the parser-required H2 headers (no forced repair)', () => {
    // These headers are what parseWebBuildResult / the preview-viable gate require.
    expect(app).toContain('## Build Plan');
    expect(app).toContain('## Design Direction');
    expect(app).toContain('## Page Sections');
    expect(app).toContain('## Generated Copy');
    expect(app).toContain('## Next Steps');
    // Brief-extraction load-bearing tokens survive (App type→Type, Audience, Primary goal→Goal, Visual mood→Style).
    expect(app).toContain('App type:');
    expect(app).toContain('Audience:');
    expect(app).toContain('Primary goal:');
    expect(app).toContain('Visual mood:');
    // Identity tokens app-architecture reads (Screen model→pageScreenModel, Navigation model→navigationModel).
    expect(app).toContain('Screen model:');
  });

  it('an app REVISION is app-framed, not "REVISION of an existing website"', () => {
    const rev = buildWebBuildRequest('make the dashboard denser', { mode: 'app', revise: true, previousReply: 'x' });
    expect(rev).toContain('REVISION of an existing multi-screen APPLICATION');
    expect(rev).not.toContain('REVISION of an existing website');
    const webRev = buildWebBuildRequest('make the hero bigger', { mode: 'website', revise: true, previousReply: 'x' });
    expect(webRev).toContain('REVISION of an existing website');
    expect(webRev).not.toContain('multi-screen APPLICATION');
  });
});
