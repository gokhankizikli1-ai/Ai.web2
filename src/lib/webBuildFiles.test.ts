import { describe, it, expect } from 'vitest';
import { parseBuildSections } from '@/lib/gameBuilderApi';
import { resolveBuildFiles, synthesizeFiles } from '@/lib/webBuildFiles';
import { resolveFiles, deriveBuildActivity, buildWebBuildPayload } from '@/lib/webBuildPayload';
import { stepToEvents } from '@/lib/webBuildRun';
import { extractBrief } from '@/lib/webBuildApi';
import type { WebBuildResult } from '@/lib/webBuildApi';

// The bug case: backend returns Page Sections + Generated Copy but NO usable
// Frontend Code. The synthesizer must still produce real files with real copy.
const REPLY = [
  '## Build Plan',
  'Website type: fitness coach landing page',
  'Audience: busy professionals',
  'Goal: book appointments',
  '',
  '## Page Sections',
  '- hero: premium hero with appointment CTA',
  '- services: coaching service cards',
  '- testimonials: social proof',
  '- final-cta: booking call to action',
  '- footer: contact and footer',
  '',
  '## Generated Copy',
  '### hero',
  'Başlık: Formda kal, randevunu al',
  'Alt başlık: Mobil uyumlu, kişiye özel koçluk',
  'CTA: Randevu al',
  '',
  '### services',
  '- Birebir koçluk',
  '- Beslenme planı',
  '',
  '### final-cta',
  'Hazır mısın?',
  'CTA: Hemen başla',
  '',
  '## Frontend Code',
  '',
  '## Next Steps',
  '- add pricing',
].join('\n');

function makeResult(reply: string): WebBuildResult {
  return { reply, sections: parseBuildSections(reply), partial: false, model: 'x', mode: 'website_builder', requestId: '1' };
}

describe('web build file synthesis', () => {
  const result = makeResult(REPLY);

  it('produces real files even when the backend returned no code', () => {
    const files = resolveBuildFiles(result);
    expect(files.length).toBeGreaterThanOrEqual(6); // App + 5 sections + index.css
    const paths = files.map((f) => f.path);
    expect(paths).toContain('App.tsx');
    expect(paths).toContain('index.css');
    expect(paths.some((p) => /components\/Hero\.tsx/.test(p))).toBe(true);
    // Every file has real content (no empty "no captured code").
    expect(files.every((f) => f.content.trim().length > 0)).toBe(true);
  });

  it('embeds the real generated copy into the component', () => {
    const hero = synthesizeFiles(result).find((f) => /Hero\.tsx/.test(f.path));
    expect(hero).toBeTruthy();
    expect(hero!.content).toMatch(/Formda kal|Randevu al/);
  });

  it('diffs mark all files created on the first build with line counts', () => {
    const files = resolveFiles(result);
    expect(files.every((f) => f.status === 'created')).toBe(true);
    expect(files.every((f) => f.added > 0 && f.removed === 0)).toBe(true);
  });

  it('build activity is file/component based and lists created files', () => {
    const files = resolveFiles(result);
    const rows = deriveBuildActivity(result, files);
    const creating = rows.filter((r) => r.labelKey === 'wbActCreatingFile');
    expect(creating.length).toBe(files.length);
    expect(creating.some((r) => /Hero\.tsx/.test(String(r.params?.file)))).toBe(true);
    expect(rows.some((r) => r.labelKey === 'wbActPackage')).toBe(true);
  });

  it('a revision that changes only hero copy modifies only Hero.tsx', () => {
    const first = resolveFiles(result);
    const revisedReply = REPLY.replace('Formda kal, randevunu al', 'Premium koçlukla hedefine ulaş');
    const revised = resolveFiles(makeResult(revisedReply), first);
    const hero = revised.find((f) => /Hero\.tsx/.test(f.path));
    expect(hero!.status).toBe('modified');
    const others = revised.filter((f) => !/Hero\.tsx/.test(f.path));
    expect(others.every((f) => f.status === 'unchanged')).toBe(true);
  });
});

describe('web build run events', () => {
  const result = makeResult(REPLY);
  const brief = extractBrief(result.sections);

  it('a fresh build emits assistant messages, Analyze + Plan actions, file_created per file, preview_ready', () => {
    const payload = buildWebBuildPayload('build a fitness coach site', result);
    const events = stepToEvents(payload.steps[0], brief);
    expect(events[0]).toMatchObject({ type: 'assistant_message' });
    expect(events.some((e) => e.type === 'action_complete' && e.group === 'analyze' && e.detailsSource === 'brief')).toBe(true);
    expect(events.some((e) => e.type === 'action_complete' && e.group === 'plan')).toBe(true);
    expect(events.some((e) => e.type === 'preview_ready')).toBe(true);
    expect(events.filter((e) => e.type === 'artifact_ready').length).toBe(3);
    // Only real generated files are announced — never invented.
    const created = events.filter((e) => e.type === 'file_created');
    const realPaths = new Set(payload.files.map((f) => f.path));
    expect(created.length).toBe(payload.files.length);
    expect(created.every((e) => e.filePath && realPaths.has(e.filePath))).toBe(true);
    // No modify events on a fresh build.
    expect(events.some((e) => e.type === 'file_modified')).toBe(false);
  });

  it('a revision emits a Read action + file_modified for the changed file only, no Analyze/Plan', () => {
    const first = buildWebBuildPayload('build it', result);
    const revisedReply = REPLY.replace('Formda kal, randevunu al', 'Premium koçlukla hedefine ulaş');
    const second = buildWebBuildPayload('change the hero headline', makeResult(revisedReply), first);
    const step = second.steps[second.steps.length - 1];
    const events = stepToEvents(step, brief);
    const heroRead = events.find((e) => e.type === 'action_start' && e.group === 'read-components/Hero.tsx');
    const heroMod = events.find((e) => e.type === 'file_modified' && /Hero\.tsx/.test(e.filePath || ''));
    expect(heroRead).toBeTruthy();
    expect(heroMod).toBeTruthy();
    expect(events.indexOf(heroRead!)).toBeLessThan(events.indexOf(heroMod!));
    // Targeted: only Hero is modified, nothing else.
    expect(events.filter((e) => e.type === 'file_modified').length).toBe(1);
    expect(events.some((e) => e.group === 'analyze' || e.group === 'plan')).toBe(false);
    expect(events.some((e) => e.type === 'preview_ready')).toBe(true);
  });
});
