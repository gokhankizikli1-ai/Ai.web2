/**
 * Web Build OWNER-ONLY COMPACT quality-context — pure, deterministic, network-free selection of
 * a BOUNDED, safe subset of the active source to send with the owner-delta quality-repair request
 * and the post-repair review, instead of re-sending the full specification + every complete file.
 *
 * This module NEVER makes a provider/model/network call and NEVER mutates its inputs. It only:
 *   - resolves the compact-context mode flag,
 *   - selects target files from AUTHORITATIVE internal evidence (review-issue file references,
 *     deterministic quality-evidence paths, changed/upsert paths, required entry/root files),
 *   - builds a bounded local dependency + importer closure using STATIC RELATIVE imports only,
 *   - returns the included full-source files + a metadata-only manifest of the omitted files, plus
 *     sanitized, measured diagnostics.
 *
 * On ANY ambiguity or bound violation it returns `context: undefined` with a bounded fallbackReason
 * so the caller uses the EXISTING full-context request (before the single provider call — never a
 * second call). Model-supplied prose is NEVER turned into a filesystem path: only structured
 * `issue.files` entries, deterministic evidence path fields and normalized upsert paths are used,
 * and every one must resolve to a file that already exists in the active generated set.
 */
import type { WebBuildFile } from '@/lib/webBuildPayload';
import type {
  FrontendBuildSpecification, FrontendBuilderReviewArtifact,
  FrontendQualityContextDiagnostics, FrontendQualityContextFallbackReason,
} from '@/lib/webBuildAgents';

/* ── Mode flag (Vite convention, mirrors resolveWebBuildQualityRepairMode) ─────
 * VITE_WEB_BUILD_QUALITY_CONTEXT_MODE = disabled | owner_compact | all_compact
 *   disabled     — full source is sent with the repair/post-review (default).
 *   owner_compact— compact source context inside the delta repair, owners only (legacy).
 *   all_compact  — the SAME compact context for EVERY entitled build user (parity).
 * Only ever active INSIDE the delta path (compactContextEligible = deltaEligible && …).
 * Missing / empty / malformed / unknown ⇒ disabled (fail-closed). */
export type WebBuildQualityContextMode = 'disabled' | 'owner_compact' | 'all_compact';

export function resolveWebBuildQualityContextMode(): WebBuildQualityContextMode {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_WEB_BUILD_QUALITY_CONTEXT_MODE;
    const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return v === 'owner_compact' ? 'owner_compact' : v === 'all_compact' ? 'all_compact' : 'disabled';
  } catch {
    return 'disabled';
  }
}

/**
 * Whether the compact repair/post-review context runs for this build. Only ever inside the
 * delta path (`deltaEligible`). `owner_compact` → owners only; `all_compact` → every entitled
 * user (parity). Pure + deterministic. Compact context safe-falls-back to full context on any
 * ambiguity, and never changes the local validator or the deterministic acceptance gates.
 */
export function isCompactContextEligible(
  deltaEligible: boolean,
  mode: WebBuildQualityContextMode,
  ownerEligible: boolean,
): boolean {
  if (!deltaEligible) return false;
  if (mode === 'all_compact') return true;
  if (mode === 'owner_compact') return ownerEligible === true;
  return false;
}

/** A bounded, sanitized compact source-context selection: the full-source files to include plus a
 *  metadata-only manifest of the omitted files. Passed to the request builders so they serialize
 *  the compact source instead of the full project. Contains NO omitted-file source content. */
export interface CompactSourceContext {
  includedFiles: WebBuildFile[];
  omittedManifest: Array<{ path: string; language: string; charCount: number }>;
}

/** Minimal structural view of the deterministic quality evidence the pipeline already builds
 *  (a subset of FrontendRepairQualityEvidence). Kept structural to avoid importing webBuildApi. */
export interface CompactQualityEvidence {
  shallowSectionPaths?: string[];
  repetitiveSectionPaths?: string[];
  internalCopyLeakFiles?: string[];
  heroComponentPath?: string;
}

/* ── Conservative named bounds (well under MAX_FRONTEND_TASK_REQUEST_CHARS = 240k) ──────── */
const MAX_COMPACT_SOURCE_FILES = 18;      // max full-source files in a compact request
const MAX_DEPENDENCY_DEPTH = 2;           // static relative-import expansion depth from a target
const MAX_IMPORTER_DEPTH = 1;             // direct importers of a target (depth 1 only)
const MAX_COMPACT_SOURCE_CHARS = 90_000;  // max total included source characters
const MAX_OMITTED_MANIFEST_ENTRIES = 120; // ≥ the validator's MAX_GENERATED_FILES (80)
const MAX_MANIFEST_PATH_CHARS = 160;      // max per-entry path length in the omitted manifest

const SUPPORTED_EXT = ['.tsx', '.ts', '.css'] as const;

/* ── Path helpers (consistent with the delta module's normalization) ───────────────────── */
function normalizePath(p: string): string {
  return (p || '').trim().replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/');
}
function hasSupportedExt(norm: string): boolean {
  const lower = norm.toLowerCase();
  return SUPPORTED_EXT.some((e) => lower.endsWith(e));
}
/** A safe, supported, relative project path with no traversal/absolute/backslash/empty segment. */
function isSafeSupportedPath(norm: string): boolean {
  if (!norm || norm.includes('\\') || norm.includes('\0')) return false;
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return false;
  const segs = norm.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return false;
  return hasSupportedExt(norm);
}
function fileLanguage(f: WebBuildFile, norm: string): string {
  return f.language || (norm.endsWith('.tsx') ? 'tsx' : norm.endsWith('.css') ? 'css' : 'ts');
}

/* ── Static relative-import extraction (never dynamic/aliased/bare specifiers) ──────────── */
const IMPORT_FROM_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*['"]([^'"]+)['"]/g;

function relativeSpecifiers(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_FROM_RE.lastIndex = 0;
  while ((m = IMPORT_FROM_RE.exec(content)) !== null) { if (m[1].startsWith('.')) out.push(m[1]); }
  SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
  while ((m = SIDE_EFFECT_IMPORT_RE.exec(content)) !== null) { if (m[1].startsWith('.')) out.push(m[1]); }
  return out;
}

/** Resolve a relative specifier from `fromNorm` against the active index. Returns the resolved
 *  normalized path, or `{ escaped: true }` when the join climbs above the project root (ambiguous),
 *  or null when it does not resolve to an existing supported file. */
function resolveRelative(spec: string, fromNorm: string, index: Map<string, WebBuildFile>): { path?: string; escaped?: boolean } | null {
  const baseSegs = fromNorm.split('/').slice(0, -1);
  const segs = [...baseSegs];
  for (const part of spec.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segs.length === 0) return { escaped: true }; // climbs above project root → ambiguous
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  const joined = segs.join('/');
  if (!joined) return null;
  const candidates = hasSupportedExt(joined)
    ? [joined]
    : [`${joined}.tsx`, `${joined}.ts`, `${joined}.css`, `${joined}/index.tsx`, `${joined}/index.ts`];
  for (const c of candidates) {
    if (index.has(c)) return { path: c };
  }
  return null;
}

interface AssembleOk {
  ok: true;
  includedNorms: string[];
  compactChars: number;
}
interface AssembleErr { ok: false; reason: FrontendQualityContextFallbackReason; }

/** Build the bounded dependency + importer closure from the resolved seed paths, add required
 *  files, and enforce every bound. Deterministic and pure. */
function assembleClosure(
  index: Map<string, WebBuildFile>,
  order: string[],           // deterministic active-path order
  seedNorms: string[],
  requiredNorms: string[],
): AssembleOk | AssembleErr {
  const resolvedSeeds = seedNorms.filter((s) => index.has(s));
  if (resolvedSeeds.length === 0) return { ok: false, reason: 'no-targets' };

  const included = new Set<string>(resolvedSeeds);
  let ambiguous = false;

  // Dependency BFS from the seeds (static relative imports only).
  let frontier = [...resolvedSeeds];
  for (let depth = 0; depth < MAX_DEPENDENCY_DEPTH && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const f of frontier) {
      const rec = index.get(f);
      if (!rec) continue;
      for (const spec of relativeSpecifiers(rec.content)) {
        const r = resolveRelative(spec, f, index);
        if (r?.escaped) { ambiguous = true; continue; }
        if (r?.path && !included.has(r.path)) { included.add(r.path); next.push(r.path); }
      }
    }
    if (included.size > MAX_COMPACT_SOURCE_FILES) return { ok: false, reason: 'too-many-files' };
    frontier = next;
  }

  // Direct importers of the seeds (depth 1) — deterministically resolvable static imports only.
  if (MAX_IMPORTER_DEPTH >= 1) {
    for (const norm of order) {
      if (included.has(norm)) continue;
      const rec = index.get(norm);
      if (!rec) continue;
      const importsSeed = relativeSpecifiers(rec.content).some((spec) => {
        const r = resolveRelative(spec, norm, index);
        return !!r?.path && resolvedSeeds.includes(r.path);
      });
      if (importsSeed) {
        included.add(norm);
        if (included.size > MAX_COMPACT_SOURCE_FILES) return { ok: false, reason: 'too-many-files' };
      }
    }
  }

  // Required entry/root/style files that exist in the active set.
  for (const r of requiredNorms) if (index.has(r)) included.add(r);
  if (included.size > MAX_COMPACT_SOURCE_FILES) return { ok: false, reason: 'too-many-files' };

  if (ambiguous) return { ok: false, reason: 'ambiguous-imports' };

  let compactChars = 0;
  for (const n of included) compactChars += (index.get(n)?.content.length ?? 0);
  if (compactChars > MAX_COMPACT_SOURCE_CHARS) return { ok: false, reason: 'exceeds-char-budget' };

  // Deterministic output order: follow the active-file order.
  const includedNorms = order.filter((n) => included.has(n));
  return { ok: true, includedNorms, compactChars };
}

/** Build the active-file index (normalized safe paths only) + a deterministic path order + the
 *  full serialized-source char total. */
function buildIndex(files: WebBuildFile[]): { index: Map<string, WebBuildFile>; order: string[]; fullChars: number } {
  const index = new Map<string, WebBuildFile>();
  const order: string[] = [];
  let fullChars = 0;
  for (const f of files) {
    fullChars += (f.content?.length ?? 0);
    const norm = normalizePath(f.path);
    if (!isSafeSupportedPath(norm) || index.has(norm)) continue;
    index.set(norm, f);
    order.push(norm);
  }
  return { index, order, fullChars };
}

function diag(
  stage: 'repair' | 'post-repair',
  used: boolean,
  fullChars: number,
  compactChars: number,
  includedCount: number,
  omittedCount: number,
  extra?: { changedFileCount?: number; fallbackReason?: FrontendQualityContextFallbackReason },
): FrontendQualityContextDiagnostics {
  const ratio = fullChars > 0 ? Math.max(0, Math.min(1, 1 - compactChars / fullChars)) : 0;
  return {
    version: 'frontend-quality-context-v1',
    qualityContextMode: 'owner_compact',
    compactContextStage: stage,
    compactContextEligible: true,
    compactContextUsed: used,
    fullContextEstimatedChars: fullChars,
    compactContextChars: compactChars,
    includedSourceFileCount: includedCount,
    omittedSourceFileCount: omittedCount,
    ...(typeof extra?.changedFileCount === 'number' ? { changedFileCount: extra.changedFileCount } : {}),
    reductionRatio: Math.round(ratio * 100) / 100,
    ...(extra?.fallbackReason ? { fallbackReason: extra.fallbackReason } : {}),
  };
}

/** A `disabled`-mode diagnostic for observability when the delta repair ran but the compact
 *  context mode was off (so an owner can see the mode was consulted and not used). */
export function disabledQualityContextDiagnostics(
  stage: 'repair' | 'post-repair',
  files: WebBuildFile[],
): FrontendQualityContextDiagnostics {
  const fullChars = files.reduce((n, f) => n + (f.content?.length ?? 0), 0);
  return {
    version: 'frontend-quality-context-v1',
    qualityContextMode: 'disabled',
    compactContextStage: stage,
    compactContextEligible: false,
    compactContextUsed: false,
    fullContextEstimatedChars: fullChars,
    compactContextChars: fullChars,
    includedSourceFileCount: files.length,
    omittedSourceFileCount: 0,
    reductionRatio: 0,
    fallbackReason: 'context-mode-disabled',
  };
}

function requiredNormsFrom(spec: FrontendBuildSpecification | undefined): string[] {
  const req = spec?.outputContract?.requiredFiles;
  if (!Array.isArray(req)) return [];
  return req.map(normalizePath).filter(isSafeSupportedPath);
}

function buildContext(
  index: Map<string, WebBuildFile>,
  includedNorms: string[],
): CompactSourceContext {
  const includedSet = new Set(includedNorms);
  const includedFiles = includedNorms.map((n) => index.get(n) as WebBuildFile);
  const omittedManifest: CompactSourceContext['omittedManifest'] = [];
  for (const [norm, f] of index) {
    if (includedSet.has(norm)) continue;
    if (omittedManifest.length >= MAX_OMITTED_MANIFEST_ENTRIES) break;
    omittedManifest.push({
      path: norm.slice(0, MAX_MANIFEST_PATH_CHARS),
      language: fileLanguage(f, norm),
      charCount: f.content?.length ?? 0,
    });
  }
  return { includedFiles, omittedManifest };
}

export interface CompactContextResult {
  context?: CompactSourceContext;
  diagnostics: FrontendQualityContextDiagnostics;
}

/**
 * Select the compact source context for the owner-delta REPAIR request. Seeds come from the
 * initial review's structured file references + the deterministic quality evidence paths. Safe
 * fallback (context undefined) on any ambiguity or bound violation.
 */
export function selectCompactRepairContext(input: {
  spec: FrontendBuildSpecification | undefined;
  activeFiles: WebBuildFile[];
  initialReview: FrontendBuilderReviewArtifact;
  qualityEvidence?: CompactQualityEvidence;
}): CompactContextResult {
  const { spec, activeFiles, initialReview, qualityEvidence } = input;
  try {
    if (!spec || !Array.isArray(activeFiles) || activeFiles.length === 0) {
      return { diagnostics: diag('repair', false, 0, 0, 0, 0, { fallbackReason: 'malformed-input' }) };
    }
    const { index, order, fullChars } = buildIndex(activeFiles);
    if (index.size === 0) return { diagnostics: diag('repair', false, fullChars, fullChars, 0, 0, { fallbackReason: 'malformed-input' }) };

    // Seeds: structured issue.files + deterministic evidence paths (NEVER prose).
    const seedRaw: string[] = [];
    for (const issue of initialReview.issues || []) {
      for (const p of issue.files || []) seedRaw.push(p);
    }
    if (qualityEvidence) {
      seedRaw.push(...(qualityEvidence.shallowSectionPaths || []));
      seedRaw.push(...(qualityEvidence.repetitiveSectionPaths || []));
      seedRaw.push(...(qualityEvidence.internalCopyLeakFiles || []));
      if (qualityEvidence.heroComponentPath) seedRaw.push(qualityEvidence.heroComponentPath);
    }
    const seedNorms = [...new Set(seedRaw.map(normalizePath).filter((n) => isSafeSupportedPath(n) && index.has(n)))];
    if (seedNorms.length === 0) return { diagnostics: diag('repair', false, fullChars, fullChars, activeFiles.length, 0, { fallbackReason: 'no-targets' }) };

    const assembled = assembleClosure(index, order, seedNorms, requiredNormsFrom(spec));
    if (!assembled.ok) return { diagnostics: diag('repair', false, fullChars, fullChars, activeFiles.length, 0, { fallbackReason: assembled.reason }) };

    const omittedCount = index.size - assembled.includedNorms.length;
    if (omittedCount <= 0) return { diagnostics: diag('repair', false, fullChars, fullChars, assembled.includedNorms.length, 0, { fallbackReason: 'no-omitted-files' }) };

    const context = buildContext(index, assembled.includedNorms);
    return {
      context,
      diagnostics: diag('repair', true, fullChars, assembled.compactChars, assembled.includedNorms.length, omittedCount),
    };
  } catch {
    const fullChars = (activeFiles || []).reduce((n, f) => n + (f.content?.length ?? 0), 0);
    return { diagnostics: diag('repair', false, fullChars, fullChars, (activeFiles || []).length, 0, { fallbackReason: 'assembly-error' }) };
  }
}

/**
 * Select the compact source context for the POST-REPAIR review of a valid owner-delta
 * reconstruction. Seeds are the normalized changed/upsert paths; the closure adds their local
 * dependencies, direct importers and required root/style files. Safe fallback on any problem.
 */
export function selectCompactPostRepairContext(input: {
  spec: FrontendBuildSpecification | undefined;
  reconstructedFiles: WebBuildFile[];
  changedPaths: string[];
  initialReview: FrontendBuilderReviewArtifact;
}): CompactContextResult {
  const { spec, reconstructedFiles, changedPaths } = input;
  try {
    if (!spec || !Array.isArray(reconstructedFiles) || reconstructedFiles.length === 0) {
      return { diagnostics: diag('post-repair', false, 0, 0, 0, 0, { fallbackReason: 'malformed-input' }) };
    }
    const { index, order, fullChars } = buildIndex(reconstructedFiles);
    if (index.size === 0) return { diagnostics: diag('post-repair', false, fullChars, fullChars, 0, 0, { fallbackReason: 'malformed-input' }) };

    const changedNorms = [...new Set((changedPaths || []).map(normalizePath).filter(isSafeSupportedPath))];
    if (changedNorms.length === 0) return { diagnostics: diag('post-repair', false, fullChars, fullChars, reconstructedFiles.length, 0, { fallbackReason: 'no-changed-paths' }) };

    // Every changed path MUST exist in the reconstructed set; otherwise the changed-path data is
    // inconsistent with the project and we cannot safely compact — fall back to full context.
    const presentChanged = changedNorms.filter((n) => index.has(n));
    if (presentChanged.length !== changedNorms.length) {
      return { diagnostics: diag('post-repair', false, fullChars, fullChars, reconstructedFiles.length, 0, { changedFileCount: changedNorms.length, fallbackReason: 'insufficient-coverage' }) };
    }

    const assembled = assembleClosure(index, order, presentChanged, requiredNormsFrom(spec));
    if (!assembled.ok) return { diagnostics: diag('post-repair', false, fullChars, fullChars, reconstructedFiles.length, 0, { changedFileCount: presentChanged.length, fallbackReason: assembled.reason }) };

    const omittedCount = index.size - assembled.includedNorms.length;
    if (omittedCount <= 0) return { diagnostics: diag('post-repair', false, fullChars, fullChars, assembled.includedNorms.length, 0, { changedFileCount: presentChanged.length, fallbackReason: 'no-omitted-files' }) };

    const context = buildContext(index, assembled.includedNorms);
    return {
      context,
      diagnostics: diag('post-repair', true, fullChars, assembled.compactChars, assembled.includedNorms.length, omittedCount, { changedFileCount: presentChanged.length }),
    };
  } catch {
    const fullChars = (reconstructedFiles || []).reduce((n, f) => n + (f.content?.length ?? 0), 0);
    return { diagnostics: diag('post-repair', false, fullChars, fullChars, (reconstructedFiles || []).length, 0, { fallbackReason: 'assembly-error' }) };
  }
}

/* ── Phase 14L.2 — deterministic SIZE-BOUNDING for the design-quality review ─────────────────
 * The static design-quality review serializes the specification + the FULL source of every
 * generated file. A rich, premium multi-section project can exceed the backend structured-builder
 * safety cap (_STRUCTURED_MAX_LEN = 125_000 chars in backend/services/safety/guard.py). When it
 * does, `check_structured_builder_message` rejects the request as `safety_length`; the /chat
 * response then carries `mode="safety_length"`, which the client reads as "Backend routed the
 * review request to an unexpected mode" → the review is recorded `failed` → the acceptance
 * pipeline falls to `initial-review-incomplete` → Safe Preview ("the automatic design-quality
 * review did not complete"). This hits OWNER and normal users identically (a safety cap, not the
 * ai_guard quota) and gets WORSE the richer the project — the exact opposite of the goal.
 *
 * These pure helpers let the review transport re-pack a too-large request into the SAME bounded
 * include-set + omitted-manifest shape the reviewer prompt already understands, so a large project
 * is still reviewed (against a representative subset) instead of silently falling to Safe Preview.
 * They are pure/deterministic and independent of the compact-context MODE flags above (which only
 * cover the delta repair + post-repair review); this size floor always applies, to every user. */

/** Entry/root files the reviewer must ALWAYS see (never dropped by the size packer). */
export const REVIEW_ALWAYS_INCLUDE_PATHS = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'] as const;

/**
 * Deterministic file ordering for the size-bounded review packer. Returns the files that must be
 * force-included first — the entry/root files, the spec's declared required files, and any caller-
 * supplied priority paths (e.g. the changed files of a post-repair review) — followed by the
 * remaining files sorted by ASCENDING content size (so the packer fits as MANY files as possible),
 * tie-broken by normalized path for stability. Pure; never mutates its inputs.
 */
export function orderFilesForReviewBounding(
  spec: FrontendBuildSpecification | undefined,
  files: WebBuildFile[],
  extraPriorityPaths?: string[],
): { prioritized: WebBuildFile[]; rest: WebBuildFile[] } {
  const safe = Array.isArray(files) ? files.filter((f) => f && typeof f.content === 'string') : [];
  const alwaysOrder = REVIEW_ALWAYS_INCLUDE_PATHS.map((p) => normalizePath(p));
  const prioSet = new Set<string>([
    ...alwaysOrder,
    ...requiredNormsFrom(spec),
    ...((extraPriorityPaths || []).map(normalizePath).filter(Boolean)),
  ]);
  const prioritized: WebBuildFile[] = [];
  const rest: WebBuildFile[] = [];
  for (const f of safe) {
    (prioSet.has(normalizePath(f.path)) ? prioritized : rest).push(f);
  }
  const rank = (f: WebBuildFile): number => {
    const i = alwaysOrder.indexOf(normalizePath(f.path));
    return i < 0 ? 500 : i;
  };
  prioritized.sort((a, b) => rank(a) - rank(b) || normalizePath(a.path).localeCompare(normalizePath(b.path)));
  rest.sort((a, b) => (a.content?.length ?? 0) - (b.content?.length ?? 0) || normalizePath(a.path).localeCompare(normalizePath(b.path)));
  return { prioritized, rest };
}

/**
 * Build a compact context (included full-source files + a metadata-only manifest of the omitted
 * files) from a chosen include set. The manifest carries path/language/size ONLY — never the
 * omitted source. Pure; the returned includedFiles preserve the given order.
 */
export function compactContextFromIncludedFiles(
  allFiles: WebBuildFile[],
  included: WebBuildFile[],
): CompactSourceContext {
  const includedSet = new Set(included);
  const omittedManifest: CompactSourceContext['omittedManifest'] = [];
  for (const f of allFiles) {
    if (includedSet.has(f)) continue;
    if (omittedManifest.length >= MAX_OMITTED_MANIFEST_ENTRIES) break;
    const norm = normalizePath(f.path);
    omittedManifest.push({
      path: norm.slice(0, MAX_MANIFEST_PATH_CHARS),
      language: fileLanguage(f, norm),
      charCount: f.content?.length ?? 0,
    });
  }
  return { includedFiles: [...included], omittedManifest };
}

/* ── Phase 14L.3 — REVIEW-SCOPED specification projection ─────────────────────────────────────
 * MEASURED root cause of the post-#585 failure: a realistic premium build's SERIALIZED
 * specification is ~99k chars on its own (dominated by the optional generator authorities —
 * experienceQuality ~19k, visualSystem ~13k, composition ~12k, executionObligations ~8k,
 * contentNarrative ~7k, visualConcept ~7k, experienceIdentity ~6k, motionExecution ~5k,
 * researchDirection ~4k, …). #585 bounds only the FILES, never the spec or the always-included
 * entry files, so for a rich build the fit floor (full spec + entry files + manifest) is ALREADY
 * over the backend 125k structured-builder cap → the review request is still rejected as
 * safety_length → "the automatic design-quality review did not complete" → Safe Preview. Owner and
 * normal users hit this identically (a safety-size cap, not the ai_guard quota).
 *
 * The reviewer scores the SOURCE (it explicitly judges "what the specification + source support");
 * those optional authorities are GENERATION obligations the emitted source already embodies. So
 * when — and ONLY when — the full-spec request cannot be fit under the cap by file-bounding alone,
 * we send a review-scoped projection of the spec that keeps the design-authoritative CORE
 * (identity, design system, section architecture + public copy, asset plan, image coverage,
 * output contract, honesty rules) at full fidelity and drops the heavy optional generator
 * authorities. This is progressive (small/medium builds keep the FULL spec) and strictly better
 * than the status quo — a bounded review vs. NO review. It changes NO acceptance threshold and is
 * used ONLY for the review request (never generation). Pure; never mutates its input. */

/** Optional heavy generator-authority fields dropped from the review-scoped spec projection. Each
 *  is an OPTIONAL field on FrontendBuildSpecification (absent ⇒ a valid spec), so omitting them
 *  yields a well-typed, smaller spec. They are generation obligations embodied by the source. */
const REVIEW_SPEC_DROPPABLE_FIELDS = [
  'experienceArchitecture', 'bindingRequirements', 'researchDirection', 'composition',
  'visualSystem', 'contentNarrative', 'experienceQuality', 'visualConcept',
  'experienceIdentity', 'motionExecution', 'executionObligations',
  // Design Intelligence V3 — a FIRST-GENERATION direction authority with NO acceptance
  // surface: no analyzer scores it and no repair can regress against it, so it needs no
  // entry in the repair-authority digest below. It stays on the normal (uncompacted)
  // review/repair request so a repair keeps the same design direction, and it is dropped
  // first when a rich build needs compaction to fit the backend cap.
  'designIntelligence',
] as const;

/** Build the review-scoped projection: keep every core/required field, drop the heavy optional
 *  generator authorities, and bound the free-text trace arrays. Returns a valid, smaller
 *  FrontendBuildSpecification. Pure. */
export function buildReviewScopedSpecProjection(spec: FrontendBuildSpecification): FrontendBuildSpecification {
  const projected: Record<string, unknown> = { ...(spec as unknown as Record<string, unknown>) };
  for (const f of REVIEW_SPEC_DROPPABLE_FIELDS) delete projected[f];
  // Bound the diagnostic trace arrays (not design-authoritative; never scored).
  if (Array.isArray(projected.sourceTrace)) projected.sourceTrace = (projected.sourceTrace as string[]).slice(0, 4);
  if (Array.isArray(projected.warnings)) projected.warnings = (projected.warnings as string[]).slice(0, 4);
  if (Array.isArray(projected.missingInputs)) projected.missingInputs = (projected.missingInputs as string[]).slice(0, 4);
  return projected as unknown as FrontendBuildSpecification;
}

/* ── Repair-authority DIGEST ─────────────────────────────────────────────────────────────────────
 * The review-scoped projection above drops the 11 heavy generator-authority fields to fit the request
 * under the backend cap. But the SAME authorities are still evaluated by the deterministic acceptance
 * analyzers on the ORIGINAL full spec AFTER the repair. So a size-compacted repair could regress a
 * requirement the model never saw → a NEW post-repair blocker/major. This digest closes that gap: a
 * BOUNDED, structured extract of the hard, acceptance-CRITICAL requirements from EACH dropped authority,
 * built from the ORIGINAL full spec and attached to the repair request REGARDLESS of compaction — so
 * every rule capable of blocking post-repair acceptance is visible to the single repair either as an
 * `issuesToFix` entry (a current violation) OR here (a requirement not to regress). It is a compact
 * requirement summary, never the full authority objects — measured at a few KB, far under the cap. */
const MAX_DIGEST_LIST = 16;
const MAX_DIGEST_STR = 100;

function dObj(v: unknown): Record<string, unknown> | undefined {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? (v as Record<string, unknown>) : undefined;
}
function dArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function dStr(v: unknown): string | undefined {
  return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, MAX_DIGEST_STR) : undefined;
}
function dStrList(v: unknown, n = MAX_DIGEST_LIST): string[] | undefined {
  const out = dArr(v).map(dStr).filter((s): s is string => !!s).slice(0, n);
  return out.length ? out : undefined;
}
/** Assign `value` to `target[key]` only when it is a present, non-empty value. Keeps the digest lean. */
function dPut(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value) && value.length === 0) return;
  if (dObj(value) && Object.keys(value as Record<string, unknown>).length === 0) return;
  target[key] = value;
}

/**
 * Build the bounded repair-authority digest from the ORIGINAL full spec. Pure, total, fail-open
 * (returns undefined on any problem or when no authority carries a hard requirement). Every list is
 * length-bounded and every string length-capped, so the digest can never reintroduce the 99k spec.
 */
export function buildRepairAuthorityDigest(spec: FrontendBuildSpecification): Record<string, unknown> | undefined {
  try {
    const s = spec as unknown as Record<string, unknown>;
    const digest: Record<string, unknown> = {};

    // 1) binding — required sections / interactions / controls / dynamic outcomes.
    const bindingReqs = dArr(dObj(s.bindingRequirements)?.requirements)
      .map(dObj).filter((r): r is Record<string, unknown> => !!r && r.required === true)
      .slice(0, MAX_DIGEST_LIST)
      .map((r) => {
        const o: Record<string, unknown> = {};
        dPut(o, 'kind', dStr(r.kind)); dPut(o, 'label', dStr(r.label));
        dPut(o, 'controls', dStrList(dArr(r.controls).map((c) => dObj(c)?.label), 6));
        dPut(o, 'dynamicOutcome', dStr(r.dynamicOutcome));
        return o;
      }).filter((o) => Object.keys(o).length);
    dPut(digest, 'requiredBindings', bindingReqs.length ? bindingReqs : undefined);

    // 1b) APP-ONLY backfill — an app review/repair is served the review-scoped spec PROJECTION,
    //     which drops the full experienceQuality + visualSystem contracts. Preserve their GLOBAL
    //     accessibility / responsive / performance / contrast obligations here in bounded form so
    //     obligation parity holds after projection. Web repair still sends the full spec, so these
    //     would be duplicate there — gated to app to keep the web digest byte-for-byte unchanged.
    if (dStr(s.buildType) === 'app') {
      const eqc = dObj(s.experienceQuality);
      if (eqc) {
        const q: Record<string, unknown> = {};
        dPut(q, 'accessibility', dStrList(eqc.globalAccessibility, 10));
        dPut(q, 'responsive', dStrList(eqc.globalResponsive, 10));
        dPut(q, 'performance', dStrList(eqc.globalPerformance, 8));
        dPut(digest, 'qualityObligations', Object.keys(q).length ? q : undefined);
      }
      const vsc = dObj(s.visualSystem);
      if (vsc) {
        const v: Record<string, unknown> = {};
        dPut(v, 'contrast', dStrList(vsc.contrastObligations, 8));
        dPut(v, 'responsive', dStrList(vsc.responsiveObligations, 8));
        dPut(digest, 'visualSystemObligations', Object.keys(v).length ? v : undefined);
      }
    }

    // 2) research — required sector patterns + forbidden modules/claims + sector authority.
    const rd = dObj(s.researchDirection);
    if (rd) {
      const research: Record<string, unknown> = {};
      dPut(research, 'requiredPatterns', dStrList(rd.requiredPatterns));
      dPut(research, 'forbiddenModules', dStrList(dObj(rd.artDirection)?.forbiddenModules));
      dPut(research, 'forbiddenClaims', dStrList(rd.forbiddenClaims));
      dPut(research, 'sector', dStr(rd.sector));
      dPut(digest, 'research', research);
    }

    // 3) composition — per-section assigned family (anti template-collapse).
    const comp = dArr(dObj(s.composition)?.sections).map(dObj)
      .map((x) => ({ id: dStr(x?.id), family: dStr(x?.family) }))
      .filter((x) => x.id).slice(0, MAX_DIGEST_LIST);
    dPut(digest, 'sectionComposition', comp.length ? comp : undefined);

    // 4) visual system — per-section composition family map.
    const vsFam = dObj(dObj(s.visualSystem)?.sectionFamilies);
    if (vsFam) {
      const fams = Object.entries(vsFam).slice(0, MAX_DIGEST_LIST)
        .map(([k, v]) => ({ section: dStr(k), family: dStr(v) })).filter((e) => e.section);
      dPut(digest, 'visualSectionFamilies', fams.length ? fams : undefined);
    }

    // 5) content narrative — required section ids + CTA role + internal-leak prohibitions.
    const cn = dObj(s.contentNarrative);
    if (cn) {
      const content: Record<string, unknown> = {};
      dPut(content, 'requiredSectionIds', dStrList(dArr(cn.sections).map((x) => dObj(x)?.id)));
      dPut(content, 'primaryCtaRole', dStr(cn.primaryCtaRole));
      dPut(content, 'voiceProhibitions', dStrList(cn.voiceProhibitions));
      dPut(digest, 'content', content);
    }

    // 6) experience quality — required interactive sections (control+state+outcome).
    const inter = dArr(dObj(s.experienceQuality)?.sections).map(dObj)
      .filter((x): x is Record<string, unknown> => !!x && dObj(x.interaction)?.required === true)
      .slice(0, 10)
      .map((x) => {
        const it = dObj(x.interaction) || {};
        const o: Record<string, unknown> = {};
        dPut(o, 'id', dStr(x.id)); dPut(o, 'kind', dStr(it.kind)); dPut(o, 'requiredOutcome', dStr(it.requiredOutcome));
        return o;
      }).filter((o) => Object.keys(o).length);
    dPut(digest, 'requiredInteractions', inter.length ? inter : undefined);

    // 7) visual concept — required image roles + signature visual + animated-visual floor + hero anchor.
    const vc = dObj(s.visualConcept);
    if (vc) {
      const visual: Record<string, unknown> = {};
      dPut(visual, 'requiredImageRoles', dStrList(dArr(vc.imageRoles).filter((r) => dObj(r)?.required === true).map((r) => dObj(r)?.role), 10));
      const sig = dObj(vc.signature);
      if (sig) { const o: Record<string, unknown> = {}; dPut(o, 'family', dStr(sig.family)); dPut(o, 'medium', dStr(sig.medium)); if (typeof sig.animated === 'boolean') o.animated = sig.animated; dPut(visual, 'signature', o); }
      if (typeof vc.requiredAnimatedVisualCount === 'number') visual.requiredAnimatedVisualCount = vc.requiredAnimatedVisualCount;
      dPut(visual, 'peakSectionId', dStr(dObj(vc.rhythm)?.peakSectionId));
      dPut(digest, 'visual', visual);
    }

    // 8) experience identity — regulated-stakes disclaimer floor.
    const trust = dObj(dObj(s.experienceIdentity)?.trust);
    if (trust && dStr(trust.stakes) === 'regulated') {
      dPut(digest, 'regulatedDisclaimers', dStrList(trust.disclaimersRequired, 8));
    }

    // 9) motion execution — required signature scene.
    const me = dObj(s.motionExecution);
    if (me && me.signatureSceneRequired === true) {
      const motion: Record<string, unknown> = { signatureSceneRequired: true };
      dPut(motion, 'signatureSceneLocation', dStr(me.signatureSceneLocation));
      dPut(motion, 'techniqueFamily', dStr(me.techniqueFamily));
      dPut(motion, 'implementationMedium', dStr(me.implementationMedium));
      dPut(digest, 'motion', motion);
    }

    // 10) execution obligations — the REQUIRED (regression-gated) obligations.
    const required = dArr(dObj(s.executionObligations)?.obligations).map(dObj)
      .filter((o): o is Record<string, unknown> => !!o && o.priority === 'required')
      .slice(0, MAX_DIGEST_LIST)
      .map((o) => { const r: Record<string, unknown> = {}; dPut(r, 'type', dStr(o.type)); dPut(r, 'requirement', dStr(o.requirement)); dPut(r, 'targetScope', dStr(o.targetScope)); return r; })
      .filter((r) => Object.keys(r).length);
    dPut(digest, 'requiredObligations', required.length ? required : undefined);

    // 12) EXPERIENCE INTELLIGENCE — the selected experience direction a repair must not destroy.
    //     The full contract is deliberately stripped from every quality request (see
    //     `specForQualityTask`), so this bounded entry is the ONLY thing that carries the media
    //     verdict, the composition/density decision, the never-remove list and the binding
    //     optimization priority order into the single repair. Without it a repair asked to
    //     "make it faster" could legitimately delete the required lead image or the primary CTA.
    const xi = dObj(s.experienceIntelligence);
    if (xi) {
      const xExp = dObj(xi.experience);
      const xMedia = dObj(xi.media);
      const xOpt = dObj(xi.optimization);
      const dir: Record<string, unknown> = {};
      dPut(dir, 'lead', dStr(xExp?.lead));
      dPut(dir, 'density', dStr(xExp?.density));
      dPut(dir, 'hierarchy', dStr(xExp?.hierarchy));
      dPut(dir, 'composition', dStr(xExp?.composition));
      if (typeof xExp?.cardsAppropriate === 'boolean') dir.cardsAppropriate = xExp.cardsAppropriate;
      if (typeof xExp?.chartsJustified === 'boolean') dir.chartsJustified = xExp.chartsJustified;
      dPut(dir, 'mediaNecessity', dStr(xMedia?.necessity));
      dPut(dir, 'leadVisual', dStr(xMedia?.leadVisual));
      dPut(dir, 'primaryMedium', dStr(xMedia?.primaryKind));
      dPut(dir, 'forbiddenMedia', dStrList(xMedia?.forbiddenKinds, 5));
      dPut(dir, 'neverRemove', dStrList(xOpt?.protectedElements, 7));
      dPut(dir, 'optimizationPriority', 'experience correctness > visual quality > usability/accessibility > performance > cleanliness');
      dPut(digest, 'experienceDirection', dir);
    }

    // 11) experience architecture — hard section-architecture / medium / proof contract.
    const ea = dObj(s.experienceArchitecture);
    if (ea) {
      const arch: Record<string, unknown> = {};
      if (typeof ea.landingRequired === 'boolean') arch.landingRequired = ea.landingRequired;
      dPut(arch, 'entryPattern', dStr(ea.entryPattern));
      dPut(arch, 'heroContentPriority', dStr(ea.heroContentPriority));
      dPut(arch, 'heroPattern', dStr(ea.heroPattern));
      dPut(arch, 'primaryVisualMedium', dStr(ea.primaryVisualMedium));
      dPut(arch, 'sectionSequence', dStrList(ea.sectionSequence, 30));
      dPut(arch, 'forbiddenPatterns', dStrList(ea.forbiddenPatterns));
      dPut(digest, 'experienceArchitecture', arch);
    }

    return Object.keys(digest).length ? digest : undefined;
  } catch {
    return undefined;
  }
}
