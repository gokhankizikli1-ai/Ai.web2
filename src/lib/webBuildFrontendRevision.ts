/**
 * Web Build MODEL-NATIVE FRONTEND REVISION (Phase 13D).
 *
 * A real source-to-source revision path for an already-generated model-native React /
 * Tailwind project. It NEVER reruns website_builder planning, research, upstream agents,
 * layout, the Phase 12E quality pipeline, or deterministic file synthesis. Exactly ONE
 * dedicated `frontend_builder` Responses API call edits the existing files:
 *
 *   latest usable model-native step
 *     → derive immutable revision base (newest usable step; recovers a good build even
 *       when a later fallback revision is active)
 *     → resolve website language + classify scope (narrow | structural, negation-aware)
 *     → ONE bounded revision request (complete current files + compact spec)
 *     → UNCHANGED strict Phase 12C validation (exactly once)
 *     → deterministic revision-preservation gate
 *     → accept + append ONE revision step (owner Candidate Preview)
 *   OR
 *     → reject / fail: the current payload is preserved BYTE-FOR-BYTE and a bounded
 *       WebBuildError is thrown for the UI (retry uses the SAME base, never the failed
 *       output, never a deterministic fallback).
 *
 * SAFETY INVARIANT: a failed, timed-out, malformed, invalid or destructive revision can
 * NEVER replace the active project or append a fallback revision step. Pure/deterministic
 * helpers; only the single model call touches the network; only explicit caller
 * cancellation propagates.
 */
import {
  attachAcceptedFrontendRevision,
  type WebBuildPayload, type WebBuildFile,
} from '@/lib/webBuildPayload';
import {
  generateFrontendBuilderRevisionRaw, classifyFrontendRevisionScope, WebBuildError,
} from '@/lib/webBuildApi';
import { parseAndValidateFrontendBuilderRaw } from '@/lib/webBuildFrontendValidation';
import { resolveWebsiteOutputLanguage } from '@/lib/locale';
import type { Language } from '@/stores/languageStore';
import type {
  FrontendBuildSpecification, FrontendBuilderValidationArtifact,
  FrontendBuilderConsumptionArtifact, FrontendBuilderAcceptanceArtifact,
  FrontendGeneratedFile, FrontendRevisionScope, FrontendRevisionBaseSource,
  FrontendBuilderRevisionArtifact, WebBuildArtifacts,
} from '@/lib/webBuildAgents';

/* ── Types ──────────────────────────────────────────────────────────────────── */
export interface FrontendRevisionBase {
  source: FrontendRevisionBaseSource;
  stepId: string;
  stepIndex: number;
  files: WebBuildFile[];
  specification: FrontendBuildSpecification;
  validation: FrontendBuilderValidationArtifact;
  consumption: FrontendBuilderConsumptionArtifact;
  acceptance?: FrontendBuilderAcceptanceArtifact;
  websiteLanguage: Language;
}
export interface FrontendRevisionBaseResult {
  available: boolean;
  base?: FrontendRevisionBase;
  reason: string;
}
export interface FrontendRevisionPreservationResult {
  passed: boolean;
  scope: FrontendRevisionScope;
  baseFileCount: number;
  revisedFileCount: number;
  retainedFileCount: number;
  addedPaths: string[];
  removedPaths: string[];
  changedPaths: string[];
  unchangedPaths: string[];
  baseCharCount: number;
  revisedCharCount: number;
  charRatio: number;
  severelyShrunkPaths: string[];
  classNameRatio?: number;
  cssStructureRatio?: number;
  rejectionReason?: string;
}

/* ── Bounds + thresholds ──────────────────────────────────────────────────────── */
const REQUIRED_ENTRY_FILES = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];
const MAX_PATHS = 12;
const SHRINK_FLOOR_CHARS = 200;   // only files that WERE substantial can "collapse"
const SHRINK_RATIO = 0.55;        // retained file kept < 55% of its size = severely shrunk
// Narrow gate.
const NARROW_MIN_CHAR_RATIO = 0.75;
const NARROW_MAX_SHRUNK = 1;
const NARROW_MIN_CLASSNAME_RATIO = 0.70;
const NARROW_MIN_CSS_RATIO = 0.65;
// Structural gate.
const STRUCTURAL_MIN_RETAINED_RATIO = 0.70;
const STRUCTURAL_MIN_CHAR_RATIO = 0.60;

const langOf = (v: string | undefined): Language => (v === 'tr' ? 'tr' : 'en');
const cap = (xs: string[]): string[] => xs.slice(0, MAX_PATHS);
const cloneFiles = (files: WebBuildFile[]): WebBuildFile[] => files.map((f) => ({ ...f }));

/* ── Part A — derive the immutable model-native revision base ─────────────────── */

/** A step/root is a usable model-native base ONLY when its files + artifacts prove a
 *  consumed, valid model-native project (never deterministic internal-synthesis). Pure. */
function usableModelNative(
  files: WebBuildFile[] | undefined,
  artifacts: WebBuildArtifacts | undefined,
): { ok: boolean; spec?: FrontendBuildSpecification; validation?: FrontendBuilderValidationArtifact; consumption?: FrontendBuilderConsumptionArtifact; acceptance?: FrontendBuilderAcceptanceArtifact } {
  if (!Array.isArray(files) || files.length === 0) return { ok: false };
  const paths = new Set(files.map((f) => f.path));
  if (!REQUIRED_ENTRY_FILES.every((p) => paths.has(p))) return { ok: false };
  const spec = artifacts?.frontendBuildSpec;
  const validation = artifacts?.frontendBuilderValidation;
  const consumption = artifacts?.frontendBuilderConsumption;
  if (!spec || spec.status === 'failed-open') return { ok: false };
  if (!validation || validation.status !== 'valid' || validation.readyForConsumption !== true) return { ok: false };
  // A deterministic internal-synthesis fallback is NEVER a model-native base, even if its
  // paths resemble a React project.
  if (!consumption || consumption.status !== 'model-native' || consumption.fileSource !== 'model-native') return { ok: false };
  return { ok: true, spec, validation, consumption, acceptance: artifacts?.frontendBuilderAcceptance };
}

/**
 * Resolve the newest usable model-native project to revise. Precedence: the current
 * root/latest step, then the newest usable earlier step (recovering a good build when the
 * latest step is a fallback), else unavailable. NEVER mutates the payload/steps/files.
 */
export function deriveFrontendRevisionBase(payload: WebBuildPayload): FrontendRevisionBaseResult {
  try {
    const steps = Array.isArray(payload?.steps) ? payload.steps : [];
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      const s = steps[i];
      const check = usableModelNative(s?.files, s?.artifacts);
      if (check.ok && check.spec && check.validation && check.consumption) {
        const source: FrontendRevisionBaseSource = i === steps.length - 1
          ? 'active-root-model-native'
          : 'latest-usable-model-native-step';
        return {
          available: true,
          reason: source === 'active-root-model-native'
            ? 'The active latest step is a usable model-native project.'
            : `Recovered the newest usable model-native step (index ${i}); the later step(s) are fallback.`,
          base: {
            source,
            stepId: s.id,
            stepIndex: i,
            files: cloneFiles(s.files),
            specification: check.spec,
            validation: check.validation,
            consumption: check.consumption,
            acceptance: check.acceptance,
            websiteLanguage: langOf(check.spec.language),
          },
        };
      }
    }
    // Legacy single-build payload with no steps but a usable model-native root.
    if (steps.length === 0) {
      const check = usableModelNative(payload?.files, payload?.artifacts);
      if (check.ok && check.spec && check.validation && check.consumption) {
        return {
          available: true,
          reason: 'The root project (no steps) is a usable model-native project.',
          base: {
            source: 'active-root-model-native',
            stepId: 'root',
            stepIndex: -1,
            files: cloneFiles(payload.files),
            specification: check.spec,
            validation: check.validation,
            consumption: check.consumption,
            acceptance: check.acceptance,
            websiteLanguage: langOf(check.spec.language),
          },
        };
      }
    }
    return { available: false, reason: 'No usable model-native project (valid + ready + model-native consumption + entry files) was found to revise.' };
  } catch {
    return { available: false, reason: 'Revision base derivation failed; the payload was left unchanged.' };
  }
}

/* ── Part E — deterministic revision-preservation gate ────────────────────────── */

function countStructural(files: Array<{ path: string; content: string }>): { classNameUnits: number; cssUnits: number } {
  let classNameUnits = 0;
  let cssUnits = 0;
  for (const f of files) {
    const content = f.content || '';
    if (f.path.endsWith('.css')) {
      cssUnits += (content.match(/\{/g) || []).length + (content.match(/;/g) || []).length + (content.match(/--[a-z0-9-]+\s*:/gi) || []).length;
    } else {
      classNameUnits += (content.match(/<[A-Za-z][\w.]*/g) || []).length + (content.match(/className\s*=/g) || []).length;
    }
  }
  return { classNameUnits, cssUnits };
}

/**
 * Deterministic preservation gate. Compares the revised project against the base and
 * decides whether the edit preserved it (never collapsed it into a skeleton). Pure,
 * bounded, non-mutating. Structural richness uses className/JSX + CSS-rule counts — never
 * a raw line count — so a concise but structurally rich edit is not falsely rejected.
 */
export function evaluateFrontendRevisionPreservation(
  baseFiles: WebBuildFile[],
  revisedFiles: FrontendGeneratedFile[],
  scope: FrontendRevisionScope,
): FrontendRevisionPreservationResult {
  const baseByPath = new Map(baseFiles.map((f) => [f.path, f.content || '']));
  const revisedByPath = new Map(revisedFiles.map((f) => [f.path, f.content || '']));

  const addedPaths: string[] = [];
  const removedPaths: string[] = [];
  const changedPaths: string[] = [];
  const unchangedPaths: string[] = [];
  const severelyShrunkPaths: string[] = [];

  for (const p of revisedByPath.keys()) if (!baseByPath.has(p)) addedPaths.push(p);
  let retainedFileCount = 0;
  for (const [p, baseContent] of baseByPath) {
    const rev = revisedByPath.get(p);
    if (rev === undefined) { removedPaths.push(p); continue; }
    retainedFileCount += 1;
    if (rev === baseContent) unchangedPaths.push(p);
    else changedPaths.push(p);
    if (baseContent.length >= SHRINK_FLOOR_CHARS && rev.length < baseContent.length * SHRINK_RATIO) {
      severelyShrunkPaths.push(p);
    }
  }

  const baseCharCount = baseFiles.reduce((n, f) => n + (f.content || '').length, 0);
  const revisedCharCount = revisedFiles.reduce((n, f) => n + (f.content || '').length, 0);
  const charRatio = Math.round((revisedCharCount / Math.max(1, baseCharCount)) * 100) / 100;

  const baseStruct = countStructural(baseFiles);
  const revStruct = countStructural(revisedFiles);
  const classNameRatio = Math.round((revStruct.classNameUnits / Math.max(1, baseStruct.classNameUnits)) * 100) / 100;
  const cssStructureRatio = Math.round((revStruct.cssUnits / Math.max(1, baseStruct.cssUnits)) * 100) / 100;

  const revisedPaths = new Set(revisedFiles.map((f) => f.path));
  const entryRetained = REQUIRED_ENTRY_FILES.every((p) => revisedPaths.has(p));

  let rejectionReason: string | undefined;
  if (!entryRetained) {
    rejectionReason = 'The revision dropped a required entry file (src/main.tsx / src/App.tsx / src/styles.css).';
  } else if (scope === 'narrow') {
    if (removedPaths.length > 0) {
      rejectionReason = `A narrow revision removed ${removedPaths.length} existing file(s): ${cap(removedPaths).join(', ')}.`;
    } else if (changedPaths.length === 0) {
      rejectionReason = 'The narrow revision changed no file — no requested edit was applied.';
    } else if (charRatio < NARROW_MIN_CHAR_RATIO) {
      rejectionReason = `The narrow revision collapsed to ${Math.round(charRatio * 100)}% of the original source size (min ${Math.round(NARROW_MIN_CHAR_RATIO * 100)}%).`;
    } else if (severelyShrunkPaths.length > NARROW_MAX_SHRUNK) {
      rejectionReason = `The narrow revision collapsed ${severelyShrunkPaths.length} substantial files to skeleton size: ${cap(severelyShrunkPaths).join(', ')}.`;
    } else if (classNameRatio < NARROW_MIN_CLASSNAME_RATIO) {
      rejectionReason = `The narrow revision lost too much JSX/className structure (${Math.round(classNameRatio * 100)}% of base; min ${Math.round(NARROW_MIN_CLASSNAME_RATIO * 100)}%).`;
    } else if (cssStructureRatio < NARROW_MIN_CSS_RATIO) {
      rejectionReason = `The narrow revision lost too much CSS structure (${Math.round(cssStructureRatio * 100)}% of base; min ${Math.round(NARROW_MIN_CSS_RATIO * 100)}%).`;
    }
  } else {
    // structural — wider changes allowed, but no skeleton.
    const retainedRatio = retainedFileCount / Math.max(1, baseByPath.size);
    const maxShrunk = Math.max(1, Math.floor(baseByPath.size * 0.3));
    if (retainedRatio < STRUCTURAL_MIN_RETAINED_RATIO) {
      rejectionReason = `The structural revision retained only ${Math.round(retainedRatio * 100)}% of the original files (min ${Math.round(STRUCTURAL_MIN_RETAINED_RATIO * 100)}%).`;
    } else if (charRatio < STRUCTURAL_MIN_CHAR_RATIO) {
      rejectionReason = `The structural revision collapsed to ${Math.round(charRatio * 100)}% of the original source size (min ${Math.round(STRUCTURAL_MIN_CHAR_RATIO * 100)}%).`;
    } else if (severelyShrunkPaths.length > maxShrunk) {
      rejectionReason = `The structural revision collapsed ${severelyShrunkPaths.length} substantial files into tiny placeholders (max ${maxShrunk}).`;
    }
  }

  return {
    passed: !rejectionReason,
    scope,
    baseFileCount: baseByPath.size,
    revisedFileCount: revisedByPath.size,
    retainedFileCount,
    addedPaths: cap(addedPaths),
    removedPaths: cap(removedPaths),
    changedPaths: cap(changedPaths),
    unchangedPaths: cap(unchangedPaths),
    baseCharCount,
    revisedCharCount,
    charRatio,
    severelyShrunkPaths: cap(severelyShrunkPaths),
    classNameRatio,
    cssStructureRatio,
    rejectionReason,
  };
}

/* ── Bilingual bounded messages for the UI ────────────────────────────────────── */
const msg = (lang: Language, tr: string, en: string): string => (lang === 'tr' ? tr : en);

/* ── Part H — public revision orchestration (exactly one model call) ──────────── */
export async function runFrontendBuilderRevision(
  payload: WebBuildPayload,
  revisionPrompt: string,
  options?: { signal?: AbortSignal; uiLanguage?: Language },
): Promise<WebBuildPayload> {
  const uiLanguage: Language = options?.uiLanguage || 'en';
  const trimmed = (revisionPrompt || '').trim();
  if (!trimmed) {
    throw new WebBuildError('revision_failed', msg(uiLanguage,
      'Boş bir revizyon talimatı gönderildi.',
      'An empty revision instruction was submitted.'));
  }

  // 1) derive the immutable model-native base.
  const baseResult = deriveFrontendRevisionBase(payload);
  if (!baseResult.available || !baseResult.base) {
    throw new WebBuildError('revision_no_base', msg(uiLanguage,
      'Bu build’de düzenlenebilir model-native proje bulunamadı. Yeni bir build oluştur.',
      'No editable model-native project was found in this build. Please create a new build.'));
  }
  const base = baseResult.base;

  // 2) resolve website language (explicit request → existing → detect → ui → en).
  const websiteLanguage = resolveWebsiteOutputLanguage(trimmed, { existingLanguage: base.websiteLanguage, uiLanguage });
  const languageChanged = websiteLanguage !== base.websiteLanguage;
  const effectiveSpecification: FrontendBuildSpecification = languageChanged
    ? { ...base.specification, language: websiteLanguage }
    : base.specification;

  // 3) classify scope (narrow default; negation-aware).
  const scope: FrontendRevisionScope = classifyFrontendRevisionScope(trimmed);

  // 4) ONE dedicated revision model call.
  const raw = await generateFrontendBuilderRevisionRaw(effectiveSpecification, base.files, trimmed, {
    signal: options?.signal,
    websiteLanguage,
    scope,
  });

  // 5) stop on transport failure — the current payload is preserved (never mutated here).
  if (raw.status !== 'completed') {
    const detail = raw.backendErrorKind ? ` (${raw.backendErrorKind})` : '';
    throw new WebBuildError('revision_failed', msg(uiLanguage,
      `Revizyon isteği tamamlanamadı${detail}; mevcut proje korundu. Lütfen tekrar dene.`,
      `The revision request did not complete${detail}; your current project was preserved. Please try again.`));
  }

  // 6) strict Phase 12C validation, exactly once (validator unchanged).
  const validation = parseAndValidateFrontendBuilderRaw(raw, effectiveSpecification);
  const revisedPaths = new Set(validation.files.map((f) => f.path));
  const validOK =
    validation.status === 'valid' &&
    validation.readyForConsumption === true &&
    validation.files.length > 0 &&
    REQUIRED_ENTRY_FILES.every((p) => revisedPaths.has(p));

  // 7) stop on invalid output — no contract/quality repair, no fallback synthesis.
  if (!validOK) {
    throw new WebBuildError('revision_rejected', msg(uiLanguage,
      'Revizyon geçerli bir frontend projesi üretmedi; orijinal proje korundu.',
      'The revision did not produce a valid frontend project; your original project was preserved.'));
  }

  // 8) deterministic preservation gate.
  const gate = evaluateFrontendRevisionPreservation(base.files, validation.files, scope);
  if (!gate.passed) {
    throw new WebBuildError('revision_rejected', msg(uiLanguage,
      `Revizyon reddedildi ve orijinal proje korundu: ${gate.rejectionReason || 'koruma denetimi başarısız.'}`,
      `The revision was rejected and your original project was preserved: ${gate.rejectionReason || 'preservation gate failed.'}`));
  }

  // 9) build the accepted revision artifact (bounded; no raw response / secrets).
  const revisionArtifact: FrontendBuilderRevisionArtifact = {
    version: 'frontend-revision-v1',
    status: 'accepted',
    scope,
    baseSource: base.source,
    baseStepId: base.stepId,
    revisionPromptPreview: trimmed.slice(0, 180),
    websiteLanguage,
    model: raw.model,
    provider: raw.provider,
    requestId: raw.requestId,
    executionStatus: raw.executionStatus,
    executionEndpoint: raw.executionEndpoint,
    backendLatencyMs: raw.backendLatencyMs,
    validationStatus: 'valid',
    baseFileCount: gate.baseFileCount,
    revisedFileCount: gate.revisedFileCount,
    changedFileCount: gate.changedPaths.length,
    retainedFileCount: gate.retainedFileCount,
    addedPaths: gate.addedPaths,
    removedPaths: gate.removedPaths,
    changedPaths: gate.changedPaths,
    baseCharCount: gate.baseCharCount,
    revisedCharCount: gate.revisedCharCount,
    preservationRatio: gate.charRatio,
    severelyShrunkPaths: gate.severelyShrunkPaths,
    preservationGatePassed: true,
    reason: `${scope} revision accepted: ${gate.changedPaths.length} file(s) changed, ${gate.retainedFileCount}/${gate.baseFileCount} retained, ${Math.round(gate.charRatio * 100)}% source preserved.${languageChanged ? ` Website language set to ${websiteLanguage}.` : ''}`.slice(0, 300),
  };

  // 10) attach immutably — append exactly one revision step; the original stays untouched.
  return attachAcceptedFrontendRevision(payload, {
    baseFiles: base.files,
    baseSource: base.source,
    baseStepId: base.stepId,
    revisionPrompt: trimmed,
    revisedValidation: validation,
    revisionArtifact,
    effectiveSpecification,
  });
}
