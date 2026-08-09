import { describe, it, expect } from 'vitest';
import {
  reconstructProjectFiles,
  reconstructRepairRawFromDelta,
  parseFrontendDeltaResponse,
  type DeltaUpsert,
} from '@/lib/webBuildDeltaRepair';
import { findDeltaIntroducedStructuralIssues } from '@/lib/webBuildFrontendValidation';
import type { FrontendBuilderRawArtifact, FrontendGeneratedFile } from '@/lib/webBuildAgents';

/**
 * Delta-repair structural-safety regression suite.
 *
 * Production case (FlowPilot): the bounded delta repair produced a reconstructed project that
 * failed Phase 12C static re-validation ("repair-failed-validation"), dropping the whole build to
 * Safe Preview. These tests pin the prevention:
 *   - a bounded delta that introduces an unresolved import / unsupported package / node builtin /
 *     unsafe path is REJECTED deterministically by the delta module (fail open to the original
 *     validated project, NO second call);
 *   - a valid bounded delta is still accepted;
 *   - untouched files are preserved byte-for-byte;
 *   - a case-variant upsert REPLACES the intended file instead of being added as a stray duplicate.
 * The guard reuses the exact Phase 12C rules, so it can never be stricter than the full validator.
 */

function file(path: string, content: string): FrontendGeneratedFile {
  const language = path.endsWith('.css') ? 'css' : path.endsWith('.tsx') ? 'tsx' : 'ts';
  return { path, language, content, charCount: content.length, lineCount: content.split('\n').length } as FrontendGeneratedFile;
}

// A minimal, structurally-valid original project (already passed Phase 12C).
function originalProject(): FrontendGeneratedFile[] {
  return [
    file('src/main.tsx', "import { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<App/>);"),
    file('src/App.tsx', "import Hero from './components/Hero';\nexport default function App(){ return <div><Hero/></div>; }"),
    file('src/components/Hero.tsx', "export default function Hero(){ return <section>Hero</section>; }"),
    file('src/styles.css', '@tailwind base;\n@tailwind components;\n@tailwind utilities;'),
  ];
}

function deltaRaw(upserts: Array<Partial<DeltaUpsert>>): FrontendBuilderRawArtifact {
  return {
    version: 'frontend-builder-raw-v1',
    status: 'completed',
    requestedFormat: 'frontend-files-v1',
    mode: 'frontend_builder',
    rawResponse: JSON.stringify({ upserts }),
    responseCharCount: 0,
    truncatedForStorage: false,
    validationStatus: 'not-run',
    reason: '',
    warnings: [],
    model: 'test-model', provider: 'test-provider', requestId: 'req-123',
  } as FrontendBuilderRawArtifact;
}

const reconstruct = (upserts: Array<Partial<DeltaUpsert>>) =>
  reconstructRepairRawFromDelta({ deltaRaw: deltaRaw(upserts), originalFiles: originalProject() });

/** A raw delta artifact carrying an ARBITRARY response body (to exercise the wrapper-tolerant
 *  extractor + reconstruction end to end, not just the pre-serialized JSON happy path). */
function rawWithBody(rawResponse: string): FrontendBuilderRawArtifact {
  return {
    version: 'frontend-builder-raw-v1', status: 'completed', requestedFormat: 'frontend-files-v1',
    mode: 'frontend_builder', rawResponse, responseCharCount: rawResponse.length, truncatedForStorage: false,
    validationStatus: 'not-run', reason: '', warnings: [],
    model: 'm', provider: 'p', requestId: 'r',
  } as FrontendBuilderRawArtifact;
}
const reconstructBody = (rawResponse: string) =>
  reconstructRepairRawFromDelta({ deltaRaw: rawWithBody(rawResponse), originalFiles: originalProject() });

// A VALID bounded delta (a plain in-place edit of an existing file; no new imports).
const VALID_DELTA_BODY = JSON.stringify({
  upserts: [{ path: 'src/components/Hero.tsx', language: 'tsx', content: "export default function Hero(){ return <section className='hero'>Recovered</section>; }" }],
});

describe('delta guard — invalid repair fails open to the original validated candidate', () => {
  it('unresolved import target introduced by the repair → rejected, fail-open, no second call', () => {
    const out = reconstruct([
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "import Chart from './Chart';\nexport default function Hero(){ return <section><Chart/></section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('failed');            // fail open — original preserved
    expect(out.diagnostics.accepted).toBe(false);
    expect(out.diagnostics.rejectionReason).toMatch(/unresolved-import/);
    // No second provider call — the failed raw carries the DELTA call's telemetry, nothing new.
    expect(out.repairRaw.provider).toBe('test-provider');
    expect(out.repairRaw.requestId).toBe('req-123');
  });

  it('unsupported package import introduced by the repair → rejected', () => {
    const out = reconstruct([
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "import axios from 'axios';\nexport default function Hero(){ return <section>{String(axios)}</section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('failed');
    expect(out.diagnostics.rejectionReason).toMatch(/unsupported-package/);
  });

  it('node built-in import introduced by the repair → rejected', () => {
    const out = reconstruct([
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "import fs from 'fs';\nexport default function Hero(){ return <section>{typeof fs}</section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('failed');
    expect(out.diagnostics.rejectionReason).toMatch(/node-builtin/);
  });

  it('unsafe added path (outside src/) introduced by the repair → rejected', () => {
    const out = reconstruct([
      { path: 'components/Widget.tsx', language: 'tsx', content: 'export default function Widget(){ return <div/>; }' },
    ]);
    expect(out.repairRaw.status).toBe('failed');
    expect(out.diagnostics.rejectionReason).toMatch(/unsafe-added-path/);
  });

  it('path-alias import (@/…) introduced by the repair → rejected', () => {
    const out = reconstruct([
      { path: 'src/App.tsx', language: 'tsx', content: "import Hero from '@/components/Hero';\nexport default function App(){ return <div><Hero/></div>; }" },
    ]);
    expect(out.repairRaw.status).toBe('failed');
    expect(out.diagnostics.rejectionReason).toMatch(/unsupported-alias/);
  });
});

describe('delta guard — valid bounded repairs remain accepted', () => {
  it('a valid in-place edit (no new imports) is accepted', () => {
    const out = reconstruct([
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "export default function Hero(){ return <section className='hero'>Premium Hero</section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('completed');
    expect(out.diagnostics.accepted).toBe(true);
  });

  it('a new component that is also included as an upsert (import resolves) is accepted', () => {
    const out = reconstruct([
      { path: 'src/components/Chart.tsx', language: 'tsx', content: "export default function Chart(){ return <div>chart</div>; }" },
      { path: 'src/components/Hero.tsx', language: 'tsx', content: "import Chart from './Chart';\nexport default function Hero(){ return <section><Chart/></section>; }" },
    ]);
    expect(out.repairRaw.status).toBe('completed');
    expect(out.diagnostics.accepted).toBe(true);
    expect(out.changedPaths).toEqual(['src/components/Chart.tsx', 'src/components/Hero.tsx']);
  });
});

describe('reconstructProjectFiles — preservation + case-variant replace', () => {
  it('untouched files are preserved byte-for-byte', () => {
    const original = originalProject();
    const upserts: DeltaUpsert[] = [
      { path: 'src/components/Hero.tsx', language: 'tsx', content: 'export default function Hero(){ return <section>New</section>; }' },
    ];
    const rebuilt = reconstructProjectFiles(original, upserts);
    for (const p of ['src/main.tsx', 'src/App.tsx', 'src/styles.css']) {
      expect(rebuilt.find((f) => f.path === p)!.content).toBe(original.find((f) => f.path === p)!.content);
    }
    // The edited file changed; no file was added or removed.
    expect(rebuilt).toHaveLength(original.length);
    expect(rebuilt.find((f) => f.path === 'src/components/Hero.tsx')!.content).toContain('New');
  });

  it('a case-variant upsert REPLACES the intended file (keeps original exact path, no duplicate)', () => {
    const original = originalProject(); // has src/components/Hero.tsx
    const rebuilt = reconstructProjectFiles(original, [
      { path: 'src/components/hero.tsx', language: 'tsx', content: 'export default function Hero(){ return <section>Cased</section>; }' },
    ]);
    // No stray duplicate; still the same file count; path keeps the ORIGINAL case.
    expect(rebuilt).toHaveLength(original.length);
    const hero = rebuilt.filter((f) => f.path.toLowerCase() === 'src/components/hero.tsx');
    expect(hero).toHaveLength(1);
    expect(hero[0].path).toBe('src/components/Hero.tsx'); // original exact path preserved
    expect(hero[0].content).toContain('Cased');          // the edit WAS applied
  });

  it('a genuinely new file is added with its own path', () => {
    const original = originalProject();
    const rebuilt = reconstructProjectFiles(original, [
      { path: 'src/components/Footer.tsx', language: 'tsx', content: 'export default function Footer(){ return <footer/>; }' },
    ]);
    expect(rebuilt).toHaveLength(original.length + 1);
    expect(rebuilt.find((f) => f.path === 'src/components/Footer.tsx')).toBeTruthy();
  });
});

describe('findDeltaIntroducedStructuralIssues — subset of Phase 12C, changed files only', () => {
  const reconstructed = [
    { path: 'src/main.tsx', content: "import App from './App';" },
    { path: 'src/App.tsx', content: "import Hero from './components/Hero';" },
    { path: 'src/components/Hero.tsx', content: 'export default function Hero(){ return null; }' },
    { path: 'src/styles.css', content: '@tailwind base;' },
  ];

  it('reports nothing when the changed file only uses resolvable imports', () => {
    expect(findDeltaIntroducedStructuralIssues(reconstructed, ['src/App.tsx'])).toEqual([]);
  });

  it('does NOT re-check untouched files (only the changed set)', () => {
    // A pre-existing (untouched) file with a bad import is NOT reported — it was already validated.
    const withBad = [...reconstructed, { path: 'src/Other.tsx', content: "import X from './Nope';" }];
    expect(findDeltaIntroducedStructuralIssues(withBad, ['src/App.tsx'])).toEqual([]);
    // But when that file IS the changed one, it is reported.
    const issues = findDeltaIntroducedStructuralIssues(withBad, ['src/Other.tsx']);
    expect(issues.map((i) => i.code)).toContain('unresolved-import');
  });

  it('owner/non-owner: pure function, no owner input — identical output for identical input', () => {
    const a = findDeltaIntroducedStructuralIssues(reconstructed, ['src/App.tsx']);
    const b = findDeltaIntroducedStructuralIssues(reconstructed, ['src/App.tsx']);
    expect(a).toEqual(b);
  });
});

/**
 * Wrapper-tolerant extraction regression suite (the production `no FRONTEND_DELTA_V1 JSON body
 * found` failure). A valid delta returned in a HARMLESS wrapper must be RECOVERED and reconstructed
 * instead of dropping the whole build to Safe Preview — while a genuinely truncated / wrong-contract
 * / malformed / unsafe delta stays REJECTED with a precise, bounded category.
 */
describe('parseFrontendDeltaResponse — recovers harmless wrappers, rejects genuine failures', () => {
  it('canonical markers + clean JSON body → parsed', () => {
    const body = `## FRONTEND_DELTA_V1\n${VALID_DELTA_BODY}\n## END_FRONTEND_DELTA_V1`;
    const r = parseFrontendDeltaResponse(body);
    expect(r.ok).toBe(true);
  });

  it('bare JSON with NO markers → parsed (unchanged legacy behavior)', () => {
    expect(parseFrontendDeltaResponse(VALID_DELTA_BODY).ok).toBe(true);
  });

  it('a ```json fenced body BETWEEN the markers → recovered (was rejected as invalid JSON)', () => {
    const body = `## FRONTEND_DELTA_V1\n\`\`\`json\n${VALID_DELTA_BODY}\n\`\`\`\n## END_FRONTEND_DELTA_V1`;
    expect(parseFrontendDeltaResponse(body).ok).toBe(true);
  });

  it('a whole-response ```json fence with no markers → recovered', () => {
    expect(parseFrontendDeltaResponse(`\`\`\`json\n${VALID_DELTA_BODY}\n\`\`\``).ok).toBe(true);
  });

  it('leading prose before a bare JSON object → recovered', () => {
    expect(parseFrontendDeltaResponse(`Here are the upserts:\n\n${VALID_DELTA_BODY}\n\nDone.`).ok).toBe(true);
  });

  it('heading-level / spacing / case variations of the markers → recovered', () => {
    const body = `#### frontend_delta_v1\n${VALID_DELTA_BODY}\n#### end_frontend_delta_v1`;
    expect(parseFrontendDeltaResponse(body).ok).toBe(true);
  });

  it('genuinely TRUNCATED body (unbalanced JSON) → rejected as truncated-json, never inferred', () => {
    const truncated = '## FRONTEND_DELTA_V1\n{"upserts":[{"path":"src/components/Hero.tsx","content":"export default function Hero(){ return <sec';
    const r = parseFrontendDeltaResponse(truncated);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.category).toBe('truncated-json');
  });

  it('a full frontend-files-v1 envelope instead of a delta → rejected as wrong-contract', () => {
    const envelope = '## FRONTEND_FILES_V1\n### FILE src/App.tsx\n```tsx\nexport default function App(){ return null; }\n```\n### END_FILE\n## END_FRONTEND_FILES_V1';
    const r = parseFrontendDeltaResponse(envelope);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.category).toBe('wrong-contract');
  });

  it('no delta content at all → rejected as contract-absent (the original production reason)', () => {
    const r = parseFrontendDeltaResponse('I could not complete the requested changes.');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.category).toBe('contract-absent');
      expect(r.reason).toMatch(/no FRONTEND_DELTA_V1 JSON body found/);
    }
  });

  it('parseable JSON that is not a delta → rejected as invalid-schema', () => {
    const r = parseFrontendDeltaResponse('{"files":[]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.category).toBe('invalid-schema');
  });

  it('brace inside file CONTENT does not fool the balanced scan (JSX/CSS bodies survive)', () => {
    const withBraces = JSON.stringify({
      upserts: [{ path: 'src/styles.css', language: 'css', content: '.hero { color: #fff; } .cta { color: #000; }' }],
    });
    expect(parseFrontendDeltaResponse(`## FRONTEND_DELTA_V1\n${withBraces}\n## END_FRONTEND_DELTA_V1`).ok).toBe(true);
  });
});

describe('reconstructRepairRawFromDelta — wrapper-tolerant end to end + bounded categories', () => {
  it('a fenced-in-markers valid delta is reconstructed into a completed frontend-files-v1 raw', () => {
    const body = `## FRONTEND_DELTA_V1\n\`\`\`json\n${VALID_DELTA_BODY}\n\`\`\`\n## END_FRONTEND_DELTA_V1`;
    const out = reconstructBody(body);
    expect(out.repairRaw.status).toBe('completed');
    expect(out.diagnostics.accepted).toBe(true);
    expect(out.diagnostics.returnedUpsertCount).toBe(1);
    expect(out.changedPaths).toEqual(['src/components/Hero.tsx']);
  });

  it('a truncated delta fails OPEN (original preserved) with a truncated-json category, no second call', () => {
    const out = reconstructBody('## FRONTEND_DELTA_V1\n{"upserts":[{"path":"src/components/Hero.tsx","content":"export def');
    expect(out.repairRaw.status).toBe('failed');
    expect(out.diagnostics.accepted).toBe(false);
    expect(out.diagnostics.rejectionCategory).toBe('truncated-json');
    // The failed raw carries only the delta call's telemetry — nothing new was requested.
    expect(out.repairRaw.provider).toBe('p');
    expect(out.repairRaw.requestId).toBe('r');
  });

  it('producer-contract observability: an accepted delta records the requested + actual contract', () => {
    const out = reconstructBody(`## FRONTEND_DELTA_V1\n${VALID_DELTA_BODY}\n## END_FRONTEND_DELTA_V1`);
    expect(out.diagnostics.taskKind).toBe('quality-repair');
    expect(out.diagnostics.expectedContract).toBe('frontend-delta-v1');
    expect(out.diagnostics.actualResponseShape).toBe('frontend-delta-v1');
  });

  it('producer-contract observability: a WRONG-contract full envelope is detected as frontend-files-v1', () => {
    const envelope = '## FRONTEND_FILES_V1\n### FILE src/App.tsx\n```tsx\nexport default function App(){ return null; }\n```\n### END_FILE\n## END_FRONTEND_FILES_V1';
    const out = reconstructBody(envelope);
    expect(out.repairRaw.status).toBe('failed');            // stays rejected — no local conversion
    expect(out.diagnostics.rejectionCategory).toBe('wrong-contract');
    expect(out.diagnostics.expectedContract).toBe('frontend-delta-v1');
    expect(out.diagnostics.actualResponseShape).toBe('frontend-files-v1');
  });

  it('background-timeout lifecycle telemetry is mirrored into the delta diagnostics', () => {
    // A background client timeout: the delta call did not complete (no usable body). The bounded
    // lifecycle telemetry the poller attached must survive onto the delta diagnostics so the exact
    // cause (still running vs poll-error, and the timing budget) is diagnosable from a saved build.
    const timedOutRaw = {
      version: 'frontend-builder-raw-v1', status: 'failed', requestedFormat: 'frontend-files-v1',
      mode: 'frontend_builder', responseCharCount: 0, truncatedForStorage: false, validationStatus: 'not-run',
      reason: 'The dedicated frontend task provider execution did not succeed: failed (background-client-timeout).',
      warnings: [], model: 'm', provider: 'p', requestId: 'r',
      backgroundMode: true, backgroundTaskKind: 'quality-repair',
      backgroundWorkflowBudgetMs: 720000, backgroundExpiresInMs: 840000,
      backgroundFinalPollResult: 'running', backgroundWaitMs: 721345, backgroundPollCount: 180,
      backgroundTransientPollFailures: 0, backgroundCancelRequested: true,
      backendErrorKind: 'background-client-timeout',
    } as FrontendBuilderRawArtifact;
    const out = reconstructRepairRawFromDelta({ deltaRaw: timedOutRaw, originalFiles: originalProject() });
    expect(out.repairRaw.status).toBe('failed');            // fail open — original preserved
    expect(out.diagnostics.rejectionCategory).toBe('no-response-body');
    expect(out.diagnostics.actualResponseShape).toBe('none');
    const lc = out.diagnostics.backgroundLifecycle;
    expect(lc?.finalPollResult).toBe('running');            // genuine timeout (still running at budget)
    expect(lc?.workflowBudgetMs).toBe(720000);
    expect(lc?.expiresInMs).toBe(840000);
    expect(lc?.pollCount).toBe(180);
    expect(lc?.cancelRequested).toBe(true);
    expect(lc?.errorKind).toBe('background-client-timeout');
  });
});
