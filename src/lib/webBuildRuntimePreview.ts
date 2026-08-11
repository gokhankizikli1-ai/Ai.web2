/**
 * Web Build RUNTIME PREVIEW authority (Phase 13A).
 *
 * A small LEAF utility: pure, deterministic, synchronous, network-free, non-mutating,
 * fail-open helpers + types that decide (a) which model-native candidate — if any — the
 * owner may inspect, and (b) which of three explicit Preview modes a viewer should see.
 * It also carries the EPHEMERAL runtime-snapshot shape observed from the isolated Sandpack
 * runtime via Sandpack's PUBLIC API (never persisted, never sent to a model/backend).
 *
 * Honesty boundaries this module encodes:
 *   • candidate AVAILABLE ≠ candidate APPROVED as a finished website;
 *   • a deterministic internal-synthesis fallback is NEVER a model-native candidate;
 *   • a running sandbox is NOT a visual-quality pass — `visualQualityObserved` and
 *     `screenshotObserved` are ALWAYS false here.
 *
 * Imports are TYPE-ONLY from the payload/agents modules, so there is no runtime cycle and
 * nothing here is modified in those modules.
 */
import type { WebBuildFile, WebBuildStep } from '@/lib/webBuildPayload';
import type { FrontendGeneratedFile } from '@/lib/webBuildAgents';

/* ── Candidate model ─────────────────────────────────────────────────────────── */

export type ModelNativeCandidateSource =
  | 'consumed-model-native'
  | 'parsed-initial-candidate'
  | 'none';

export type FrontendAcceptanceState =
  | 'approved'
  | 'repaired-approved'
  | 'manual-review-required'
  | 'skipped'
  | 'unknown';

export interface ModelNativeCandidate {
  available: boolean;
  source: ModelNativeCandidateSource;
  /** Read-only model-native files for the isolated Sandpack runtime. Never mutated. */
  files: WebBuildFile[];
  acceptance: FrontendAcceptanceState;
  /** True ONLY when this candidate may drive the NORMAL user-facing Preview as a FINISHED,
   *  quality-APPROVED site. Requires the ACTIVE consumed model-native project AND an approving
   *  acceptance (approved / repaired-approved), OR a legacy build with no acceptance artifact that
   *  already consumed model-native (pre-Phase-12E behaviour preserved). This is a QUALITY-approval
   *  fact; it is deliberately DISTINCT from `safeToRenderModelNativePreview`. */
  approvedForUserPreview: boolean;
  /** True when the ACTIVE project is a genuinely render-SAFE model-native project — structurally
   *  valid, ready for consumption and runnable — INDEPENDENT of quality acceptance. This is the
   *  "safe/valid enough to render" concept (vs `approvedForUserPreview` = "approved as finished").
   *  Requires: consumption model-native (the active files ARE the model-native project, NOT the
   *  deterministic internal-synthesis fallback), validation status 'valid' (⇒ no structural errors
   *  AND no forbidden runtime/security patterns), readyForConsumption, and all three entry files.
   *  A PARSED-but-unconsumed initial candidate is NEVER render-safe for a normal user (false), so it
   *  can never gain user-facing authority. Runtime error/timeout is enforced separately by the panel. */
  safeToRenderModelNativePreview: boolean;
  reason: string;
}

/* ── Explicit Preview modes ──────────────────────────────────────────────────── */

export type WebBuildPreviewMode =
  | 'approved-model-native'
  | 'provisional-model-native'
  | 'owner-candidate'
  | 'safe-fallback';

/** The owner's component-local choice within the segmented selector. */
export type OwnerPreviewSelection = 'model-native' | 'safe';

/* ── Ephemeral Sandpack runtime snapshot (React state ONLY; never persisted) ──── */

export type ModelNativeRuntimePhase =
  | 'not-started'
  | 'initializing'
  | 'running'
  | 'error'
  // CONFIRMED failures below this line: 'error' = a fatal compile/runtime error reported by
  // the sandbox; 'timeout' = the SANDBOX ITSELF reported a bundler timeout. Both are genuine
  // render-safety failures (see isModelNativeRuntimeFailure).
  | 'timeout'
  // HOST-side observation, NOT a confirmed failure: our own soft timeout elapsed without the
  // sandbox emitting a running/done signal. A healthy-but-slow COLD start (large dependency
  // install / transpile) lands here. It is deliberately EXCLUDED from runtime failure so a
  // structurally valid model-native project is never replaced by Safe merely for being slow.
  | 'slow-start'
  | 'unknown';

export interface ModelNativeRuntimeSnapshot {
  version: 'model-native-runtime-v1';
  phase: ModelNativeRuntimePhase;
  /** The raw public Sandpack status string, when a supported hook exposes it. */
  publicStatus?: string;
  errorCount: number;
  warningCount: number;
  messages: string[];
  sandboxRuntimeObserved: boolean;
  /** ALWAYS false — a static/runtime observation never inspects rendered visuals. */
  visualQualityObserved: false;
  /** ALWAYS false — no screenshot is ever taken or reviewed. */
  screenshotObserved: false;
  reason: string;
}

/* ── Bounds (guard against noisy/untrusted bundler output) ────────────────────── */
export const MAX_RUNTIME_MESSAGES = 6;
export const MAX_RUNTIME_MESSAGE_CHARS = 220;

const MODEL_NATIVE_ENTRY_PATHS = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];

const bound = (s: string, n: number): string => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** True when `files` carries all three non-empty model-native entry files. Pure. */
export function candidateHasEntryFiles(files: WebBuildFile[] | undefined): boolean {
  if (!Array.isArray(files) || files.length === 0) return false;
  const byPath = new Map(files.filter(Boolean).map((f) => [f.path, f]));
  return MODEL_NATIVE_ENTRY_PATHS.every((p) => {
    const f = byPath.get(p);
    return !!f && typeof f.content === 'string' && f.content.trim().length > 0;
  });
}

/** Filter arbitrary input to well-formed WebBuildFile values (never mutates). */
function sanitizeFiles(files: WebBuildFile[] | undefined): WebBuildFile[] {
  return Array.isArray(files)
    ? files.filter((f): f is WebBuildFile => !!f && typeof f.path === 'string' && typeof f.content === 'string')
    : [];
}

/**
 * PROVENANCE (source distinction) — true when the ACTIVE entry files are byte-for-byte the model
 * output that Phase 12C validation parsed, i.e. the active files ARE the consumed model-native project
 * and NOT the deterministic internal-synthesis fallback. The synthesis fallback emits the SAME entry
 * PATHS (src/main.tsx, src/App.tsx, src/styles.css) but its deterministically-generated CONTENT never
 * equals the validated model output — so this content match cannot be satisfied by synthesis, and it
 * does not depend on the (drift-prone) consumption artifact. Pure; never mutates. `validationFiles`
 * are the Phase 12C generated files (already persisted alongside validation).
 */
function activeEntryFilesMatchValidated(
  active: WebBuildFile[], validationFiles: FrontendGeneratedFile[] | undefined,
): boolean {
  if (!Array.isArray(validationFiles) || validationFiles.length === 0) return false;
  const validated = new Map<string, string>();
  for (const f of validationFiles) {
    if (f && typeof f.path === 'string' && typeof f.content === 'string') validated.set(f.path, f.content);
  }
  return MODEL_NATIVE_ENTRY_PATHS.every((p) => {
    const a = active.find((x) => x && x.path === p);
    return !!a && typeof a.content === 'string' && validated.get(p) === a.content;
  });
}

/** Map Phase 12C validation files (read-only parsed candidate) to WebBuildFile values.
 *  Content is passed byte-for-byte; diff status is a neutral 'unchanged' record. */
function mapValidationFiles(files: FrontendGeneratedFile[] | undefined): WebBuildFile[] {
  return Array.isArray(files)
    ? files
        .filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string')
        .map((f) => ({ path: f.path, content: f.content, language: f.language, status: 'unchanged' as const, added: 0, removed: 0 }))
    : [];
}

function normalizeAcceptance(status: unknown): FrontendAcceptanceState {
  return (status === 'approved' || status === 'repaired-approved'
    || status === 'manual-review-required' || status === 'skipped')
    ? (status as FrontendAcceptanceState)
    : 'unknown';
}

/**
 * Derive the model-native candidate the owner may inspect, from the latest build step and
 * the currently active files. Pure, deterministic, non-mutating, fail-open.
 *
 * Precedence:
 *   1. CONSUMED model-native — consumption.status === 'model-native' AND the active files
 *      carry the required entry files → use the active files (`consumed-model-native`).
 *   2. PARSED initial candidate — the Phase 12C validation parsed non-empty generated files
 *      that carry the required entry files → map them read-only (`parsed-initial-candidate`).
 *   3. Otherwise → unavailable.
 *
 * A deterministic internal-synthesis fallback is NEVER treated as model-native, even when
 * its paths look similar: candidacy is decided from the consumption/validation artifacts,
 * never from filenames alone.
 */
export function deriveModelNativeCandidate(
  step: WebBuildStep | undefined,
  activeFiles: WebBuildFile[] | undefined,
): ModelNativeCandidate {
  try {
    const artifacts = step?.artifacts;
    const acceptance = normalizeAcceptance(artifacts?.frontendBuilderAcceptance?.status);
    const consumption = artifacts?.frontendBuilderConsumption;
    const validation = artifacts?.frontendBuilderValidation;
    const active = sanitizeFiles(activeFiles);
    const hasEntry = candidateHasEntryFiles(active);
    const validationInvalid = validation?.status === 'invalid';
    const validationValidReady = validation?.status === 'valid' && validation?.readyForConsumption === true;

    // ── PROVENANCE: are the ACTIVE files the real model-native project, or the deterministic
    // internal-synthesis fallback? The two share the same entry PATHS, so filenames can never decide
    // this. We DO NOT rely SOLELY on the (drift-prone) consumption artifact. The active files ARE the
    // consumed model-native project when EITHER:
    //   • the consumption artifact records model-native (the original signal), OR
    //   • Phase 12C validation proves the model output was valid + ready-to-consume — the EXACT gate
    //     the build consumes files on (webBuildPayload canConsume) — AND the active entry files are
    //     byte-for-byte that validated output. The build replaces the synthesis fallback with the
    //     model-native files precisely when that gate holds, so this recovers a healthy generated site
    //     whose consumption artifact is MISSING or STALE, WITHOUT ever matching synthesis (whose
    //     content differs and which is never valid+ready-active). This strengthens the source
    //     distinction (a positive content proof) rather than weakening it.
    const activeIsValidatedModelNative = validationValidReady && activeEntryFilesMatchValidated(active, validation?.files);
    const consumedModelNative = hasEntry && (consumption?.status === 'model-native' || activeIsValidatedModelNative);

    // 1) CONSUMED model-native project (the active files ARE the model-native project).
    if (consumedModelNative) {
      const approving = acceptance === 'approved' || acceptance === 'repaired-approved'
        // Legacy: a pre-Phase-12E build has no acceptance artifact but already consumed
        // model-native as its finished preview — preserve that behaviour.
        || acceptance === 'unknown';
      // Render-SAFETY is pure RENDERABILITY of the consumed model-native project, and is DELIBERATELY
      // INDEPENDENT of every quality/approval signal — acceptance, score, review completion, and whether
      // a quality repair ran/failed/timed out NEVER participate here. The project renders whenever its
      // files ARE the model-native project (consumedModelNative, already gated on the three entry files)
      // and validation does NOT mark it structurally invalid/unsafe. Only that structural invalidity
      // forces Safe from this pure decision; a CONFIRMED runtime error/timeout is enforced separately by
      // the panel/route (isModelNativeRuntimeFailure). `readyForConsumption` ≡ `status === 'valid'`
      // (validation sets ready = status==='valid'; quality WARNINGS never change it), so requiring
      // valid+ready would ALSO reject a drift state — consumption model-native but a skipped/absent
      // validation whose files are present and not invalid — which must still render. Hence the gate is
      // simply "the model-native project is present AND validation is not explicitly invalid".
      const safeToRender = !validationInvalid;
      return {
        available: true,
        source: 'consumed-model-native',
        files: active,
        acceptance,
        approvedForUserPreview: approving,
        safeToRenderModelNativePreview: safeToRender,
        reason: bound(
          approving
            ? `Consumed model-native project is the active build (acceptance: ${acceptance}).`
            : safeToRender
              ? `Consumed model-native project is structurally valid and render-safe but not quality-approved (acceptance: ${acceptance}); provisional user preview.`
              : `Consumed model-native project exists but is not render-safe (acceptance: ${acceptance}); owner inspection only.`,
          MAX_RUNTIME_MESSAGE_CHARS,
        ),
      };
    }

    // 2) PARSED initial candidate that was NOT consumed (fallback is active for users).
    if (validation?.didParse && Array.isArray(validation.files) && validation.files.length > 0) {
      const parsed = mapValidationFiles(validation.files);
      if (candidateHasEntryFiles(parsed)) {
        return {
          available: true,
          source: 'parsed-initial-candidate',
          files: parsed,
          acceptance,
          // A parsed-but-unconsumed candidate is NEVER the approved user-facing preview.
          approvedForUserPreview: false,
          // ...and NEVER render-safe for a normal user either — it was not consumed as the active
          // project, so it must not gain user-facing authority through the new safe-render path.
          safeToRenderModelNativePreview: false,
          reason: bound(
            `Parsed initial model-native candidate (not consumed; acceptance: ${acceptance}). Owner inspection only — validation/quality did not pass for user preview.`,
            MAX_RUNTIME_MESSAGE_CHARS,
          ),
        };
      }
    }

    // 3) No usable model-native candidate.
    return {
      available: false,
      source: 'none',
      files: [],
      acceptance,
      approvedForUserPreview: false,
      safeToRenderModelNativePreview: false,
      reason: bound(`No model-native candidate available (acceptance: ${acceptance}). Deterministic safe fallback is the active result.`, MAX_RUNTIME_MESSAGE_CHARS),
    };
  } catch {
    return { available: false, source: 'none', files: [], acceptance: 'unknown', approvedForUserPreview: false, safeToRenderModelNativePreview: false, reason: 'Candidate derivation failed open.' };
  }
}

/**
 * Resolve the explicit Preview mode a viewer should see. Pure.
 *
 *   • Non-owner: a structurally render-SAFE model-native project (approved → 'approved-model-native';
 *     valid-but-not-yet-approved → 'provisional-model-native'), otherwise the safe fallback. A
 *     manual-review-required build is NO LONGER forced to safe-fallback merely because quality
 *     acceptance did not approve it — only a NON-render-safe project falls back. This decouples
 *     "safe/valid enough to render" from "approved as finished" without auto-approving anything.
 *   • Owner: may inspect the candidate (default) or switch to the safe fallback (UNCHANGED).
 *
 * Runtime error/timeout/missing-entry safety is enforced downstream by the panel's candidate-failure
 * path for EVERY model-native mode (including 'provisional-model-native'), so this stays purely the
 * static source-authority decision.
 */
export function resolvePreviewMode(
  candidate: ModelNativeCandidate | undefined,
  isOwner: boolean,
  selection: OwnerPreviewSelection | undefined,
): WebBuildPreviewMode {
  const approved = !!candidate?.approvedForUserPreview;
  if (!isOwner) {
    if (!candidate?.safeToRenderModelNativePreview) return 'safe-fallback';
    return approved ? 'approved-model-native' : 'provisional-model-native';
  }
  if (!candidate?.available) return 'safe-fallback';
  const sel: OwnerPreviewSelection = selection ?? 'model-native';
  if (sel === 'safe') return 'safe-fallback';
  return approved ? 'approved-model-native' : 'owner-candidate';
}

/**
 * The SINGLE, shared decision for "did the model-native runtime genuinely FAIL, such that a
 * structurally valid project must be replaced by the deterministic Safe preview?" Pure.
 *
 * Returns true ONLY for a CONFIRMED render-safety failure:
 *   • 'error'   — a fatal compile/runtime error reported by the sandbox;
 *   • 'timeout' — the SANDBOX ITSELF reported a bundler timeout.
 *
 * It returns FALSE for 'slow-start' (a host-side no-signal soft-timeout observation — a healthy
 * but slow cold start), and for every non-terminal phase ('not-started', 'initializing',
 * 'running', 'unknown'). Both the embedded panel and the standalone route call THIS helper, so
 * their runtime→Safe decisions can never drift, and a slow start is never mistaken for a failure.
 */
export function isModelNativeRuntimeFailure(phase: ModelNativeRuntimePhase | undefined): boolean {
  return phase === 'error' || phase === 'timeout';
}

/* ── Runtime snapshot helpers ─────────────────────────────────────────────────── */

export function emptyRuntimeSnapshot(): ModelNativeRuntimeSnapshot {
  return {
    version: 'model-native-runtime-v1',
    phase: 'not-started',
    errorCount: 0,
    warningCount: 0,
    messages: [],
    sandboxRuntimeObserved: false,
    visualQualityObserved: false,
    screenshotObserved: false,
    reason: 'No runtime signal observed yet.',
  };
}

/** Bound + dedupe runtime messages (≤6 entries, ≤220 chars each, no duplicates). */
export function boundRuntimeMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(messages) ? messages : []) {
    const m = bound(String(raw || ''), MAX_RUNTIME_MESSAGE_CHARS);
    if (!m || seen.has(m)) continue;
    seen.add(m);
    out.push(m);
    if (out.length >= MAX_RUNTIME_MESSAGES) break;
  }
  return out;
}

/** A stable string key so callers can emit ONLY when the bounded snapshot changes. */
export function runtimeSnapshotKey(s: ModelNativeRuntimeSnapshot): string {
  return `${s.phase}|${s.publicStatus || ''}|${s.errorCount}|${s.warningCount}|${s.messages.join('¦')}`;
}
