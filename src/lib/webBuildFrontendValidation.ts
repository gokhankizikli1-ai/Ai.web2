/**
 * Web Build FRONTEND FILES PARSER + STATIC VALIDATOR (Phase 12C).
 *
 * Parses the raw `frontend-files-v1` envelope produced by the dedicated Frontend
 * Builder (Phase 12B) and STATICALLY validates the parsed project against the
 * Phase 12A FrontendBuildSpecification output contract.
 *
 * STATIC ONLY. `parseAndValidateFrontendBuilderRaw` is pure, synchronous,
 * deterministic, network-free, non-mutating, JSON-serializable, bounded and FAILS
 * OPEN (never throws). It performs NO compilation, execution, dynamic import,
 * eval/new Function, TS/Babel API, DOM/iframe parsing, fetch, worker or module
 * resolution — a structurally-valid result is NOT proven to compile or render, and
 * it NEVER replaces `payload.files`. Parsed files live only inside the returned
 * artifact until Phase 12D.
 *
 * All cross-module imports are TYPE-ONLY, so there is no runtime import cycle.
 */
import type {
  FrontendBuilderRawArtifact, FrontendBuildSpecification,
  FrontendBuilderValidationArtifact, FrontendGeneratedFile, FrontendBuilderValidationIssue,
  FrontendGeneratedFileLanguage,
} from '@/lib/webBuildAgents';

/* ── Bounds (safe against untrusted model output) ───────────────────────────── */
const MAX_GENERATED_FILES = 80;
const MAX_SINGLE_FILE_CHARS = 80_000;
const MAX_TOTAL_PARSED_CHARS = 180_000;
const MAX_PERSISTED_ISSUES = 40;
const MAX_ISSUE_MESSAGE_CHARS = 240;
const MAX_LIST_ENTRIES = 40;
const MAX_COPY_PREVIEW_CHARS = 60;

/* ── Runtime package allowlist (STATIC — never reads package.json at runtime) ──
 * EXACT package ROOTS from the repository's current direct runtime dependencies that
 * a generated static frontend may legitimately import. Scoped packages are matched by
 * their EXACT `@scope/name` root (an entire npm scope is NEVER allowed — a scoped
 * package that shares an allowed scope but is not installed must be rejected). Node
 * built-ins are always rejected. */
const ALLOWED_PACKAGE_ROOTS = new Set<string>([
  // Unscoped direct runtime dependencies.
  'react', 'react-dom', 'framer-motion', 'lucide-react', 'clsx', 'tailwind-merge', 'recharts',
  'class-variance-authority', 'cmdk', 'date-fns', 'embla-carousel-react', 'input-otp', 'next-themes',
  'react-day-picker', 'react-hook-form', 'react-markdown', 'react-resizable-panels', 'react-router',
  'react-syntax-highlighter', 'remark-gfm', 'sonner', 'vaul', 'zod', 'zustand',
  // Scoped direct runtime dependencies — EXACT `@scope/name` roots only.
  '@hookform/resolvers',
  '@radix-ui/react-accordion', '@radix-ui/react-alert-dialog', '@radix-ui/react-aspect-ratio',
  '@radix-ui/react-avatar', '@radix-ui/react-checkbox', '@radix-ui/react-collapsible',
  '@radix-ui/react-context-menu', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-hover-card', '@radix-ui/react-label', '@radix-ui/react-menubar',
  '@radix-ui/react-navigation-menu', '@radix-ui/react-popover', '@radix-ui/react-progress',
  '@radix-ui/react-radio-group', '@radix-ui/react-scroll-area', '@radix-ui/react-select',
  '@radix-ui/react-separator', '@radix-ui/react-slider', '@radix-ui/react-slot',
  '@radix-ui/react-switch', '@radix-ui/react-tabs', '@radix-ui/react-toggle',
  '@radix-ui/react-toggle-group', '@radix-ui/react-tooltip',
]);
const NODE_BUILTINS = new Set<string>([
  'fs', 'path', 'child_process', 'http', 'https', 'crypto', 'net', 'os', 'url', 'stream',
  'util', 'events', 'zlib', 'tls', 'dns', 'dgram', 'cluster', 'readline', 'worker_threads',
  'perf_hooks', 'assert', 'buffer', 'process', 'querystring', 'vm', 'module',
]);

/* ── Forbidden static patterns (targeted to avoid false positives in copy) ───── */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /dangerouslySetInnerHTML/, label: 'dangerouslySetInnerHTML' },
  { re: /\beval\s*\(/, label: 'eval(' },
  { re: /new\s+Function\s*\(/, label: 'new Function' },
  { re: /document\.write\s*\(/, label: 'document.write' },
  { re: /javascript:/i, label: 'javascript: URI' },
  { re: /<script\b/i, label: '<script' },
  { re: /\bfetch\s*\(/, label: 'fetch(' },
  { re: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, label: 'WebSocket' },
  { re: /\bEventSource\b/, label: 'EventSource' },
  { re: /navigator\.sendBeacon/, label: 'navigator.sendBeacon' },
  // Targeted EXECUTABLE usage of an HTTP-client SDK — an actual call
  // (`axios(...)` / `axios.get(...)`), never the plain word. Visible copy such as
  // <span>axios</span> or "axios (the HTTP client)" does NOT match. Package-level
  // integration (axios, supabase, firebase, stripe, socket.io, graphql-request …)
  // is already rejected as an unsupported-package IMPORT and via the network APIs
  // above, so no plain service-name copy is ever flagged as SDK execution.
  { re: /\baxios\.\w+\s*\(|\baxios\(/, label: 'axios runtime call' },
  { re: /process\.env/, label: 'process.env' },
  { re: /import\.meta\.env/, label: 'import.meta.env' },
];
const REMOTE_ASSET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /<(?:img|video|source)\b[^>]*\bsrc\s*=\s*["'`]\s*https?:\/\//i, label: 'remote <img/video/source src' },
  { re: /url\(\s*["']?\s*https?:\/\//i, label: 'remote css url()' },
];
/* Incomplete-output markers — matched against CODE COMMENT text only (see
 * extractCommentText), never raw file content, so a visible "TODO"/"FIXME" headline
 * or a "content omitted" paragraph in public copy is not flagged as a code stub. */
const INCOMPLETE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bTODO\b/, label: 'TODO placeholder' },
  { re: /\bFIXME\b/, label: 'FIXME placeholder' },
  { re: /same as above/i, label: '"same as above" placeholder' },
  { re: /content omitted/i, label: '"content omitted" placeholder' },
  { re: /implementation omitted/i, label: '"implementation omitted" placeholder' },
  { re: /your code here/i, label: '"your code here" placeholder' },
  { re: /rest of code/i, label: '"rest of code" placeholder' },
  { re: /insert component here/i, label: '"insert component here" placeholder' },
];
const HONESTY_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\btrusted by\b/i, label: 'Trusted by' },
  { re: /\bsoc\s?2\b/i, label: 'SOC 2' },
  { re: /\biso\s?27001\b/i, label: 'ISO 27001' },
  { re: /\bhipaa\b/i, label: 'HIPAA' },
  { re: /\b\d{1,3}(?:\.\d)?%/, label: 'percentage metric' },
  { re: /\b\d(?:\.\d)?\/5\b/, label: 'x/5 rating' },
  { re: /\b\d[\d,]{2,}\+/, label: 'N,NNN+ count' },
];

/* ── POSIX path helpers (local; never import Node's path in browser code) ────── */
const EXT_CANDIDATES = ['', '.tsx', '.ts', '.css', '/index.tsx', '/index.ts', '/index.css'];
const SAFE_PATH_RE = /^[A-Za-z0-9/_.-]+$/;

function posixDirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
/** Resolve a relative specifier against a directory. Returns null when it escapes root. */
function posixResolve(fromDir: string, rel: string): string | null {
  const stack: string[] = fromDir ? fromDir.split('/').filter(Boolean) : [];
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null; // escapes the root
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join('/');
}
function langForPath(p: string): FrontendGeneratedFileLanguage | null {
  if (p.endsWith('.tsx')) return 'tsx';
  if (p.endsWith('.css')) return 'css';
  if (p.endsWith('.ts')) return 'ts';
  return null;
}

/* ── Small bounded utilities ────────────────────────────────────────────────── */
const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);
function capUniq(xs: string[], cap = MAX_LIST_ENTRIES): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of xs) {
    const s = (raw || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/* ── Validation accumulator (local, never module-level state) ───────────────── */
interface Acc {
  errors: FrontendBuilderValidationIssue[];
  warnings: FrontendBuilderValidationIssue[];
  missingRequiredFiles: string[];
  missingRequiredSectionFiles: string[];
  duplicatePaths: string[];
  unresolvedRelativeImports: string[];
  unsupportedPackageImports: string[];
  unreachableRequiredSectionFiles: string[];
  missingCriticalCopy: string[];
  missingSupportingCopy: string[];
  forbiddenPatternMatches: string[];
}
function newAcc(): Acc {
  return {
    errors: [], warnings: [], missingRequiredFiles: [], missingRequiredSectionFiles: [],
    duplicatePaths: [], unresolvedRelativeImports: [], unsupportedPackageImports: [],
    unreachableRequiredSectionFiles: [], missingCriticalCopy: [], missingSupportingCopy: [],
    forbiddenPatternMatches: [],
  };
}
function addError(acc: Acc, code: string, message: string, path?: string, specifier?: string): void {
  if (acc.errors.length >= MAX_PERSISTED_ISSUES) return;
  const issue: FrontendBuilderValidationIssue = { severity: 'error', code, message: trunc(message, MAX_ISSUE_MESSAGE_CHARS) };
  if (path) issue.path = path;
  if (specifier) issue.specifier = specifier;
  acc.errors.push(issue);
}
function addWarning(acc: Acc, code: string, message: string, path?: string, specifier?: string): void {
  if (acc.warnings.length >= MAX_PERSISTED_ISSUES) return;
  const issue: FrontendBuilderValidationIssue = { severity: 'warning', code, message: trunc(message, MAX_ISSUE_MESSAGE_CHARS) };
  if (path) issue.path = path;
  if (specifier) issue.specifier = specifier;
  acc.warnings.push(issue);
}

/* ── Skipped / early artifacts ──────────────────────────────────────────────── */
function baseArtifact(
  status: FrontendBuilderValidationArtifact['status'],
  raw: FrontendBuilderRawArtifact,
  didParse: boolean,
  reason: string,
  files: FrontendGeneratedFile[] = [],
): FrontendBuilderValidationArtifact {
  const totalCharCount = files.reduce((n, f) => n + f.charCount, 0);
  return {
    version: 'frontend-builder-validation-v1',
    status,
    format: 'frontend-files-v1',
    sourceRawStatus: raw.status,
    didParse,
    readyForConsumption: false,
    files,
    fileCount: files.length,
    totalCharCount,
    requiredFileCount: 0,
    requiredSectionFileCount: 0,
    presentRequiredFileCount: 0,
    presentRequiredSectionFileCount: 0,
    missingRequiredFiles: [],
    missingRequiredSectionFiles: [],
    duplicatePaths: [],
    unresolvedRelativeImports: [],
    unsupportedPackageImports: [],
    unreachableRequiredSectionFiles: [],
    missingCriticalCopy: [],
    missingSupportingCopy: [],
    forbiddenPatternMatches: [],
    errors: [],
    warnings: [],
    reason,
  };
}

/* ── Strict envelope parser (line-by-line state machine; no broad regex) ─────── */
type RawFile = { path: string; language: FrontendGeneratedFileLanguage; content: string };
interface ParseResult { ok: boolean; files: RawFile[]; error?: string; overflow?: boolean; }
const ENVELOPE_OPEN = '## FRONTEND_FILES_V1';
const ENVELOPE_CLOSE = '## END_FRONTEND_FILES_V1';
const FENCE_LANGS: Record<string, FrontendGeneratedFileLanguage> = { tsx: 'tsx', ts: 'ts', css: 'css' };

function parseEnvelope(rawResponse: string): ParseResult {
  // Normalize ONLY line endings + a leading BOM; never rewrite the code otherwise.
  let text = rawResponse.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.trim();
  if (!text.startsWith(ENVELOPE_OPEN)) return { ok: false, files: [], error: 'missing or misplaced ## FRONTEND_FILES_V1 opening marker' };
  if (!text.endsWith(ENVELOPE_CLOSE)) return { ok: false, files: [], error: 'missing or misplaced ## END_FRONTEND_FILES_V1 closing marker' };

  const lines = text.split('\n');
  const files: RawFile[] = [];
  let totalChars = 0;
  // State: 'top' (between blocks) → 'expectFence' → 'inCode' → 'expectEndFile'.
  let state: 'top' | 'expectFence' | 'inCode' | 'expectEndFile' = 'top';
  let curPath = '';
  let curLang: FrontendGeneratedFileLanguage | null = null;
  let curLines: string[] = [];

  for (let i = 1; i < lines.length - 1; i += 1) { // skip the open/close marker lines
    const line = lines[i];
    if (state === 'top') {
      if (line.trim() === '') continue; // blank lines allowed between blocks
      if (line.startsWith('### FILE ')) {
        curPath = line.slice('### FILE '.length).trim();
        if (!curPath) return { ok: false, files: [], error: 'empty ### FILE path header' };
        state = 'expectFence';
        curLang = null;
        curLines = [];
        continue;
      }
      return { ok: false, files: [], error: `unexpected prose between file blocks: ${trunc(line.trim(), 60)}` };
    }
    if (state === 'expectFence') {
      const m = /^```([A-Za-z]+)\s*$/.exec(line);
      if (!m) return { ok: false, files: [], error: `expected an opening fence after ### FILE ${curPath}` };
      const lang = FENCE_LANGS[m[1].toLowerCase()];
      if (!lang) return { ok: false, files: [], error: `unsupported fence language "${m[1]}" for ${curPath}` };
      curLang = lang;
      state = 'inCode';
      continue;
    }
    if (state === 'inCode') {
      if (line.trim() === '```') {
        state = 'expectEndFile';
        continue;
      }
      curLines.push(line);
      totalChars += line.length + 1;
      if (totalChars > MAX_TOTAL_PARSED_CHARS) return { ok: false, files: [], overflow: true, error: `total parsed content exceeds ${MAX_TOTAL_PARSED_CHARS} characters` };
      continue;
    }
    // state === 'expectEndFile'
    if (line.trim() === '') continue;
    if (line.trim() === '### END_FILE') {
      const content = curLines.join('\n');
      if (!content.trim()) return { ok: false, files: [], error: `empty file content for ${curPath}` };
      if (content.length > MAX_SINGLE_FILE_CHARS) return { ok: false, files: [], overflow: true, error: `file ${curPath} exceeds ${MAX_SINGLE_FILE_CHARS} characters` };
      if (curLang === null) return { ok: false, files: [], error: `no fence language for ${curPath}` };
      files.push({ path: curPath, language: curLang, content });
      if (files.length > MAX_GENERATED_FILES) return { ok: false, files: [], overflow: true, error: `more than ${MAX_GENERATED_FILES} files` };
      state = 'top';
      continue;
    }
    return { ok: false, files: [], error: `expected ### END_FILE after the closing fence for ${curPath}` };
  }

  if (state !== 'top') return { ok: false, files: [], error: `unterminated file block for ${curPath || '(unknown)'}` };
  if (files.length === 0) return { ok: false, files: [], error: 'no file blocks found in the envelope' };
  return { ok: true, files };
}

/* ── Import specifier extraction (static; from .ts/.tsx only) ────────────────── */
const IMPORT_FROM_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/;

function extractSpecifiers(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_FROM_RE.lastIndex = 0;
  while ((m = IMPORT_FROM_RE.exec(content)) !== null) out.push(m[1]);
  SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
  while ((m = SIDE_EFFECT_IMPORT_RE.exec(content)) !== null) out.push(m[1]);
  return out;
}
/** Exact package root for the allowlist: `@scope/name` for scoped, first segment
 *  otherwise. An entire scope is never returned on its own, so a shared scope can
 *  never grant access to an uninstalled scoped package. */
function packageRoot(spec: string): { root: string } {
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return { root: parts.slice(0, 2).join('/') };
  }
  return { root: spec.split('/')[0] };
}

/* ── Copy normalization (compare only; never rewrites generated code) ────────── */
function normCopy(s: string): string {
  return (s || '')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract ONLY comment text from a .ts/.tsx file — line `//…`, block `/*…*/` and
 *  JSX `{/*…*/}` (which share the `/*…*/` delimiter). Used so placeholder /
 *  incomplete-output detection scans code comments, NEVER visible copy: a `TODO`
 *  headline or a "content omitted" paragraph is public text, not a code stub. Bounded,
 *  string-only. A `//` preceded by `:` or `/` (e.g. `https://`) is not a comment. */
function extractCommentText(content: string): string {
  const parts: string[] = [];
  const block = /\/\*[\s\S]*?\*\//g;
  let mb: RegExpExecArray | null;
  while ((mb = block.exec(content)) !== null) parts.push(mb[0]);
  const line = /(?:^|[^:/])\/\/(.*)$/gm;
  let ml: RegExpExecArray | null;
  while ((ml = line.exec(content)) !== null) parts.push(ml[1]);
  return parts.join('\n');
}

/* ── Main validation (given successfully parsed files + the spec) ───────────── */
function validateProject(rawFiles: RawFile[], spec: FrontendBuildSpecification, raw: FrontendBuilderRawArtifact): FrontendBuilderValidationArtifact {
  const acc = newAcc();

  // 1) Path validation + case-insensitive dedupe → build the parsed file set.
  const byPath = new Map<string, RawFile>();
  const lowerSeen = new Map<string, string>();
  for (const f of rawFiles) {
    const p = f.path;
    const ext = langForPath(p);
    const unsafe =
      p.includes('\\') || p.startsWith('/') || p.includes('..') || p.includes('\0')
      || /[:?#]/.test(p) || !SAFE_PATH_RE.test(p)
      || !p.startsWith('src/') || p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
      || ext === null;
    if (unsafe) { addError(acc, 'unsafe-path', `unsafe or invalid file path: ${trunc(p, 80)}`, p); continue; }
    if (ext !== f.language) { addError(acc, 'fence-mismatch', `fence language "${f.language}" does not match the ${p} extension`, p); continue; }
    if (byPath.has(p)) { acc.duplicatePaths.push(p); addError(acc, 'duplicate-path', `duplicate file path: ${p}`, p); continue; }
    const low = p.toLowerCase();
    const prev = lowerSeen.get(low);
    if (prev && prev !== p) { acc.duplicatePaths.push(p); addError(acc, 'duplicate-path-ci', `case-insensitive duplicate path: ${p} vs ${prev}`, p); continue; }
    lowerSeen.set(low, p);
    byPath.set(p, f);
  }

  const files: FrontendGeneratedFile[] = Array.from(byPath.values()).map((f) => ({
    path: f.path, language: f.language, content: f.content,
    charCount: f.content.length, lineCount: f.content.split('\n').length,
  }));
  const pathSet = new Set(byPath.keys());
  const allContent = files.map((f) => f.content).join('\n');

  // 2) Required base + section files (authoritative spec contract; compare-only norm).
  const requiredFiles = capUniq((spec.outputContract?.requiredFiles || []).map((p) => p.trim()));
  const requiredSection = capUniq((spec.outputContract?.requiredSectionComponentFiles || []).map((p) => p.trim()));
  const baseline = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];
  const requiredAll = capUniq([...baseline, ...requiredFiles]);
  for (const req of requiredAll) {
    if (!pathSet.has(req)) { acc.missingRequiredFiles.push(req); addError(acc, 'missing-required-file', `required file missing: ${req}`, req); }
  }
  for (const req of requiredSection) {
    if (!pathSet.has(req)) { acc.missingRequiredSectionFiles.push(req); addError(acc, 'missing-required-section', `required section component missing: ${req}`, req); }
  }
  const presentRequired = requiredAll.filter((p) => pathSet.has(p)).length;
  const presentSection = requiredSection.filter((p) => pathSet.has(p)).length;

  // 3) Static import resolution + package allowlist + relative graph edges.
  const edges = new Map<string, string[]>(); // importer → resolved parsed targets
  for (const f of files) {
    if (f.language === 'css') { edges.set(f.path, []); continue; }
    const targets: string[] = [];
    if (DYNAMIC_IMPORT_RE.test(f.content)) addError(acc, 'dynamic-import', 'dynamic import() is not supported in the generated static project', f.path);
    const dir = posixDirname(f.path);
    for (const specifier of extractSpecifiers(f.content)) {
      if (specifier.startsWith('.')) {
        const resolvedBase = posixResolve(dir, specifier);
        if (resolvedBase === null || !resolvedBase.startsWith('src/')) {
          acc.unresolvedRelativeImports.push(specifier);
          addError(acc, 'import-escapes-root', `relative import escapes src/: ${specifier}`, f.path, specifier);
          continue;
        }
        const hit = EXT_CANDIDATES.map((c) => `${resolvedBase}${c}`).find((cand) => pathSet.has(cand));
        if (!hit) { acc.unresolvedRelativeImports.push(specifier); addError(acc, 'unresolved-import', `unresolved relative import: ${specifier}`, f.path, specifier); }
        else targets.push(hit);
      } else if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
        acc.unresolvedRelativeImports.push(specifier);
        addError(acc, 'unsupported-alias', `path alias import is unsupported in the standalone project: ${specifier}`, f.path, specifier);
      } else {
        // EXACT package-root allowlisting: a scoped package must match its full
        // `@scope/name` root — sharing an allowed scope is NOT sufficient.
        const { root } = packageRoot(specifier);
        if (NODE_BUILTINS.has(root) || specifier.startsWith('node:')) {
          acc.unsupportedPackageImports.push(specifier);
          addError(acc, 'node-builtin', `Node built-in import is not allowed in browser code: ${specifier}`, f.path, specifier);
        } else if (ALLOWED_PACKAGE_ROOTS.has(root)) {
          /* allowed — exact installed direct runtime dependency */
        } else {
          acc.unsupportedPackageImports.push(specifier);
          addError(acc, 'unsupported-package', `unsupported package import (not in the runtime allowlist): ${root}`, f.path, specifier);
        }
      }
    }
    edges.set(f.path, targets);
  }

  // 4) Reachability from src/main.tsx over resolved relative imports.
  const reachable = new Set<string>();
  if (pathSet.has('src/main.tsx')) {
    const stack = ['src/main.tsx'];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === undefined) break;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const t of (edges.get(cur) || [])) if (!reachable.has(t)) stack.push(t);
    }
  }
  for (const req of requiredSection) {
    if (pathSet.has(req) && !reachable.has(req)) {
      acc.unreachableRequiredSectionFiles.push(req);
      addError(acc, 'unreachable-section', `required section component is never reached from src/main.tsx: ${req}`, req);
    }
  }
  for (const f of files) {
    if (!reachable.has(f.path) && !requiredSection.includes(f.path) && !requiredAll.includes(f.path)) {
      addWarning(acc, 'unused-file', `parsed file is not reachable from the entry graph: ${f.path}`, f.path);
    }
  }

  // 5) Entry-file minimum contract (static evidence; not byte-identical).
  const main = byPath.get('src/main.tsx');
  if (main) {
    const c = main.content;
    if (!/createRoot\s*\(/.test(c)) addError(acc, 'main-no-root', 'src/main.tsx does not call createRoot(...)', 'src/main.tsx');
    if (!/\bApp\b/.test(c)) addError(acc, 'main-no-app', 'src/main.tsx does not reference App', 'src/main.tsx');
    if (!/['"][^'"]+\.css['"]/.test(c)) addError(acc, 'main-no-css', 'src/main.tsx does not import a CSS entry', 'src/main.tsx');
    if (!/getElementById\s*\(|document\.|rootElement|#root/.test(c)) addError(acc, 'main-no-mount', 'src/main.tsx does not mount into a root element', 'src/main.tsx');
  }
  const app = byPath.get('src/App.tsx');
  if (app) {
    const c = app.content;
    if (!c.trim()) addError(acc, 'app-empty', 'src/App.tsx is empty', 'src/App.tsx');
    if (!/export\s+default\b/.test(c)) addError(acc, 'app-no-default', 'src/App.tsx has no default export (App component)', 'src/App.tsx');
    if (!/<[A-Za-z][\w.-]*[\s/>]/.test(c)) addError(acc, 'app-no-jsx', 'src/App.tsx renders no JSX', 'src/App.tsx');
  }
  const styles = byPath.get('src/styles.css');
  if (styles) {
    const c = styles.content;
    if (!c.trim()) addError(acc, 'styles-empty', 'src/styles.css is empty', 'src/styles.css');
    else if (!/@tailwind\s+(base|components|utilities)\b/.test(c) && !/@import\s+["']tailwindcss/.test(c)) {
      addError(acc, 'styles-no-tailwind', 'src/styles.css has no Tailwind integration (@tailwind base/components/utilities)', 'src/styles.css');
    }
  }

  // 6) Forbidden runtime/security + remote-asset patterns.
  for (const f of files) {
    for (const { re, label } of FORBIDDEN_PATTERNS) {
      if (re.test(f.content)) { acc.forbiddenPatternMatches.push(`${label} (${f.path})`); addError(acc, 'forbidden-pattern', `forbidden runtime/security pattern: ${label}`, f.path); }
    }
    for (const { re, label } of REMOTE_ASSET_PATTERNS) {
      if (re.test(f.content)) { acc.forbiddenPatternMatches.push(`${label} (${f.path})`); addError(acc, 'remote-asset', `remote runtime asset is not allowed: ${label}`, f.path); }
    }
  }

  // 7) Incomplete-output / placeholder checks. Exact standalone ellipsis lines stay
  //    exact; TODO/FIXME + the incomplete-output phrases are scanned in CODE COMMENTS
  //    ONLY, so visible public copy (a "TODO list" headline, a "content omitted"
  //    paragraph) is never mistaken for an unfinished code stub.
  for (const f of files) {
    if (f.language === 'css') continue;
    for (const raw2 of f.content.split('\n')) {
      const t = raw2.trim();
      if (t === '...' || t === '// ...' || t === '/* ... */' || t === '{/* ... */}') {
        addError(acc, 'placeholder-ellipsis', `code placeholder ("...") in ${f.path}`, f.path); break;
      }
    }
    const comments = extractCommentText(f.content);
    for (const { re, label } of INCOMPLETE_PATTERNS) {
      if (re.test(comments)) { addError(acc, 'incomplete-code', `incomplete-output placeholder in a code comment: ${label}`, f.path); break; }
    }
  }
  // Required section components must not be empty stubs (return null / empty).
  for (const req of requiredSection) {
    const rf = byPath.get(req);
    if (!rf) continue;
    const noJsx = !/<[A-Za-z][\w.-]*[\s/>]/.test(rf.content);
    const onlyNull = /\breturn\s*\(?\s*null\s*\)?\s*;?/.test(rf.content) && noJsx;
    const emptyFrag = /\breturn\s*\(?\s*<>\s*<\/>\s*\)?\s*;?/.test(rf.content) && !/<[A-Za-z]/.test(rf.content);
    if (onlyNull || emptyFrag || noJsx) addError(acc, 'empty-section-component', `required section component renders no meaningful content: ${req}`, req);
  }

  // 8) Copy preservation (critical → error; supporting → warning). Compare-only norm.
  const haystack = normCopy(allContent);
  const sections = Array.isArray(spec.architecture?.sections) ? spec.architecture.sections : [];
  for (const s of sections) {
    const headline = normCopy(s.headline || '');
    const cta = normCopy(s.primaryCTA || '');
    if (headline.length >= 2 && !haystack.includes(headline)) acc.missingCriticalCopy.push(trunc(s.headline || '', MAX_COPY_PREVIEW_CHARS));
    if (cta.length >= 2 && !haystack.includes(cta)) acc.missingCriticalCopy.push(trunc(s.primaryCTA || '', MAX_COPY_PREVIEW_CHARS));
    const sub = normCopy(s.subheadline || '');
    if (sub.length >= 2 && !haystack.includes(sub)) acc.missingSupportingCopy.push(trunc(s.subheadline || '', MAX_COPY_PREVIEW_CHARS));
    for (const b of (Array.isArray(s.bullets) ? s.bullets : [])) {
      const nb = normCopy(b || '');
      if (nb.length >= 2 && !haystack.includes(nb)) acc.missingSupportingCopy.push(trunc(b || '', MAX_COPY_PREVIEW_CHARS));
    }
  }
  if (acc.missingCriticalCopy.length) addError(acc, 'missing-critical-copy', `missing critical public copy (${acc.missingCriticalCopy.length}): ${acc.missingCriticalCopy.slice(0, 3).join(' | ')}`);
  if (acc.missingSupportingCopy.length) addWarning(acc, 'missing-supporting-copy', `missing supporting public copy (${acc.missingSupportingCopy.length}): ${acc.missingSupportingCopy.slice(0, 3).join(' | ')}`);

  // 9) Section-order check (deterministic; error only when fully determinable).
  if (app && requiredSection.length >= 2) {
    const orderIndex = new Map<string, number>();
    (Array.isArray(spec.architecture?.sectionOrder) ? spec.architecture.sectionOrder : []).forEach((id, i) => orderIndex.set(pascalOf(id), i));
    const appDir = posixDirname('src/App.tsx');
    const importIdent = new Map<string, string>(); // resolved path → imported identifier
    let mDef: RegExpExecArray | null;
    const DEF_RE = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;
    DEF_RE.lastIndex = 0;
    while ((mDef = DEF_RE.exec(app.content)) !== null) {
      const spc = mDef[2];
      if (!spc.startsWith('.')) continue;
      const rb = posixResolve(appDir, spc);
      if (rb === null) continue;
      const hit = EXT_CANDIDATES.map((c) => `${rb}${c}`).find((cand) => pathSet.has(cand));
      if (hit) importIdent.set(hit, mDef[1]);
    }
    const positioned: Array<{ req: string; jsx: number; intended: number }> = [];
    let determinable = true;
    for (const req of requiredSection) {
      if (!pathSet.has(req)) { determinable = false; continue; }
      const ident = importIdent.get(req);
      const intended = orderIndex.get(basePascal(req));
      if (!ident || intended === undefined) { determinable = false; continue; }
      const jsx = app.content.indexOf(`<${ident}`);
      if (jsx < 0) { determinable = false; continue; }
      positioned.push({ req, jsx, intended });
    }
    if (positioned.length >= 2) {
      const byIntended = [...positioned].sort((a, b) => a.intended - b.intended);
      const outOfOrder = byIntended.some((p, i) => i > 0 && p.jsx < byIntended[i - 1].jsx);
      if (outOfOrder && determinable) addError(acc, 'section-order', 'required section components appear out of the intended order in src/App.tsx');
      else if (outOfOrder) addWarning(acc, 'section-order-unproven', 'section order could not be fully proven; a possible order mismatch was detected');
    }
  }

  // 10) Honesty warnings — proof patterns NOT present in the spec copy corpus.
  const corpus = normCopy([
    spec.prompt || '',
    ...sections.flatMap((s) => [s.headline || '', s.subheadline || '', s.primaryCTA || '', ...(s.bullets || [])]),
    ...(spec.researchEvidence?.sourceBackedInsights || []),
    ...(spec.researchEvidence?.trustSignals || []),
  ].join(' '));
  for (const { re, label } of HONESTY_PATTERNS) {
    const m = re.exec(allContent);
    if (m && !corpus.includes(normCopy(m[0]))) addWarning(acc, 'unverified-proof', `possible unverified proof claim not present in the spec copy: ${label} (${trunc(m[0], 40)})`);
  }

  // ── Assemble + decide status ────────────────────────────────────────────────
  const errors = acc.errors.slice(0, MAX_PERSISTED_ISSUES);
  const warnings = acc.warnings.slice(0, MAX_PERSISTED_ISSUES);
  const status: FrontendBuilderValidationArtifact['status'] = errors.length === 0 ? 'valid' : 'invalid';
  const ready = status === 'valid';
  const reason = ready
    ? `Static validation passed: ${files.length} files parsed, ${presentRequired}/${requiredAll.length} required + ${presentSection}/${requiredSection.length} section files present${warnings.length ? `, ${warnings.length} warning(s)` : ''}. Structural only — not compiled or rendered.`
    : `Static validation failed with ${errors.length} error(s): ${errors.slice(0, 2).map((e) => e.code).join(', ')}. Structural only — not compiled or rendered.`;

  return {
    version: 'frontend-builder-validation-v1',
    status,
    format: 'frontend-files-v1',
    sourceRawStatus: raw.status,
    didParse: true,
    readyForConsumption: ready,
    files,
    fileCount: files.length,
    totalCharCount: files.reduce((n, f) => n + f.charCount, 0),
    requiredFileCount: requiredAll.length,
    requiredSectionFileCount: requiredSection.length,
    presentRequiredFileCount: presentRequired,
    presentRequiredSectionFileCount: presentSection,
    missingRequiredFiles: capUniq(acc.missingRequiredFiles),
    missingRequiredSectionFiles: capUniq(acc.missingRequiredSectionFiles),
    duplicatePaths: capUniq(acc.duplicatePaths),
    unresolvedRelativeImports: capUniq(acc.unresolvedRelativeImports),
    unsupportedPackageImports: capUniq(acc.unsupportedPackageImports),
    unreachableRequiredSectionFiles: capUniq(acc.unreachableRequiredSectionFiles),
    missingCriticalCopy: capUniq(acc.missingCriticalCopy),
    missingSupportingCopy: capUniq(acc.missingSupportingCopy),
    forbiddenPatternMatches: capUniq(acc.forbiddenPatternMatches),
    errors,
    warnings,
    reason,
  };
}

/* ── PascalCase helpers for section-order matching (deterministic) ──────────── */
function pascalOf(id: string): string {
  return (id || '').replace(/(^|[-_ ]+)(\w)/g, (_m, _s, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');
}
function basePascal(filePath: string): string {
  const base = (filePath.split('/').pop() || '').replace(/\.[a-z]+$/i, '');
  return pascalOf(base);
}

/**
 * Parse + statically validate the raw Frontend Builder response against the Phase
 * 12A specification. Pure, deterministic, network-free, bounded, fail-open, never
 * throws. STATIC ONLY — the result never proves the project compiles or renders and
 * never replaces payload.files.
 */
export function parseAndValidateFrontendBuilderRaw(
  raw: FrontendBuilderRawArtifact,
  spec: FrontendBuildSpecification | undefined,
): FrontendBuilderValidationArtifact {
  try {
    // Prerequisites — nothing usable to validate → skipped (raw stays not-run).
    if (!raw || raw.status === 'failed' || raw.status === 'skipped') {
      return baseArtifact('skipped', raw, false, 'No completed Frontend Builder response to validate.');
    }
    if (!spec) return baseArtifact('skipped', raw, false, 'No Phase 12A specification available — no authoritative contract to validate against.');
    if (spec.status === 'failed-open') return baseArtifact('skipped', raw, false, 'The Phase 12A specification failed open — skipping validation.');

    // A 'completed' raw artifact must carry a usable, untruncated, correctly-typed body.
    if (raw.requestedFormat !== 'frontend-files-v1' || raw.mode !== 'frontend_builder') {
      const a = baseArtifact('invalid', raw, false, 'Raw artifact has an unexpected format or mode.');
      a.errors = [{ severity: 'error', code: 'bad-raw-envelope', message: 'raw artifact is not a frontend-files-v1 / frontend_builder response' }];
      return a;
    }
    if (raw.truncatedForStorage) {
      const a = baseArtifact('invalid', raw, false, 'Raw response was truncated for storage and cannot be validated safely.');
      a.errors = [{ severity: 'error', code: 'truncated-response', message: 'raw response was truncated for storage; refusing to validate a partial project' }];
      return a;
    }
    const body = typeof raw.rawResponse === 'string' ? raw.rawResponse : '';
    if (!body.trim()) {
      const a = baseArtifact('invalid', raw, false, 'Raw response is absent or empty.');
      a.errors = [{ severity: 'error', code: 'empty-response', message: 'raw response is absent or empty' }];
      return a;
    }

    const parsed = parseEnvelope(body);
    if (!parsed.ok) {
      const a = baseArtifact('invalid', raw, false, `Envelope parse failed: ${parsed.error || 'malformed frontend-files-v1 envelope'}`);
      a.errors = [{ severity: 'error', code: parsed.overflow ? 'parse-overflow' : 'malformed-envelope', message: trunc(parsed.error || 'malformed frontend-files-v1 envelope', MAX_ISSUE_MESSAGE_CHARS) }];
      return a;
    }

    return validateProject(parsed.files, spec, raw);
  } catch {
    const a = baseArtifact('invalid', raw, false, 'Internal validation error — treated as invalid (fail-open).');
    a.errors = [{ severity: 'error', code: 'internal-error', message: 'internal validation error' }];
    return a;
  }
}
