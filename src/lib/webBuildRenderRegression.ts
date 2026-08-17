/**
 * Web Build RENDERED REGRESSION COMPARATOR (Quality V2).
 *
 * Closes the single biggest churn hole in the previous pipeline: the rendered page was inspected
 * exactly ONCE, BEFORE the repair. Everything after the repair was judged from source alone, so a
 * repair that introduced a runtime error, a blank first paint or mobile horizontal overflow could
 * still be accepted — the very "fix one thing, break three" failure mode the quality loop exists
 * to prevent.
 *
 * This module compares the PRE-repair and POST-repair rendered evaluations and returns a
 * deterministic verdict. It is:
 *   • PURE — no IO, no model call, no mutation. The measurement itself is performed by the
 *     EXISTING preview-measurement producer; this only compares two artifacts it already produces.
 *   • CONSERVATIVE — a regression is only declared from HIGH-severity rendered evidence that was
 *     genuinely ABSENT before and PRESENT after. A finding that already existed is not a
 *     regression (the repair simply did not fix it), and a finding that disappeared is progress.
 *   • FAIL-OPEN — when either side is missing (flags off, no producer, measurement timeout, stale
 *     run) it reports `compared:false, regressed:false`, so the pipeline behaves exactly as before.
 *
 * IMPORTANT INVARIANT: a rendered regression rejects the REPAIR. It never demotes the build to
 * Safe Preview. The pre-repair model-native project is structurally valid and stays active — the
 * regression only means "keep the earlier candidate", never "fall back to the safe renderer".
 */
import type {
  RenderedVisualEvaluationArtifact, RenderedVisualIssue, WebBuildRenderRegressionResult,
} from '@/lib/webBuildAgents';

/** Rendered codes that prove the page did not render usably. Their appearance after a repair is
 *  always a regression, regardless of the rest of the evaluation. */
const RUNTIME_FAILURE_CODES: ReadonlySet<string> = new Set([
  'rendered-runtime-error',
  'rendered-blank',
]);

const MAX_CODES = 8;

function highCodes(a: RenderedVisualEvaluationArtifact | undefined): Set<string> {
  const out = new Set<string>();
  if (!a || a.version !== 'rendered-visual-eval-v1' || !Array.isArray(a.issues)) return out;
  for (const i of a.issues as RenderedVisualIssue[]) {
    if (i && i.severity === 'high' && typeof i.code === 'string') out.add(i.code);
  }
  return out;
}

/** A safe, non-blocking result — used whenever a genuine before/after comparison is impossible. */
function notCompared(reason: string): WebBuildRenderRegressionResult {
  return {
    version: 'rendered-regression-v1',
    compared: false,
    regressed: false,
    newHighCodes: [],
    resolvedHighCodes: [],
    newRuntimeFailure: false,
    beforeHighCount: 0,
    afterHighCount: 0,
    reason: reason.slice(0, 200),
  };
}

/**
 * Compare the pre-repair and post-repair rendered evaluations.
 *
 * A regression is declared ONLY when the comparison is real (both sides present) AND at least one
 * HIGH-severity rendered finding is newly present after the repair. Fail-open in every other case.
 */
export function compareRenderedEvaluations(
  before: RenderedVisualEvaluationArtifact | undefined,
  after: RenderedVisualEvaluationArtifact | undefined,
): WebBuildRenderRegressionResult {
  try {
    if (!before || before.version !== 'rendered-visual-eval-v1') {
      return notCompared('no pre-repair rendered measurement — nothing to compare against');
    }
    if (!after || after.version !== 'rendered-visual-eval-v1') {
      return notCompared('no post-repair rendered measurement — the repair was judged statically');
    }
    // A measurement that observed nothing is not evidence of health. Requiring the post-repair
    // side to have actually observed the runtime prevents "no findings because nothing rendered"
    // from being read as "no regression".
    if (!after.runtimeReviewed) {
      return notCompared('the post-repair preview produced no runtime observation');
    }

    const beforeHigh = highCodes(before);
    const afterHigh = highCodes(after);
    const newHighCodes = [...afterHigh].filter((c) => !beforeHigh.has(c)).sort();
    const resolvedHighCodes = [...beforeHigh].filter((c) => !afterHigh.has(c)).sort();
    const newRuntimeFailure = newHighCodes.some((c) => RUNTIME_FAILURE_CODES.has(c));
    const regressed = newHighCodes.length > 0;

    const reason = !regressed
      ? resolvedHighCodes.length
        ? `The repaired project rendered without new severe defects and resolved ${resolvedHighCodes.length} (${resolvedHighCodes.slice(0, 3).join(', ')}).`
        : 'The repaired project rendered with no new severe defects.'
      : newRuntimeFailure
        ? `The repaired project failed to render: ${newHighCodes.filter((c) => RUNTIME_FAILURE_CODES.has(c)).join(', ')}.`
        : `The repair introduced ${newHighCodes.length} new severe rendered defect(s): ${newHighCodes.slice(0, 4).join(', ')}.`;

    return {
      version: 'rendered-regression-v1',
      compared: true,
      regressed,
      newHighCodes: newHighCodes.slice(0, MAX_CODES),
      resolvedHighCodes: resolvedHighCodes.slice(0, MAX_CODES),
      newRuntimeFailure,
      beforeHighCount: beforeHigh.size,
      afterHighCount: afterHigh.size,
      ...(typeof before.score === 'number' ? { beforeScore: before.score } : {}),
      ...(typeof after.score === 'number' ? { afterScore: after.score } : {}),
      reason: reason.slice(0, 200),
    };
  } catch {
    return notCompared('rendered regression comparison failed open');
  }
}

/** True when the comparison PROVES the repair broke the rendered page. Fails open to false. */
export function rendersWorseAfterRepair(r: WebBuildRenderRegressionResult | undefined): boolean {
  return !!r && r.compared === true && r.regressed === true;
}
