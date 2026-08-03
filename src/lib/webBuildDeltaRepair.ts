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
 *     and can never be confused with the complete-project frontend-files-v1 parser),
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
  FrontendBuilderRawArtifact, FrontendDeltaRepairArtifact,
  FrontendGeneratedFile, FrontendGeneratedFileLanguage,
} from '@/lib/webBuildAgents';

/* ── Mode flag (Vite convention, mirrors the other VITE_* readers) ─────────────
 * VITE_WEB_BUILD_QUALITY_REPAIR_MODE = disabled | owner_delta
 * Missing / empty / any unrecognized value resolves to `disabled` (fail-closed). */
export type WebBuildQualityRepairMode = 'disabled' | 'owner_delta';

export function resolveWebBuildQualityRepairMode(): WebBuildQualityRepairMode {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_WEB_BUILD_QUALITY_REPAIR_MODE;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'owner_delta' ? 'owner_delta' : 'disabled';
  } catch {
    return 'disabled';
  }
}

/* ── Bounds (aligned with the unchanged full-project validator so a reconstructed
 * project can never exceed what that validator accepts; the validator remains the
 * final authority — these are early, cheap, self-documenting rejections). ─────── */
const MAX_DELTA_UPSERTS = 40;             // ≤ the validator's MAX_GENERATED_FILES (80)
const MAX_DELTA_SINGLE_FILE_CHARS = 80_000; // = the validator's MAX_SINGLE_FILE_CHARS
const MAX_DELTA_TOTAL_UPSERT_CHARS = 180_000; // = the validator's MAX_TOTAL_PARSED_CHARS
const MAX_REJECTION_REASON_CHARS = 240;

const DELTA_OPEN = '## FRONTEND_DELTA_V1';
const DELTA_CLOSE = '## END_FRONTEND_DELTA_V1';

const ENVELOPE_OPEN = '## FRONTEND_FILES_V1';
const ENVELOPE_CLOSE = '## END_FRONTEND_FILES_V1';

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
  upsertCount: number;
  deltaCharCount: number;
}
export type DeltaParseResult = DeltaParseOk | DeltaParseErr;

function cap(reason: string): string {
  return reason.length > MAX_REJECTION_REASON_CHARS ? reason.slice(0, MAX_REJECTION_REASON_CHARS) : reason;
}

/** Extract the delta JSON body from the raw response. Tolerant of a leading BOM, surrounding
 *  whitespace, an optional ```json code fence and the DELTA_OPEN/DELTA_CLOSE markers; strict
 *  about everything else. Returns the inner JSON string or null. */
function extractDeltaJson(rawResponse: string): string | null {
  let text = (rawResponse || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return null;
  // Strip a single wrapping ```json … ``` fence if present.
  const fenced = /^```[a-zA-Z]*\n([\s\S]*)\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  const open = text.indexOf(DELTA_OPEN);
  if (open !== -1) {
    const close = text.indexOf(DELTA_CLOSE, open + DELTA_OPEN.length);
    if (close === -1) return null;
    return text.slice(open + DELTA_OPEN.length, close).trim() || null;
  }
  // No markers — accept a bare top-level JSON object only (strict: must start with '{').
  return text.startsWith('{') ? text : null;
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
  const fail = (reason: string, upsertCount = 0): DeltaParseErr => ({ ok: false, reason: cap(reason), upsertCount, deltaCharCount });
  try {
    if (!rawResponse || !rawResponse.trim()) return fail('empty delta response');
    if (deltaCharCount > MAX_DELTA_TOTAL_UPSERT_CHARS * 2) return fail('delta response exceeds the safe size limit');
    const jsonText = extractDeltaJson(rawResponse);
    if (!jsonText) return fail('malformed delta response: no FRONTEND_DELTA_V1 JSON body found');

    let parsed: unknown;
    try { parsed = JSON.parse(jsonText); } catch { return fail('malformed delta response: body is not valid JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('malformed delta response: root is not a JSON object');
    const upsertsRaw = (parsed as { upserts?: unknown }).upserts;
    if (!Array.isArray(upsertsRaw)) return fail('malformed delta response: missing "upserts" array');
    if (upsertsRaw.length === 0) return fail('empty upsert list');
    if (upsertsRaw.length > MAX_DELTA_UPSERTS) return fail(`too many upserts (${upsertsRaw.length} > ${MAX_DELTA_UPSERTS})`);

    const seen = new Set<string>();
    const upserts: DeltaUpsert[] = [];
    let totalChars = 0;
    for (let i = 0; i < upsertsRaw.length; i += 1) {
      const entry = upsertsRaw[i];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail(`upsert #${i + 1} is not an object`);
      const norm = normalizeDeltaPath((entry as { path?: unknown }).path);
      if (!norm.ok) return fail(norm.reason);
      if (seen.has(norm.path)) return fail(`duplicate upsert path after normalization: ${norm.path}`);
      seen.add(norm.path);

      const content = (entry as { content?: unknown }).content;
      if (typeof content !== 'string' || content.trim() === '') return fail(`empty file content for ${norm.path}`);
      if (content.length > MAX_DELTA_SINGLE_FILE_CHARS) return fail(`file ${norm.path} exceeds ${MAX_DELTA_SINGLE_FILE_CHARS} characters`);
      if (FENCE_LINE_RE.test(content) || RESERVED_MARKER_LINE_RE.test(content)) {
        return fail(`unsafe content (reserved envelope/fence line) in ${norm.path}`);
      }
      // A provided language, when present, must not contradict the path extension.
      const declared = (entry as { language?: unknown }).language;
      if (typeof declared === 'string' && declared.trim() && declared.trim().toLowerCase() !== norm.language) {
        return fail(`declared language "${declared}" conflicts with the extension of ${norm.path}`);
      }

      totalChars += content.length;
      if (totalChars > MAX_DELTA_TOTAL_UPSERT_CHARS) return fail(`total upsert content exceeds ${MAX_DELTA_TOTAL_UPSERT_CHARS} characters`);
      upserts.push({ path: norm.path, language: norm.language, content });
    }
    return { ok: true, upserts, deltaCharCount };
  } catch {
    return fail('internal delta-parse error');
  }
}

/** Normalize an ORIGINAL file path the same way (leading ./, duplicate slashes) so a
 *  replacement upsert deterministically overwrites the file it targets even if the two
 *  paths differ only by a leading `./`. Never rejects — originals were already validated. */
function normalizeExistingPath(p: string): string {
  return (p || '').replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/');
}

/** Deterministically merge upserts into the original validated files. Phase 1: REPLACE an
 *  existing file (matched by normalized path) or ADD a new one — never delete. A replacement
 *  KEEPS the original file's EXACT path (so retained/replaced files never appear renamed to the
 *  downstream diff); only a genuinely new file uses the upsert's normalized path. Original
 *  ordering is preserved; new files are appended in upsert order. */
export function reconstructProjectFiles(
  originalFiles: FrontendGeneratedFile[],
  upserts: DeltaUpsert[],
): DeltaUpsert[] {
  const byKey = new Map<string, DeltaUpsert>();  // normalized key → file (with its EXACT path)
  const order: string[] = [];
  for (const f of originalFiles) {
    const key = normalizeExistingPath(f.path);
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, { path: f.path, language: f.language, content: f.content });
  }
  for (const u of upserts) {
    const existing = byKey.get(u.path);
    if (existing) {
      // Replace content/language; preserve the original file's exact path.
      byKey.set(u.path, { path: existing.path, language: u.language, content: u.content });
    } else {
      order.push(u.path);
      byKey.set(u.path, { path: u.path, language: u.language, content: u.content });
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

export interface DeltaReconstruction {
  /** A synthetic raw artifact the caller feeds to the UNCHANGED full-project validator:
   *  a `completed` frontend-files-v1 envelope on success, or a `failed` artifact (carrying a
   *  bounded, honest reason + the delta call's real model/provider/requestId) on rejection so
   *  the pipeline's existing fail-open branch preserves the original project — with NO second
   *  repair call. */
  repairRaw: FrontendBuilderRawArtifact;
  /** Bounded, sanitized diagnostics for the acceptance/repair artifact. */
  diagnostics: FrontendDeltaRepairArtifact;
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
  };

  // The delta model call itself did not complete (transport/mode/size failure) — fail open.
  if (deltaRaw.status !== 'completed' || typeof deltaRaw.rawResponse !== 'string') {
    return {
      repairRaw: deltaRaw.status === 'completed' ? failedRaw(deltaRaw, deltaRaw.reason || 'The owner-delta repair returned no usable body.') : deltaRaw,
      diagnostics: {
        ...baseDiagnostics,
        // No usable delta body ⇒ no meaningful reduction to report.
        outputReductionRatio: 0,
        rejectionReason: cap(deltaRaw.reason || 'the owner-delta repair call did not complete'),
      },
    };
  }

  const parsed = parseFrontendDeltaResponse(deltaRaw.rawResponse);
  const deltaCharCount = parsed.deltaCharCount;
  const reductionOf = (n: number) => roundRatio(1 - n / Math.max(1, originalProjectCharCount));

  if (!parsed.ok) {
    return {
      repairRaw: failedRaw(deltaRaw, `Owner-delta repair rejected: ${parsed.reason}`),
      diagnostics: {
        ...baseDiagnostics,
        returnedUpsertCount: parsed.upsertCount,
        deltaCharCount,
        outputReductionRatio: reductionOf(deltaCharCount),
        rejectionReason: parsed.reason,
      },
    };
  }

  const reconstructedFiles = reconstructProjectFiles(originalFiles, parsed.upserts);
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
    },
  };
}
