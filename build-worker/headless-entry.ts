#!/usr/bin/env -S npx tsx
// Korvix headless build worker (real spine) — the executable entry the
// NodeBuildExecutor drives when a real build is wired.
//
//   stdin  ← BuildExecutorInput  JSON (build_type, user_goal, ...)
//   stdout → BuildExecutorResult JSON (status, artifact_ref, build_ref,
//                                      summary, cost_ref, detail)
//
// It calls runHeadlessBuild, which reuses the SAME production TS build spine
// (generateWebBuild + runFrontendBuilderQualityPipeline) via an injected build
// runtime — no duplicated builder intelligence. Run it with a TS runner that
// resolves the tsconfig `@/` path alias, e.g.:
//
//   KORVIX_BUILD_WORKER_CMD="npx tsx build-worker/headless-entry.ts"
//
// Auth + API base for the (paid) /chat transport come from the worker's own
// env — KORVIX_API_BASE and KORVIX_HEADLESS_AUTH_TOKEN — so no browser globals
// are involved. Absent a token, the build fails cleanly (unauthenticated),
// never a fabricated success.

import { runHeadlessBuild } from '../src/lib/runHeadlessBuild';
import type { BuildType } from '../src/lib/buildType';

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

async function main() {
  let input: Record<string, unknown>;
  try {
    input = JSON.parse((await readStdin()) || '{}');
  } catch (e) {
    process.stdout.write(JSON.stringify({ status: 'failed', detail: `invalid input JSON: ${String(e)}` }));
    return;
  }

  const buildType = String(input.build_type || '') as BuildType;
  if (buildType !== 'web' && buildType !== 'app') {
    process.stdout.write(JSON.stringify({ status: 'failed', detail: `unsupported build_type: ${buildType}` }));
    return;
  }

  const apiBase = (process.env.KORVIX_API_BASE || '').trim();
  const authToken = (process.env.KORVIX_HEADLESS_AUTH_TOKEN || '').trim() || null;
  if (!apiBase) {
    process.stdout.write(JSON.stringify({
      status: 'handoff',
      detail: 'executor_unavailable: KORVIX_API_BASE not set for the headless worker',
    }));
    return;
  }

  const goal = String(input.user_goal || input.task_description || '').trim();
  const result = await runHeadlessBuild({
    buildType,
    idea: goal || `${buildType} build`,
    authToken,
    apiBase,
    transport: globalThis.fetch.bind(globalThis),
    userId: String(input.user_id || 'headless-worker'),
  });

  process.stdout.write(JSON.stringify({
    status: result.status,
    artifact_ref: result.artifact_ref,
    build_ref: result.build_ref,
    summary: result.summary,
    cost_ref: result.cost_ref,
    detail: result.detail || '',
  }));
}

main().catch((e) => {
  process.stderr.write(String((e as Error)?.stack || e));
  process.exit(1);
});
