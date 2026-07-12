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
  /** True ONLY when this candidate may drive the NORMAL user-facing Preview as a finished
   *  site. Requires the ACTIVE consumed model-native project AND an approving acceptance
   *  (approved / repaired-approved), OR a legacy build with no acceptance artifact that
   *  already consumed model-native (pre-Phase-12E behaviour preserved). */
  approvedForUserPreview: boolean;
  reason: string;
}

/* ── Explicit Preview modes ──────────────────────────────────────────────────── */

export type WebBuildPreviewMode =
  | 'approved-model-native'
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
  | 'timeout'
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

    // 1) CONSUMED model-native project (the active files ARE the model-native project).
    if (consumption?.status === 'model-native' && candidateHasEntryFiles(active)) {
      const approving = acceptance === 'approved' || acceptance === 'repaired-approved'
        // Legacy: a pre-Phase-12E build has no acceptance artifact but already consumed
        // model-native as its finished preview — preserve that behaviour.
        || acceptance === 'unknown';
      return {
        available: true,
        source: 'consumed-model-native',
        files: active,
        acceptance,
        approvedForUserPreview: approving,
        reason: bound(
          approving
            ? `Consumed model-native project is the active build (acceptance: ${acceptance}).`
            : `Consumed model-native project exists but was not approved (acceptance: ${acceptance}); owner inspection only.`,
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
      reason: bound(`No model-native candidate available (acceptance: ${acceptance}). Deterministic safe fallback is the active result.`, MAX_RUNTIME_MESSAGE_CHARS),
    };
  } catch {
    return { available: false, source: 'none', files: [], acceptance: 'unknown', approvedForUserPreview: false, reason: 'Candidate derivation failed open.' };
  }
}

/**
 * Resolve the explicit Preview mode a viewer should see. Pure.
 *
 *   • Non-owner: the approved model-native project OR the safe fallback — never a candidate.
 *   • Owner: may inspect the candidate (default) or switch to the safe fallback.
 */
export function resolvePreviewMode(
  candidate: ModelNativeCandidate | undefined,
  isOwner: boolean,
  selection: OwnerPreviewSelection | undefined,
): WebBuildPreviewMode {
  const approved = !!candidate?.approvedForUserPreview;
  if (!isOwner) return approved ? 'approved-model-native' : 'safe-fallback';
  if (!candidate?.available) return 'safe-fallback';
  const sel: OwnerPreviewSelection = selection ?? 'model-native';
  if (sel === 'safe') return 'safe-fallback';
  return approved ? 'approved-model-native' : 'owner-candidate';
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
