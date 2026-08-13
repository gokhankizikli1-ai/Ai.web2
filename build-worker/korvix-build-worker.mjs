#!/usr/bin/env node
// Korvix headless build worker — the single server-callable boundary for the
// production Web/App Build spine.
//
// CONTRACT (bounded JSON, stdin → stdout):
//   stdin  ← BuildExecutorInput  { build_type, user_id, project_id, run_id,
//                                  task_id, node_id, user_goal, product_spec,
//                                  brand, upstream_context, approval }
//   stdout → BuildExecutorResult { status: "completed"|"handoff"|"failed",
//                                  artifact_ref, build_ref, summary, cost_ref, detail }
//   exit 0 on a well-formed result (even a "failed"/"handoff" one); non-zero
//   only on a protocol/crash error.
//
// ARCHITECTURAL INTENT
// --------------------
// This worker is the ONE place the production TypeScript build spine
// (src/lib/webBuild*.ts: generateWebBuild, runFrontendBuilderQualityPipeline,
// the acceptance gate) will be invoked headlessly. It must NOT reimplement any
// builder intelligence — it delegates to that spine. The Python side
// (NodeBuildExecutor) owns only orchestration: durable state, timeout, cancel,
// reconcile.
//
// WHY IT RETURNS "handoff" TODAY
// ------------------------------
// The TS spine currently depends on browser globals (localStorage for the auth
// token, window.location/window.dispatchEvent for verification routing), so it
// cannot run under Node yet. Making it headless (thread auth + apiBase through
// as parameters, drop window/localStorage) is the deliberate follow-up. Until
// then this worker returns a TRUTHFUL "handoff" with reason
// "executor_unavailable" — never a fabricated completed build. That keeps the
// backend honest while the boundary (this file + the Python seam) is in place.
//
// Tests inject a mock worker command, so the full subprocess seam is verified
// without any paid build.

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    // Guard: if nothing arrives, resolve empty after the stream closes.
    if (process.stdin.isTTY) resolve('');
  });
}

async function main() {
  let input;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw || '{}');
  } catch (e) {
    process.stdout.write(JSON.stringify({
      status: 'failed',
      detail: `invalid BuildExecutorInput JSON: ${String(e && e.message || e)}`,
    }));
    process.exit(0);
    return;
  }

  const buildType = String(input.build_type || '');
  if (buildType !== 'web' && buildType !== 'app') {
    process.stdout.write(JSON.stringify({
      status: 'failed',
      detail: `unsupported build_type: ${buildType || '(none)'}`,
    }));
    process.exit(0);
    return;
  }

  // ── HEADLESS SPINE SEAM (follow-up) ─────────────────────────────────────
  // When the TS spine is decoupled from the browser, wire it here, e.g.:
  //
  //   import { runHeadlessBuild } from '../src/lib/headlessBuild.mjs';
  //   const result = await runHeadlessBuild(buildType, input, { apiBase, token });
  //   process.stdout.write(JSON.stringify(result)); process.exit(0);
  //
  // The spine remains the single builder authority; this worker only adapts
  // the process boundary. No builder logic lives here.
  // ────────────────────────────────────────────────────────────────────────

  process.stdout.write(JSON.stringify({
    status: 'handoff',
    artifact_ref: `buildreq:${buildType}:${input.run_id || '-'}:${input.task_id || input.node_id || '-'}`,
    build_ref: '',
    summary: `${buildType} build routed to headless worker (executor_unavailable — TS spine not yet decoupled from browser globals)`,
    cost_ref: null,
    detail: 'executor_unavailable: production build spine is browser-coupled; headless wiring is the deliberate follow-up',
  }));
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack || e));
  process.exit(1);
});
