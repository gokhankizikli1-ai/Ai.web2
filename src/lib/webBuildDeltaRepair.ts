/**
 * Web Build OWNER-ONLY DELTA quality-repair — dedicated delta parser / validator / merger.
 *
 * The shared quality pipeline (webBuildFrontendQuality.ts) runs at most ONE bounded
 * quality-repair. In the default `disabled` mode that repair re-emits the COMPLETE
 * multi-file project. In `owner_delta` mode — enabled ONLY when the mode flag is on AND
 * the caller passes a TRUSTED owner-session signal — the repair model instead returns a
 * bounded set of file UPSERTS (complete replacement contents for the few files that must
 * change, plus any genuinely new files). Korvix then reconstructs the COMPLETE project
 * DETERMINISTICALLY by merging those upserts into the ORIGINAL validated files and hands
 * the reconstructed project to the UNCHANGED full-project validator + acceptance gates.
 *
 * This module owns ONLY the pure, deterministic delta stage:
 *   - resolve the mode flag,
 *   - parse + strictly validate the delta response (a DEDICATED parser — it never touches
 *     and can never be confused with the complete-project frontend-files-v1 parser). Extraction
 *     is TOLERANT of harmless model wrappers (a leading BOM, CRLF, surrounding prose, a wrapping or
 *     inner ```json fence, and heading-level/spacing/case variations of the FRONTEND_DELTA_V1
 *     markers) so a valid delta returned in such a wrapper is recovered instead of dropped to Safe
 *     Preview — but STRICT about substance: only a COMPLETE, brace-balanced JSON object is accepted
 *     (a truncated/unbalanced body is rejected as truncated, never inferred), and JSON.parse plus the
 *     full schema/path/structural checks below remain the authority,
 *   - normalize + safety-check every upsert path,
 *   - merge upserts into the original files (Phase 1: replace + add only, NEVER delete),
 *   - serialize the reconstructed project back into a frontend-files-v1 envelope so the
 *     EXISTING validator runs on it unchanged,
 *   - build the bounded, sanitized delta diagnostics artifact.
 *
 * It performs NO network / model / provider call. A malformed or unsafe delta is rejected
 * and the caller fails OPEN to the original validated project — it NEVER triggers a second
 * repair call. No file content, prompt, provider response, id, secret or PII is ever
 * returned in diagnostics.
 */
import type {
  FrontendBuilderRawArtifact, FrontendDeltaRepairArtifact, FrontendDeltaRejectionCategory,
  FrontendGeneratedFile, FrontendGeneratedFileLanguage,
} from '@/lib/webBuildAgents';
// The SAME Phase 12C structural rules, exposed as a bounded guard over just the changed/added
// files. Reusing the validator's own predicate means this early rejection can never be stricter
// than — or diverge from — the full re-validation that remains the final authority downstream.
import { findDeltaIntroducedStructuralIssues } from '@/lib/webBuildFrontendValidation';

/* ── Mode flag (Vite convention, mirrors the other VITE_* readers) ─────────────
 * VITE_WEB_BUILD_QUALITY_REPAIR_MODE = disabled | owner_delta | all_delta
 *   disabled    — full-project re-emit repair for everyone (default, fail-closed).
 *   owner_delta — bounded delta repair for a verified owner session only (legacy).
 *   all_delta   — the SAME bounded delta repair for EVERY entitled build user
 *                 (parity: a normal beta/paid user gets the same quality-recovery
 *                 the owner gets — never a worse full re-emit that can regress
 *                 untouched sections into a Safe-Preview rejection).
 * Missing / empty / any unrecognized value resolves to `disabled`. */
export type WebBuildQualityRepairMode = 'disabled' | 'owner_delta' | 'all_delta';

export function resolveWebBuildQualityRepairMode(): WebBuildQualityRepairMode {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_WEB_BUILD_QUALITY_REPAIR_MODE;
    const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    return v === 'owner_delta' ? 'owner_delta' : v === 'all_delta' ? 'all_delta' : 'disabled';
  } catch {
    return 'disabled';
  }
}

/**
 * Whether the bounded DELTA repair (vs the full-project re-emit) runs for this build.
 * `owner_delta` → owners only (backend-confirmed owner session); `all_delta` → every
 * entitled build user (the pipeline is only reached after server-side entitlement/quota
 * preflight, and delta adds NO extra provider call — it is the same single repair, just
 * shaped as bounded upserts). Pure + deterministic so it is unit-testable and the delta
 * eligibility can never diverge between owner and normal users under `all_delta`.
 */
export function isDeltaRepairEligible(mode: WebBuildQualityRepairMode, ownerEligible: boolean): boolean {
  if (mode === 'all_delta') return true;
  if (mode === 'owner_delta') return ownerEligible === true;
  return false;
}

/* ── Bounds (aligned with the unchanged full-project validator so a reconstructed
 * project can never exceed what that validator accepts; the validator remains the
 * final authority — these are early, cheap, self-documenting rejections). ─────── */
const MAX_DELTA_UPSERTS = 40;             // ≤ the validator's MAX_GENERATED_FILES (80)
const MAX_DELTA_SINGLE_FILE_CHARS = 80_000; // = the validator's MAX_SINGLE_FILE_CHARS
const MAX_DELTA_TOTAL_UPSERT_CHARS = 180_000; // = the validator's MAX_TOTAL_PARSED_CHARS
const MAX_REJECTION_REASON_CHARS = 240;

const ENVELOPE_OPEN = '## FRONTEND_FILES_V1';
const ENVELOPE_CLOSE = '## END_FRONTEND_FILES_V1';

/* ── Tolerant marker locators. The prompt asks for EXACTLY `## FRONTEND_DELTA_V1` /
 * `## END_FRONTEND_DELTA_V1`, but a model legitimately drifts on the DECORATION (heading level
 * `#`..`######`, `**bold**`, surrounding spaces, or letter case) while keeping the reserved token.
 * These anchored regexes recover the markers across that harmless variation WITHOUT matching the
 * token mid-word: the open locator is anchored to line start + an optional heading/bold prefix, so
 * the `FRONTEND_DELTA_V1` inside `END_FRONTEND_DELTA_V1` (preceded by `END_`, not a line boundary)
 * can never be mistaken for the open marker. Case-insensitive; the JSON body itself is still parsed
 * verbatim and strictly validated. */
const DELTA_OPEN_RE = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?\*{0,2}FRONTEND_DELTA_V1\*{0,2}[ \t]*(?=\n|$)/i;
const DELTA_CLOSE_RE = /(?:^|\n)[ \t]*(?:#{1,6}[ \t]*)?\*{0,2}END_FRONTEND_DELTA_V1\*{0,2}[ \t]*(?=\n|$)/i;

/** Outcome of locating the delta JSON body inside a raw model response. Discriminated so the parser
 *  can emit a PRECISE, bounded rejection category instead of collapsing every wrapper failure into a
 *  single "not found" reason. `json` is a COMPLETE brace-balanced object (never a truncated fragment). */
type DeltaExtract =
  | { kind: 'json'; json: string }
  | { kind: 'empty' }          // delta markers present, but the body between them is empty
  | { kind: 'truncated' }      // a JSON object opened but never closed → truncated / unbalanced
  | { kind: 'wrong-contract' } // a full frontend-files-v1 envelope was returned instead of a delta
  | { kind: 'absent' };        // no delta upsert body could be located at all

/** Strip a SINGLE code fence that wraps the WHOLE text (```lang … ```), tolerant of a language tag
 *  and trailing whitespace. Only strips a fully-wrapping fence — never a partial fence among prose
 *  (the balanced-object scanner below already sees through backticks, so a non-wrapping fence needs
 *  no stripping). Idempotent and bounded. */
function stripWrappingFence(text: string): string {
  const m = /^```[a-zA-Z0-9]*[ \t]*\n([\s\S]*?)\n?```[ \t]*$/.exec(text.trim());
  return m ? m[1] : text;
}

/** Scan `text` from `from` for the FIRST complete, brace-balanced top-level JSON object. String
 *  literals (and their `\` escapes) are respected so a `{`/`}` inside a JSON string (JSX/CSS content)
 *  never miscounts the depth. Returns the exact substring of that object, or a discriminated miss:
 *   - 'none'      : no `{` at/after `from` (no object to recover),
 *   - 'truncated' : a `{` opened but the object never balanced (truncated body or unterminated string).
 *  This RECOVERS a valid delta from a harmless wrapper (prose/fence) while still REJECTING a genuinely
 *  truncated response — it never fabricates a closing brace. */
function scanBalancedJsonObject(text: string, from = 0): { ok: true; json: string } | { ok: false; reason: 'none' | 'truncated' } {
  const start = text.indexOf('{', from);
  if (start === -1) return { ok: false, reason: 'none' };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { ok: true, json: text.slice(start, i + 1) };
    }
  }
  // Reached end of input with an unclosed object (or an unterminated string) → truncated/unbalanced.
  return { ok: false, reason: 'truncated' };
}

/** Recover the delta object from text with LEADING PROSE and no markers (e.g. "Here are the
 *  upserts:\n{…}"). Scans left-to-right for the first COMPLETE brace-balanced object that parses to
 *  an object exposing an `upserts` array, skipping balanced-but-non-delta objects (an incidental
 *  `{n}` in prose). Reports `truncated` only when a candidate object is genuinely cut off, and
 *  `none` when no delta object is present. Bounded: each `{` is scanned at most once. This never
 *  fabricates content — a recovered object is still JSON.parsed and fully validated downstream. */
function recoverDeltaJsonObject(text: string): { ok: true; json: string } | { ok: false; reason: 'none' | 'truncated' } {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf('{', from);
    if (at === -1) return { ok: false, reason: 'none' };
    const scan = scanBalancedJsonObject(text, at);
    if (!scan.ok) return { ok: false, reason: scan.reason }; // an unclosed object from here → truncated tail
    try {
      const obj = JSON.parse(scan.json) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && Array.isArray((obj as { upserts?: unknown }).upserts)) {
        return { ok: true, json: scan.json };
      }
    } catch { /* not valid JSON at this brace — keep scanning past it */ }
    from = at + scan.json.length; // continue AFTER this balanced (non-delta) object
  }
  return { ok: false, reason: 'none' };
}

const EXT_LANGUAGE: Record<string, FrontendGeneratedFileLanguage> = {
  '.tsx': 'tsx',
  '.ts': 'ts',
  '.css': 'css',
};

/** A code-fence line or a reserved envelope/delta marker line in file CONTENT would corrupt
 *  the lossless round-trip through the frontend-files-v1 envelope the validator re-parses. Any
 *  upsert whose content carries one is rejected (defence in depth — the validator would also
 *  reject the malformed envelope, but a clean early rejection is safer and cheaper). */
const FENCE_LINE_RE = /^[ \t]*```/m;
const RESERVED_MARKER_LINE_RE = /^[ \t]*(?:##[ \t]+(?:END_)?FRONTEND_(?:FILES|DELTA)_V1\b|###[ \t]+(?:FILE\b|END_FILE\b))/m;

export interface DeltaUpsert {
  path: string;
  language: FrontendGeneratedFileLanguage;
  content: string;
}

interface DeltaParseOk {
  ok: true;
  upserts: DeltaUpsert[];
  deltaCharCount: number;
}
interface DeltaParseErr {
  ok: false;
  reason: string;
  category: FrontendDeltaRejectionCategory;
  upsertCount: number;
  deltaCharCount: number;
}
export type DeltaParseResult = DeltaParseOk | DeltaParseErr;

function cap(reason: string): string {
  return reason.length > MAX_REJECTION_REASON_CHARS ? reason.slice(0, MAX_REJECTION_REASON_CHARS) : reason;
}

/**
 * Locate the delta JSON body inside a raw model response. TOLERANT of the harmless wrappers a
 * model legitimately produces around a valid delta, STRICT about substance.
 *
 * Recovered wrappers: a leading BOM, CRLF newlines, surrounding whitespace/prose, a wrapping or
 * inner ```json fence, and heading-level / spacing / bold / letter-case variations of the
 * FRONTEND_DELTA_V1 markers. In every case the returned `json` is a COMPLETE, brace-balanced
 * object — extraction NEVER fabricates a closing brace, so a truncated body is reported as
 * `truncated` (rejected downstream) rather than silently repaired.
 *
 * Returns a discriminated `DeltaExtract` so the caller can attach a precise rejection category.
 */
function extractDeltaJson(rawResponse: string): DeltaExtract {
  const text = (rawResponse || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return { kind: 'absent' };

  // ── Preferred path: the FRONTEND_DELTA_V1 markers are present (in any harmless decoration). ──
  const openM = DELTA_OPEN_RE.exec(text);
  if (openM) {
    const afterOpen = text.slice(openM.index + openM[0].length);
    const closeM = DELTA_CLOSE_RE.exec(afterOpen);
    const region = (closeM ? afterOpen.slice(0, closeM.index) : afterOpen);
    const body = stripWrappingFence(region.trim()).trim();
    if (!body) return { kind: 'empty' };
    // Recover a complete JSON object even if the body is fenced or has stray prose around it.
    const scan = scanBalancedJsonObject(body, 0);
    if (scan.ok) return { kind: 'json', json: scan.json };
    if (scan.reason === 'truncated') return { kind: 'truncated' };
    // Markers present, non-empty, but no JSON object at all: a missing close marker suggests the
    // body was cut off (truncated); a present close marker means the contract shape is absent.
    return closeM ? { kind: 'absent' } : { kind: 'truncated' };
  }

  // ── No delta markers. A full complete-project envelope is the WRONG contract (precise, distinct
  //    from "absent"): the model re-emitted everything instead of a bounded upsert delta. The
  //    dedicated delta module must NOT consume a complete-project envelope, so this is a clean
  //    rejection with an honest reason — not a silent second parser. ──
  if (text.includes(ENVELOPE_OPEN)) return { kind: 'wrong-contract' };

  // ── Bare / fenced / prose-surrounded JSON with no markers. Strip a fully-wrapping fence first. ──
  const unfenced = stripWrappingFence(text).trim();
  if (unfenced.startsWith('{')) {
    // Bare (or fenced) JSON object — take it verbatim as the contract body; JSON.parse + schema
    // checks below are the authority (a balanced-but-invalid object → `malformed-json`, not silently
    // recovered), and a cut-off object → `truncated`.
    const scan = scanBalancedJsonObject(unfenced, 0);
    if (scan.ok) return { kind: 'json', json: scan.json };
    return { kind: 'truncated' };
  }
  // Leading prose before the object (e.g. "Here are the upserts:\n{…}"). Recover the first balanced
  // object that actually looks like a delta, skipping incidental braces in the prose. This rescues
  // the shape the old strict `startsWith('{')` check dropped, while still rejecting a truncated body.
  const recovered = recoverDeltaJsonObject(unfenced);
  if (recovered.ok) return { kind: 'json', json: recovered.json };
  if (recovered.reason === 'truncated') return { kind: 'truncated' };
  return { kind: 'absent' };
}

/** Normalize + safety-check a single upsert relative path. Rejects absolute, traversal,
 *  backslash, empty-segment and unsupported-extension paths. Returns the normalized path
 *  and its derived language, or a bounded rejection reason. */
function normalizeDeltaPath(rawPath: unknown): { ok: true; path: string; language: FrontendGeneratedFileLanguage } | { ok: false; reason: string } {
  const s = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!s) return { ok: false, reason: 'empty upsert path' };
  if (s.includes('\\')) return { ok: false, reason: `unsafe path (backslash): ${s.slice(0, 80)}` };
  if (s.includes('\0')) return { ok: false, reason: 'unsafe path (null byte)' };
  if (s.startsWith('/') || /^[A-Za-z]:/.test(s)) return { ok: false, reason: `absolute path not allowed: ${s.slice(0, 80)}` };
  // Strip leading ./ segments, collapse duplicate slashes.
  const cleaned = s.replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/');
  const segments = cleaned.split('/');
  if (segments.some((seg) => seg === '..' )) return { ok: false, reason: `path traversal not allowed: ${s.slice(0, 80)}` };
  if (segments.some((seg) => seg === '' || seg === '.')) return { ok: false, reason: `unsafe path segment: ${s.slice(0, 80)}` };
  const lower = cleaned.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf('.'));
  const language = EXT_LANGUAGE[ext];
  if (!language) return { ok: false, reason: `unsupported file type (only .tsx/.ts/.css): ${cleaned.slice(0, 80)}` };
  return { ok: true, path: cleaned, language };
}

/**
 * DEDICATED delta parser + validator. Strict: any malformed / empty / duplicate /
 * unsafe / oversize condition is a rejection (never a silent pass, never a partial merge).
 * This is intentionally NOT the complete-project envelope parser — a complete-project
 * envelope cannot satisfy it (no `upserts` array) and vice-versa.
 */
export function parseFrontendDeltaResponse(rawResponse: string | undefined): DeltaParseResult {
  const deltaCharCount = typeof rawResponse === 'string' ? rawResponse.length : 0;
  const fail = (reason: string, category: FrontendDeltaRejectionCategory, upsertCount = 0): DeltaParseErr =>
    ({ ok: false, reason: cap(reason), category, upsertCount, deltaCharCount });
  try {
    if (!rawResponse || !rawResponse.trim()) return fail('empty delta response', 'no-response-body');
    if (deltaCharCount > MAX_DELTA_TOTAL_UPSERT_CHARS * 2) return fail('delta response exceeds the safe size limit', 'oversize');

    // ── Bounded, wrapper-tolerant extraction. Each miss maps to a PRECISE category so a persisted
    //    diagnostic distinguishes a truncated body / wrong contract / genuinely-absent contract
    //    rather than collapsing all three into one opaque "not found" reason. ──
    const extracted = extractDeltaJson(rawResponse);
    switch (extracted.kind) {
      case 'truncated':
        return fail('malformed delta response: the FRONTEND_DELTA_V1 JSON body is truncated or unbalanced (no complete JSON object)', 'truncated-json');
      case 'wrong-contract':
        return fail('malformed delta response: a full frontend-files-v1 project envelope was returned instead of a FRONTEND_DELTA_V1 upsert body', 'wrong-contract');
      case 'empty':
        return fail('malformed delta response: FRONTEND_DELTA_V1 markers present but the JSON body is empty', 'contract-absent');
      case 'absent':
        return fail('malformed delta response: no FRONTEND_DELTA_V1 JSON body found', 'contract-absent');
      case 'json':
        break;
    }
    const jsonText = extracted.json;

    let parsed: unknown;
    try { parsed = JSON.parse(jsonText); } catch { return fail('malformed delta response: body is not valid JSON', 'malformed-json'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('malformed delta response: root is not a JSON object', 'invalid-schema');
    const upsertsRaw = (parsed as { upserts?: unknown }).upserts;
    if (!Array.isArray(upsertsRaw)) return fail('malformed delta response: missing "upserts" array', 'invalid-schema');
    if (upsertsRaw.length === 0) return fail('empty upsert list', 'invalid-schema');
    if (upsertsRaw.length > MAX_DELTA_UPSERTS) return fail(`too many upserts (${upsertsRaw.length} > ${MAX_DELTA_UPSERTS})`, 'oversize');

    const seen = new Set<string>();
    const upserts: DeltaUpsert[] = [];
    let totalChars = 0;
    for (let i = 0; i < upsertsRaw.length; i += 1) {
      const entry = upsertsRaw[i];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail(`upsert #${i + 1} is not an object`, 'invalid-schema');
      const norm = normalizeDeltaPath((entry as { path?: unknown }).path);
      if (!norm.ok) return fail(norm.reason, 'unsafe-path');
      if (seen.has(norm.path)) return fail(`duplicate upsert path after normalization: ${norm.path}`, 'invalid-schema');
      seen.add(norm.path);

      const content = (entry as { content?: unknown }).content;
      if (typeof content !== 'string' || content.trim() === '') return fail(`empty file content for ${norm.path}`, 'invalid-schema');
      if (content.length > MAX_DELTA_SINGLE_FILE_CHARS) return fail(`file ${norm.path} exceeds ${MAX_DELTA_SINGLE_FILE_CHARS} characters`, 'oversize');
      if (FENCE_LINE_RE.test(content) || RESERVED_MARKER_LINE_RE.test(content)) {
        return fail(`unsafe content (reserved envelope/fence line) in ${norm.path}`, 'invalid-schema');
      }
      // A provided language, when present, must not contradict the path extension.
      const declared = (entry as { language?: unknown }).language;
      if (typeof declared === 'string' && declared.trim() && declared.trim().toLowerCase() !== norm.language) {
        return fail(`declared language "${declared}" conflicts with the extension of ${norm.path}`, 'invalid-schema');
      }

      totalChars += content.length;
      if (totalChars > MAX_DELTA_TOTAL_UPSERT_CHARS) return fail(`total upsert content exceeds ${MAX_DELTA_TOTAL_UPSERT_CHARS} characters`, 'oversize');
      upserts.push({ path: norm.path, language: norm.language, content });
    }
    return { ok: true, upserts, deltaCharCount };
  } catch {
    return fail('internal delta-parse error', 'malformed-json');
  }
}

/** Normalize an ORIGINAL file path the same way (leading ./, duplicate slashes) so a
 *  replacement upsert deterministically overwrites the file it targets even if the two
 *  paths differ only by a leading `./`. Never rejects — originals were already validated. */
function normalizeExistingPath(p: string): string {
  return (p || '').replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/');
}

/** The CANONICAL match key for reconciling an upsert path with an existing file path. Beyond the
 *  `./` + `//` normalization it is CASE-INSENSITIVE, because the downstream validator treats two
 *  paths that differ only by case as a hard `duplicate-path-ci` error. Matching case-insensitively
 *  means a case-variant upsert (e.g. `src/components/Hero.tsx` vs the original `.../hero.tsx`)
 *  REPLACES the intended file — keeping the original's exact path — instead of being ADDED as a
 *  stray duplicate that both fails validation AND leaves the intended edit unapplied. The original
 *  set was already validated, so it can never contain two files sharing a canonical key. */
function canonicalDeltaKey(p: string): string {
  return normalizeExistingPath(p).toLowerCase();
}

/** Deterministically merge upserts into the original validated files. REPLACE an existing file
 *  (matched by CANONICAL key — `./`/`//`-normalized + case-insensitive) or ADD a new one — never
 *  delete. A replacement KEEPS the original file's EXACT path (so retained/replaced files never
 *  appear renamed, and a case-variant upsert never introduces a case-duplicate); only a genuinely
 *  new file uses the upsert's normalized path. Original ordering is preserved; new files are
 *  appended in upsert order. */
export function reconstructProjectFiles(
  originalFiles: FrontendGeneratedFile[],
  upserts: DeltaUpsert[],
): DeltaUpsert[] {
  const byKey = new Map<string, DeltaUpsert>();  // canonical key → file (with its EXACT path)
  const order: string[] = [];
  for (const f of originalFiles) {
    const key = canonicalDeltaKey(f.path);
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, { path: f.path, language: f.language, content: f.content });
  }
  for (const u of upserts) {
    const key = canonicalDeltaKey(u.path);
    const existing = byKey.get(key);
    if (existing) {
      // Replace content/language; preserve the original file's exact path.
      byKey.set(key, { path: existing.path, language: u.language, content: u.content });
    } else {
      order.push(key);
      byKey.set(key, { path: u.path, language: u.language, content: u.content });
    }
  }
  return order.map((k) => byKey.get(k) as DeltaUpsert);
}

/** Serialize a complete file set into a frontend-files-v1 envelope the UNCHANGED validator
 *  re-parses. Each file becomes one `### FILE … ``` … ``` … ### END_FILE` block. Content is
 *  emitted verbatim (a single trailing newline is normalized so the closing fence is always
 *  its own line); original files — which never carry a trailing newline — round-trip exactly. */
export function serializeFrontendFilesEnvelope(files: DeltaUpsert[]): string {
  const blocks = files.map((f) => {
    const body = `${f.content.replace(/\n+$/, '')}\n`;
    return `### FILE ${f.path}\n\`\`\`${f.language}\n${body}\`\`\`\n### END_FILE`;
  });
  return [ENVELOPE_OPEN, ...blocks, ENVELOPE_CLOSE].join('\n');
}

function charCount(files: Array<{ content: string }>): number {
  return files.reduce((n, f) => n + f.content.length, 0);
}

function roundRatio(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

/** Mirror the bounded, safe background LIFECYCLE telemetry from a failed delta raw into the delta
 *  diagnostics so a background timeout is diagnosable from a SAVED build (resolved client budget,
 *  advertised job retention, elapsed, poll count, transient failures, the final-poll result and the
 *  transport error kind). Returns `{}` when no lifecycle telemetry is present (e.g. a synchronous
 *  failure or an old saved build). Never a job id, raw response id, prompt or source. */
function backgroundLifecycleDiag(deltaRaw: FrontendBuilderRawArtifact): Pick<FrontendDeltaRepairArtifact, 'backgroundLifecycle'> {
  const lc = {
    finalPollResult: deltaRaw.backgroundFinalPollResult,
    workflowBudgetMs: deltaRaw.backgroundWorkflowBudgetMs,
    expiresInMs: deltaRaw.backgroundExpiresInMs,
    elapsedMs: deltaRaw.backgroundWaitMs,
    pollCount: deltaRaw.backgroundPollCount,
    transientPollFailures: deltaRaw.backgroundTransientPollFailures,
    cancelRequested: deltaRaw.backgroundCancelRequested,
    errorKind: deltaRaw.backendErrorKind,
  };
  // Only attach when at least one lifecycle signal is present (keeps old/sync failures clean).
  const hasAny = Object.values(lc).some((v) => v !== undefined);
  return hasAny ? { backgroundLifecycle: lc } : {};
}

export interface DeltaReconstruction {
  /** A synthetic raw artifact the caller feeds to the UNCHANGED full-project validator:
   *  a `completed` frontend-files-v1 envelope on success, or a `failed` artifact (carrying a
   *  bounded, honest reason + the delta call's real model/provider/requestId) on rejection so
   *  the pipeline's existing fail-open branch preserves the original project — with NO second
   *  repair call. */
  repairRaw: FrontendBuilderRawArtifact;
  /** Bounded, sanitized diagnostics for the acceptance/repair artifact. */
  diagnostics: FrontendDeltaRepairArtifact;
  /** The NORMALIZED upsert paths (changed/added files) from a VALID reconstruction — INTERNAL
   *  pipeline data used to build the compact post-repair review context. Absent when the delta
   *  was rejected. These are safe, deduped, project-relative paths (never raw provider output). */
  changedPaths?: string[];
}

/** Copy ONLY the truthful, bounded transport/telemetry fields from the delta call onto the
 *  synthetic raw (so the repair artifact's model/provider/requestId + cost stage attribution
 *  stay real). Never copies rawResponse. */
function carryTelemetry(deltaRaw: FrontendBuilderRawArtifact): Partial<FrontendBuilderRawArtifact> {
  return {
    model: deltaRaw.model,
    provider: deltaRaw.provider,
    requestId: deltaRaw.requestId,
    executionStatus: deltaRaw.executionStatus,
    executionEndpoint: deltaRaw.executionEndpoint,
    fallbackUsed: deltaRaw.fallbackUsed,
    backendLatencyMs: deltaRaw.backendLatencyMs,
    backgroundMode: deltaRaw.backgroundMode,
    backgroundTaskKind: deltaRaw.backgroundTaskKind,
    backgroundPollCount: deltaRaw.backgroundPollCount,
    backgroundWaitMs: deltaRaw.backgroundWaitMs,
    backgroundTerminalStatus: deltaRaw.backgroundTerminalStatus,
  };
}

function failedRaw(deltaRaw: FrontendBuilderRawArtifact, reason: string): FrontendBuilderRawArtifact {
  return {
    version: 'frontend-builder-raw-v1',
    status: 'failed',
    requestedFormat: 'frontend-files-v1',
    mode: 'frontend_builder',
    responseCharCount: 0,
    truncatedForStorage: false,
    validationStatus: 'not-run',
    reason: cap(reason),
    warnings: [],
    ...carryTelemetry(deltaRaw),
  };
}

/**
 * Turn the raw delta response into either a reconstructed complete-project raw (to be
 * validated by the UNCHANGED validator) or a failed raw (fail-open, no second call), plus
 * the sanitized diagnostics. Pure + deterministic.
 */
export function reconstructRepairRawFromDelta(input: {
  deltaRaw: FrontendBuilderRawArtifact;
  originalFiles: FrontendGeneratedFile[];
}): DeltaReconstruction {
  const { deltaRaw, originalFiles } = input;
  const originalProjectCharCount = charCount(originalFiles);
  const baseDiagnostics: FrontendDeltaRepairArtifact = {
    version: 'frontend-delta-repair-v1',
    requestedRepairFormat: 'owner-delta-upserts',
    returnedUpsertCount: 0,
    deltaCharCount: typeof deltaRaw.rawResponse === 'string' ? deltaRaw.rawResponse.length : (deltaRaw.responseCharCount || 0),
    originalProjectCharCount,
    reconstructedProjectCharCount: 0,
    outputReductionRatio: 0,
    accepted: false,
    // Producer-contract observability: this path IS the bounded quality repair and always requests
    // the delta contract. `actualResponseShape` below records what the model actually returned so a
    // producer-side contract conflict (full envelope emitted instead of a delta) is visible.
    taskKind: 'quality-repair',
    expectedContract: 'frontend-delta-v1',
  };

  // The delta model call itself did not complete (transport/mode/size failure) — fail open. The
  // real cause already lives in the transport `reason` (empty body, unexpected backend mode,
  // structured safety rejection, oversize/storage-truncation); classify it into a bounded category
  // for the diagnostic: a storage-truncated body ⇒ `truncated-json`, otherwise ⇒ `no-response-body`.
  if (deltaRaw.status !== 'completed' || typeof deltaRaw.rawResponse !== 'string') {
    const transportCategory: FrontendDeltaRejectionCategory = deltaRaw.truncatedForStorage ? 'truncated-json' : 'no-response-body';
    return {
      repairRaw: deltaRaw.status === 'completed' ? failedRaw(deltaRaw, deltaRaw.reason || 'The owner-delta repair returned no usable body.') : deltaRaw,
      diagnostics: {
        ...baseDiagnostics,
        // No usable delta body ⇒ no meaningful reduction to report.
        outputReductionRatio: 0,
        rejectionReason: cap(deltaRaw.reason || 'the owner-delta repair call did not complete'),
        rejectionCategory: transportCategory,
        // A completed-but-full-envelope response reaches this branch only via a storage-truncated
        // raw; otherwise there was no usable body. Report the transport's detected shape when known.
        actualResponseShape: deltaRaw.responseShape === 'frontend-envelope' ? 'frontend-files-v1' : 'none',
        // Mirror the bounded background lifecycle telemetry so a background timeout (the dominant
        // cause of a `no-response-body` delta failure) is diagnosable from the saved build.
        ...backgroundLifecycleDiag(deltaRaw),
      },
    };
  }

  const parsed = parseFrontendDeltaResponse(deltaRaw.rawResponse);
  const deltaCharCount = parsed.deltaCharCount;
  const reductionOf = (n: number) => roundRatio(1 - n / Math.max(1, originalProjectCharCount));

  if (!parsed.ok) {
    // Detected shape: a wrong-contract rejection means the model returned a FULL envelope; an
    // empty/no-body rejection means nothing usable; anything else was a delta-shaped body that
    // failed a delta check (truncated / malformed / invalid-schema / unsafe path).
    const actualResponseShape: FrontendDeltaRepairArtifact['actualResponseShape'] =
      parsed.category === 'wrong-contract' ? 'frontend-files-v1'
      : parsed.category === 'no-response-body' ? 'none'
      : 'unknown';
    return {
      repairRaw: failedRaw(deltaRaw, `Owner-delta repair rejected: ${parsed.reason}`),
      diagnostics: {
        ...baseDiagnostics,
        returnedUpsertCount: parsed.upsertCount,
        deltaCharCount,
        outputReductionRatio: reductionOf(deltaCharCount),
        rejectionReason: parsed.reason,
        rejectionCategory: parsed.category,
        actualResponseShape,
      },
    };
  }

  const reconstructedFiles = reconstructProjectFiles(originalFiles, parsed.upserts);

  // ── Deterministic STRUCTURAL GUARD (prevention). Resolve each upsert to its FINAL path in the
  //    reconstructed set (a replacement keeps the original's exact path), then check ONLY those
  //    changed/added files against the SAME Phase 12C rules. If a bounded upsert introduced an
  //    unresolved/aliased/escaping relative import, an unsupported/Node package, or an unsafe path,
  //    reject the delta NOW — fail open to the original validated project with a precise reason and
  //    NO second call — instead of finalizing a reconstruction that the downstream Phase 12C
  //    re-validation would only reject as a whole (dropping the entire build to Safe Preview). This
  //    is a strict subset of Phase 12C, so it never rejects a delta the full validator would accept. ──
  const originalKeyToPath = new Map(originalFiles.map((f) => [canonicalDeltaKey(f.path), f.path] as const));
  const changedFinalPaths = parsed.upserts.map((u) => originalKeyToPath.get(canonicalDeltaKey(u.path)) ?? u.path);
  const structuralIssues = findDeltaIntroducedStructuralIssues(reconstructedFiles, changedFinalPaths);
  if (structuralIssues.length > 0) {
    const first = structuralIssues[0];
    const detail = first.specifier ? `${first.code} (${first.specifier}) in ${first.path}` : `${first.code} in ${first.path}`;
    return {
      repairRaw: failedRaw(deltaRaw, `Owner-delta repair rejected: the reconstructed project would fail Phase 12C structural validation — ${detail}.`),
      diagnostics: {
        ...baseDiagnostics,
        returnedUpsertCount: parsed.upserts.length,
        deltaCharCount,
        reconstructedProjectCharCount: charCount(reconstructedFiles),
        outputReductionRatio: reductionOf(deltaCharCount),
        rejectionReason: cap(`reconstructed project fails Phase 12C: ${detail}`),
        rejectionCategory: 'structural-rejection',
        // The model DID return a well-formed delta; it was rejected on reconstruction, not contract.
        actualResponseShape: 'frontend-delta-v1',
      },
    };
  }

  const envelope = serializeFrontendFilesEnvelope(reconstructedFiles);
  const reconstructedProjectCharCount = charCount(reconstructedFiles);

  const repairRaw: FrontendBuilderRawArtifact = {
    version: 'frontend-builder-raw-v1',
    status: 'completed',
    requestedFormat: 'frontend-files-v1',
    mode: 'frontend_builder',
    rawResponse: envelope,
    responseCharCount: envelope.length,
    truncatedForStorage: false,
    validationStatus: 'not-run',
    reason: `Owner-delta quality repair reconstructed the complete project from ${parsed.upserts.length} upsert(s); validation has not run yet.`,
    warnings: [],
    responseShape: 'frontend-envelope',
    ...carryTelemetry(deltaRaw),
  };

  return {
    repairRaw,
    diagnostics: {
      ...baseDiagnostics,
      returnedUpsertCount: parsed.upserts.length,
      deltaCharCount,
      reconstructedProjectCharCount,
      outputReductionRatio: reductionOf(deltaCharCount),
      accepted: true,
      actualResponseShape: 'frontend-delta-v1',
    },
    changedPaths: changedFinalPaths,
  };
}
