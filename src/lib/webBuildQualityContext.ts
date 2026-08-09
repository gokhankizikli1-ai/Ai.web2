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
