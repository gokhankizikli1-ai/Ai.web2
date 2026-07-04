import { describe, it, expect } from 'vitest';
import { parseBuildSections } from '@/lib/gameBuilderApi';
import { resolveBuildFiles, synthesizeFiles } from '@/lib/webBuildFiles';
import { resolveFiles, deriveBuildActivity, buildWebBuildPayload } from '@/lib/webBuildPayload';
import { stepToEvents, eventsToRows, type RunRow } from '@/lib/webBuildRun';
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

  it('a fresh build is a coding run: Thinking + create_file per file, no Analyze/Plan rows', () => {
    const payload = buildWebBuildPayload('build a fitness coach site', result);
    const events = stepToEvents(payload.steps[0], brief);
    const rows = eventsToRows(events);
    expect(rows[0].kind).toBe('message');
    // Exactly one Thinking block, and it is NOT a prominent planning/analyze row.
    expect(rows.filter((r) => r.kind === 'tool' && r.toolType === 'think').length).toBe(1);
    expect(rows.some((r) => r.kind === 'tool' && (r.titleKey === 'wbActAnalyze' || r.titleKey === 'wbActPlanStructure'))).toBe(false);
    // The main rows are file create blocks — one per real file, never invented.
    const fileRows = rows.filter((r) => r.kind === 'tool' && r.toolType === 'create_file') as Extract<RunRow, { kind: 'tool' }>[];
    const realPaths = new Set(payload.files.map((f) => f.path));
    expect(fileRows.length).toBe(payload.files.length);
    expect(fileRows.every((r) => r.filePath && realPaths.has(r.filePath) && r.clickable)).toBe(true);
    // preview + 3 artifacts present in the event stream.
    expect(events.some((e) => e.type === 'preview_ready')).toBe(true);
    expect(events.filter((e) => e.type === 'artifact_ready').length).toBe(3);
  });

  it('a revision emits a Read file + Edit file block for the changed file only', () => {
    const first = buildWebBuildPayload('build it', result);
    const revisedReply = REPLY.replace('Formda kal, randevunu al', 'Premium koçlukla hedefine ulaş');
    const second = buildWebBuildPayload('change the hero headline', makeResult(revisedReply), first);
    const step = second.steps[second.steps.length - 1];
    const rows = eventsToRows(stepToEvents(step, brief));
    const tools = rows.filter((r) => r.kind === 'tool') as Extract<RunRow, { kind: 'tool' }>[];
    const heroRead = tools.find((r) => r.toolType === 'read_file' && /Hero\.tsx/.test(r.filePath || ''));
    const heroEdit = tools.find((r) => r.toolType === 'edit_file' && /Hero\.tsx/.test(r.filePath || ''));
    expect(heroRead).toBeTruthy();
    expect(heroEdit).toBeTruthy();
    expect(tools.indexOf(heroRead!)).toBeLessThan(tools.indexOf(heroEdit!));
    // Targeted: only Hero is edited, nothing else.
    expect(tools.filter((r) => r.toolType === 'edit_file').length).toBe(1);
    expect(heroRead!.clickable).toBe(true);
  });
});
