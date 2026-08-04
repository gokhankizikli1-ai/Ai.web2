/**
 * Web Build BINDING REQUIREMENT SATISFACTION + CROSS-SECTOR DRIFT analyzer (Phase 12G).
 *
 * Pure, bounded, network-free static analysis over the COMPLETE normalized generated project. It
 * consumes the SAME authoritative binding-requirements contract that drove generation and returns
 * one structured acceptance result with stable issue codes + bounded, sanitized evidence (file
 * path / module label / short reason — never full source, prompts, provider output, ids or PII).
 *
 * It is deliberately conservative and FEATURE-SCOPED: a requirement is NEVER marked satisfied just
 * because unrelated signals happen to exist somewhere in the project. Evidence is correlated within
 * a single feature scope — a component (or an import-linked parent/child pair) that actually bears
 * the requested feature. State from one unrelated file is NEVER combined with controls or output
 * from another. An interactive experience needs, WITHIN ONE SCOPE: real controls + local state +
 * event handlers + a state-derived visible output. Each named control must be backed by an actual
 * interactive element in that scope, and one control element cannot satisfy several dimensions
 * (greedy per-element assignment). A dynamic outcome needs a real control→state→output dependency
 * chain in scope. Media needs a semantically relevant rendered image (logos/icons/avatars/
 * decorative images never satisfy it). Split-across-files evidence is accepted ONLY with explicit
 * structural correlation (a parent importing/rendering the feature component, a related component
 * name, or a matching control). Weak/uncorrelated evidence returns AMBIGUOUS (manual-review) and
 * absence of correlated evidence stays BLOCKING — never a false pass. Motion is left entirely to
 * the existing motion contract. This is STATIC evidence only — it never certifies runtime behavior.
 *
 * The drift analyzer is sector-generic: software-product module clusters are forbidden only for a
 * non-software operator sector (so an actual AI-SaaS site keeps its software modules), and only a
 * correlated CLUSTER (≥2 distinct terms) or an explicit forbidden-module heading blocks — never an
 * isolated generic word (traveler "support", "secure payment", one "integration" mention are fine).
 */
import type {
  FrontendGeneratedFile, FrontendBindingRequirements,
  FrontendBuilderReviewIssue, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
} from '@/lib/webBuildAgents';
import type { ImageCoverageRequirement } from '@/lib/webBuildImageCoverage';

/* ── Bounds ───────────────────────────────────────────────────────────────── */
const MAX_SRC_CHARS = 240_000;      // total source scanned
const MAX_FILE_CHARS = 80_000;      // per-file source scanned for heavy regex passes
const MAX_UNITS = 80;               // number of files modelled
const MAX_ISSUES = 40;
const MAX_ISSUE_FILES = 4;
const MAX_EVIDENCE = 180;
const MAX_DRIFT_TERMS = 4;
const MAX_SLOTS_PER_FILE = 40;
const MAX_STATE_VARS = 40;

export type BindingIssueCode =
  | 'binding-section-missing'
  | 'binding-interaction-missing'
  | 'binding-control-missing'
  | 'binding-dynamic-outcome-missing'
  | 'binding-mobile-nav-nonfunctional'
  | 'binding-responsive-evidence-missing'
  | 'binding-media-missing'
  | 'cross-sector-semantic-drift'
  | 'requirement-evidence-ambiguous'
  // Semantic image-coverage findings (feature-scoped; reuse of the media analysis).
  | 'required-image-not-rendered'
  | 'required-image-semantically-mismatched'
  | 'required-image-uncovered';

export interface BindingIssue {
  code: BindingIssueCode;
  severity: FrontendBuilderReviewSeverity;
  requirementId?: string;
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}

export interface BindingAcceptanceResult {
  status: 'pass' | 'warning' | 'fail';
  legacyContractUsed: boolean;
  requiredCount: number;
  satisfiedCount: number;
  missingCount: number;
  ambiguousCount: number;
  interactionCount: number;
  controlCount: number;
  satisfiedControlCount: number;
  driftIssueCount: number;
  issues: BindingIssue[];
  /* ── Semantic image-coverage (present only when an image-coverage contract was analyzed). ── */
  imageCoverageStatus?: 'pass' | 'warning' | 'fail';
  requiredImageCount?: number;
  renderedRequiredImageCount?: number;
  uncoveredRequiredImageCount?: number;
}

/** Drift policy resolved at the call site from existing artifacts (sector/ledger/binding). */
export interface DriftPolicy {
  /** True for a genuine software/marketplace product sector — software modules are then ALLOWED. */
  isSoftwareSector: boolean;
  /** Bounded forbidden-module labels (e.g. the vertical profile's forbidden section labels). */
  forbiddenModuleLabels?: string[];
  /** Bounded StrategicThinkingLedger `mustNotBecome` phrases. */
  mustNotBecome?: string[];
}

const LEGACY_RESULT: BindingAcceptanceResult = {
  status: 'pass', legacyContractUsed: true,
  requiredCount: 0, satisfiedCount: 0, missingCount: 0, ambiguousCount: 0,
  interactionCount: 0, controlCount: 0, satisfiedControlCount: 0, driftIssueCount: 0, issues: [],
};

const cap = (s: string, n = MAX_EVIDENCE): string => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) : t; };
function esc(s: string): string { return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function wordRe(token: string): RegExp | null {
  const t = (token || '').trim();
  if (t.length < 3) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc(t)}(?![\\p{L}\\p{N}])`, 'iu');
}
function present(token: string, src: string): boolean { const re = wordRe(token); return !!re && re.test(src); }
function anyPresent(tokens: string[], src: string): boolean { return tokens.some((t) => present(t, src)); }

/** Significant lowercase tokens of a string for presence checks (drops short/stop tokens). */
function tokenize(s: string, minLen = 3): string[] {
  return (s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= minLen);
}
const STOP = new Set(['with', 'that', 'your', 'their', 'from', 'this', 'interactive', 'section', 'the', 'and', 'for', 'into', 'onto', 'view', 'page']);
/** Significant tokens of a label for presence checks (drops short/stop tokens). */
function labelTokens(label: string): string[] {
  return tokenize(label, 4).filter((w) => !STOP.has(w));
}
function basename(p: string): string {
  const b = (p || '').split(/[\\/]/).pop() || '';
  return b.replace(/\.[jt]sx?$/i, '').toLowerCase();
}
function uniq<T>(arr: T[]): T[] { return [...new Set(arr)]; }

/** File(s) whose content matches a token — bounded, for sanitized evidence. */
function filesMatching(files: FrontendGeneratedFile[], tokens: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (tokens.some((t) => { const re = wordRe(t); return re && re.test(f.content); })) out.push(f.path);
    if (out.length >= MAX_ISSUE_FILES) break;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * FEATURE-SCOPED FILE MODEL
 *
 * Each generated file becomes a FileUnit carrying only the evidence found INSIDE that file.
 * Correlated evidence is assembled per requirement from ONE unit (or an import-linked pair) — never
 * by unioning independent files. This is what makes cross-file false composition impossible.
 * ──────────────────────────────────────────────────────────────────────────── */

interface ControlSlot {
  tag: string;                 // select | input | textarea | custom
  tokens: string[];            // semantic tokens: id/name/aria-label/placeholder/label text/options
  drivenStateVars: string[];   // state vars this control writes (via set<Var> in its handler)
}
interface ImageInfo {
  tokens: string[];            // alt text / src filename / image-slot name / nearby caption+heading
  decorative: boolean;         // empty alt, role=presentation, or logo/icon/avatar/favicon/decoration
  content: boolean;            // a real content image (has src / slot / picture), not a pure shape
}
interface DerivedVar { name: string; refs: string[]; }
interface FileUnit {
  path: string;
  content: string;
  stateVars: string[];
  derivedVars: DerivedVar[];
  hasState: boolean;
  hasHandler: boolean;
  controls: ControlSlot[];
  controlDrivenStateVars: string[];
  renderedTokens: Set<string>;      // identifiers appearing inside JSX `{…}`
  images: ImageInfo[];
  imports: Array<{ rel: boolean; names: string[]; target: string }>;
  componentNames: string[];
  hasNav: boolean;
  hasResponsive: boolean;
}

/** state var implied by a setter, e.g. `setDestination` → `destination`. */
function stateVarFromSetter(setter: string): string { const v = setter.replace(/^set/, ''); return v ? v.charAt(0).toLowerCase() + v.slice(1) : ''; }
function settersIn(text: string): string[] {
  return uniq([...(text || '').matchAll(/\bset([A-Z][\w$]*)\s*\(/g)].map((m) => stateVarFromSetter('set' + m[1]))).filter(Boolean);
}

/** Read a JSX/HTML opening tag's attribute string, respecting quotes and `{…}` (so `=>` inside a
 *  handler does not terminate the tag early). `from` must index the tag's `<`. */
function readOpenTag(content: string, from: number): { attrs: string; end: number } | null {
  let i = from + 1;
  while (i < content.length && /[A-Za-z0-9._-]/.test(content[i])) i++;
  const attrStart = i;
  let depth = 0; let quote = '';
  for (; i < content.length; i++) {
    const ch = content[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { if (depth > 0) depth--; }
    else if (ch === '>' && depth === 0) return { attrs: content.slice(attrStart, i), end: i };
  }
  return null;
}

/** Resolve named event handlers referenced in a control's attribute string to their setter effects. */
function resolveHandlerSetters(attrs: string, fileContent: string): string[] {
  const out: string[] = [];
  const refs = [...attrs.matchAll(/\bon[A-Z]\w*\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/g)].map((m) => m[1]);
  for (const name of refs) {
    if (/^(?:e|ev|event|this)$/.test(name)) continue;
    const bodyRe = new RegExp(`(?:const|let|var|function)\\s+${esc(name)}\\s*[=(][\\s\\S]{0,600}`);
    const m = bodyRe.exec(fileContent);
    if (m) out.push(...settersIn(m[0]));
  }
  return out;
}

/** Extract real interactive control slots (select/input/textarea + custom role controls) from a file. */
function extractControls(content: string): { controls: ControlSlot[]; drivenStateVars: string[] } {
  const controls: ControlSlot[] = [];
  const driven = new Set<string>();
  // id → label text (htmlFor / for=) map.
  const labelFor = new Map<string, string>();
  for (const m of content.matchAll(/<label\b[^>]*\b(?:htmlFor|for)=["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/label>/gi)) {
    labelFor.set(m[1], m[2].replace(/<[^>]*>/g, ' '));
  }
  const elRe = /<(select|input|textarea)\b/gi;
  let em: RegExpExecArray | null;
  while ((em = elRe.exec(content)) && controls.length < MAX_SLOTS_PER_FILE) {
    const tag = em[1].toLowerCase();
    const idx = em.index;
    const tagInfo = readOpenTag(content, idx);
    if (!tagInfo) continue;
    const attrs = tagInfo.attrs;
    const win = content.slice(Math.max(0, idx - 220), Math.min(content.length, tagInfo.end + (tag === 'select' ? 900 : 320)));
    const tokens = new Set<string>();
    const attrTok = (re: RegExp) => { const mm = re.exec(attrs); if (mm) tokenize(mm[1]).forEach((t) => tokens.add(t)); };
    attrTok(/\bid=["']([^"']+)["']/i);
    attrTok(/\bname=["']([^"']+)["']/i);
    attrTok(/\baria-label=["']([^"']+)["']/i);
    attrTok(/\bplaceholder=["']([^"']+)["']/i);
    attrTok(/\bdata-(?:korvix-)?(?:control|field|dimension)=["']([^"']+)["']/i);
    const idm = /\bid=["']([^"']+)["']/i.exec(attrs);
    if (idm && labelFor.has(idm[1])) tokenize(labelFor.get(idm[1]) || '').forEach((t) => tokens.add(t));
    // wrapping label text (text of the enclosing <label> before the control)
    const wrap = /<label\b[^>]*>([\s\S]{0,160}?)$/i.exec(content.slice(Math.max(0, idx - 200), idx));
    if (wrap) tokenize(wrap[1].replace(/<[^>]*>/g, ' ')).forEach((t) => tokens.add(t));
    // option values for a <select>
    if (tag === 'select') {
      for (const om of win.matchAll(/<option\b[^>]*>([\s\S]{0,80}?)<\/option>/gi)) tokenize(om[1].replace(/<[^>]*>/g, ' ')).forEach((t) => tokens.add(t));
      for (const om of win.matchAll(/\bvalue=["']([^"']{1,60})["']/gi)) tokenize(om[1]).forEach((t) => tokens.add(t));
    }
    // setters this control drives (inline handler + named handler bodies)
    const setters = uniq([...settersIn(attrs), ...resolveHandlerSetters(attrs, content)]);
    setters.forEach((s) => driven.add(s));
    controls.push({ tag, tokens: [...tokens].filter((t) => !STOP.has(t)), drivenStateVars: setters });
  }
  // Custom controls: an element with an interaction role AND an event handler in the same tag.
  const roleRe = /<([A-Za-z][\w.]*)\b/gi; let rm: RegExpExecArray | null;
  while ((rm = roleRe.exec(content)) && controls.length < MAX_SLOTS_PER_FILE) {
    const tagInfo = readOpenTag(content, rm.index);
    if (!tagInfo) continue;
    const attrs = tagInfo.attrs;
    if (!/\brole=["'](?:tab|slider|switch|radio|option|combobox|listbox|button)["']/i.test(attrs)) continue;
    if (!/\bon[A-Z]\w*\s*=/.test(attrs)) continue;
    const tokens = new Set<string>();
    const al = /\baria-label=["']([^"']+)["']/i.exec(attrs); if (al) tokenize(al[1]).forEach((t) => tokens.add(t));
    const dv = /\bdata-[\w-]*value=["']([^"']+)["']/i.exec(attrs); if (dv) tokenize(dv[1]).forEach((t) => tokens.add(t));
    const setters = uniq([...settersIn(attrs), ...resolveHandlerSetters(attrs, content)]);
    setters.forEach((s) => driven.add(s));
    controls.push({ tag: 'custom', tokens: [...tokens].filter((t) => !STOP.has(t)), drivenStateVars: setters });
  }
  return { controls, drivenStateVars: [...driven] };
}

/** Extract semantically-labelled images (real content imagery only; decorative flagged). */
function extractImages(content: string): ImageInfo[] {
  const out: ImageInfo[] = [];
  const decoRe = /logo|favicon|avatar|\bicon\b|sprite|badge|decorat|pattern|texture|placeholder|blur|noise/i;
  const pushImg = (tokensStr: string[], src: string, alt: string | null, decorativeAttr: boolean, content = true) => {
    const tokens = new Set<string>();
    tokensStr.forEach((s) => tokenize(s).forEach((t) => tokens.add(t)));
    const decorative = decorativeAttr || alt === '' || decoRe.test(src) || (alt != null && decoRe.test(alt)) || tokensStr.some((s) => decoRe.test(s));
    out.push({ tokens: [...tokens].filter((t) => !STOP.has(t)), decorative, content });
  };
  for (const m of content.matchAll(/<img\b([^>]*)>/gi)) {
    if (out.length >= MAX_SLOTS_PER_FILE) break;
    const attrs = m[1] || '';
    const alt = (/\balt=["']([^"']*)["']/i.exec(attrs) || [])[1] ?? null;
    const src = (/\bsrc=["']([^"']*)["']/i.exec(attrs) || [])[1] || '';
    const slot = (/\bdata-korvix-image-slot=["']([^"']*)["']/i.exec(attrs) || [])[1] || '';
    const role = /\brole=["']presentation["']|aria-hidden=["']true["']/i.test(attrs);
    const idx = m.index || 0;
    const near = content.slice(idx, Math.min(content.length, idx + 300));
    const cap2 = [...near.matchAll(/<figcaption\b[^>]*>([\s\S]{0,120}?)<\/figcaption>/gi)].map((x) => x[1].replace(/<[^>]*>/g, ' '));
    const srcName = (src.split(/[\\/]/).pop() || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
    pushImg([alt || '', srcName, slot, ...cap2], src, alt, role, true);
  }
  for (const m of content.matchAll(/data-korvix-image-slot=["']([^"']+)["']/gi)) {
    if (out.length >= MAX_SLOTS_PER_FILE) break;
    pushImg([m[1].replace(/[-_]+/g, ' ')], '', null, false, true);
  }
  for (const m of content.matchAll(/background-image\s*:\s*url\(([^)]+)\)/gi)) {
    if (out.length >= MAX_SLOTS_PER_FILE) break;
    const url = m[1].replace(/["']/g, '');
    if (/gradient/i.test(m[0])) continue;
    const srcName = (url.split(/[\\/]/).pop() || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
    pushImg([srcName], url, null, false, true);
  }
  return out;
}

function buildUnit(f: FrontendGeneratedFile): FileUnit {
  const content = (f.content || '').slice(0, MAX_FILE_CHARS);
  const stateVars = uniq([...content.matchAll(/const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*set[A-Z][\w$]*\s*\]\s*=\s*use(?:State|Reducer)\b/g)].map((m) => m[1])).slice(0, MAX_STATE_VARS);
  const hasState = /\buse(?:State|Reducer|Memo)\s*\(/.test(content);
  const stateSet = new Set(stateVars);
  // Derived vars: `const X = <rhs referencing a state var>` or `const X = useMemo(...)`.
  const derivedVars: DerivedVar[] = [];
  for (const m of content.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]{0,240})/g)) {
    const name = m[1]; const rhs = m[2] || '';
    if (stateSet.has(name)) continue;
    const refs = tokenize(rhs, 1).filter((t) => stateSet.has(t));
    if (/\buseMemo\s*\(/.test(rhs) || refs.length) derivedVars.push({ name, refs: uniq(refs) });
    if (derivedVars.length >= MAX_STATE_VARS) break;
  }
  // Rendered identifiers inside JSX `{…}` interpolations.
  const renderedTokens = new Set<string>();
  for (const m of content.matchAll(/\{([^{}]{0,200})\}/g)) {
    for (const idm of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) renderedTokens.add(idm[0]);
  }
  const { controls, drivenStateVars } = extractControls(content);
  const imports: FileUnit['imports'] = [];
  for (const m of content.matchAll(/import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?[^'"]*from\s*["']([^"']+)["']/g)) {
    const names = [m[1], ...(m[2] ? m[2].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()) : [])].filter(Boolean) as string[];
    imports.push({ rel: /^[./]/.test(m[3]), names, target: m[3] });
  }
  const componentNames = uniq([...content.matchAll(/(?:function|const)\s+([A-Z][A-Za-z0-9_]*)\s*[=(]/g)].map((m) => m[1]));
  return {
    path: f.path, content, stateVars, derivedVars, hasState,
    hasHandler: /on(?:Change|Input|Click|Submit|KeyDown)\s*=|addEventListener\s*\(/.test(content),
    controls, controlDrivenStateVars: drivenStateVars,
    renderedTokens, images: extractImages(content), imports, componentNames,
    hasNav: /<nav\b|role=["']navigation["']/i.test(content),
    hasResponsive: /\b(?:sm|md|lg|xl|2xl):[a-z]/.test(content) || /@media\b/.test(content),
  };
}

/* ── Alias ↔ control-slot matching (distinctive, avoids incidental single-word hits). ── */
function aliasHitTokens(aliases: string[], slotTokens: Set<string>): boolean {
  for (const alias of aliases) {
    const toks = tokenize(alias, 3);
    if (!toks.length) continue;
    const hits = toks.filter((t) => slotTokens.has(t));
    if (toks.length === 1 && toks[0].length >= 4 && hits.length === 1) return true;
    if (toks.length >= 2 && hits.length >= 2) return true;
    if (toks.length >= 2 && hits.some((t) => t.length >= 6)) return true;
  }
  return false;
}
function controlSlotMatches(unit: FileUnit, aliases: string[]): boolean {
  return unit.controls.some((s) => aliasHitTokens(aliases, new Set(s.tokens)));
}

/* ── Scope resolution: one bearing unit, or an import-correlated parent/child pair. ── */
type ScopeTier = 'scope' | 'split' | 'ambiguous' | 'missing';
interface Scope { tier: ScopeTier; units: FileUnit[]; labelPresent: boolean; }

function unitMentions(unit: FileUnit, labelToks: string[]): number { return labelToks.filter((t) => present(t, unit.content)).length; }
function componentNameRelated(child: FileUnit, labelToks: string[]): boolean {
  if (!labelToks.length) return false;
  const nameToks = new Set(child.componentNames.flatMap((n) => n.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/)));
  const base = basename(child.path);
  return labelToks.some((t) => nameToks.has(t) || base.includes(t));
}
function correlatedChildren(parent: FileUnit, units: FileUnit[]): FileUnit[] {
  const out: FileUnit[] = [];
  for (const imp of parent.imports) {
    if (!imp.rel) continue;
    const base = basename(imp.target);
    const child = units.find((u) => u !== parent && (basename(u.path) === base || u.componentNames.some((n) => imp.names.includes(n))));
    if (child && !out.includes(child)) out.push(child);
  }
  return out.slice(0, 4);
}

function resolveScope(labelToks: string[], controlAliasSets: string[][], units: FileUnit[]): Scope {
  const need = labelToks.length ? Math.min(2, labelToks.length) : 99;
  const scored = units.map((u) => {
    const mention = unitMentions(u, labelToks);
    const mentionsLabel = labelToks.length > 0 && mention >= need;
    const ctrlMatches = controlAliasSets.filter((al) => controlSlotMatches(u, al)).length;
    const functional = u.hasState || u.controls.length > 0;
    return { u, mention, mentionsLabel, ctrlMatches, functional };
  });
  const anyLabelSomewhere = labelToks.length > 0 && scored.some((s) => s.mention >= 1);

  // Tier 1 — a single bearing unit that is functional AND is clearly the feature (label or ≥2 controls).
  const bearing = scored.filter((s) => s.functional && (s.mentionsLabel || s.ctrlMatches >= 2));
  if (bearing.length) {
    bearing.sort((a, b) => (b.ctrlMatches - a.ctrlMatches) || (b.mention - a.mention) || (b.u.controls.length - a.u.controls.length));
    const best = bearing[0].u;
    return { tier: 'scope', units: uniq([best, ...correlatedChildren(best, units)]), labelPresent: true };
  }

  // Tier 2 — import-correlated split: a parent that names the feature imports a functional child that
  // is itself feature-relevant (mentions the label, matches a control, or has a related component name).
  for (const s of scored) {
    if (!s.mentionsLabel) continue;
    const kids = correlatedChildren(s.u, units).filter((ch) => {
      const chFunctional = ch.hasState || ch.controls.length > 0;
      const rel = unitMentions(ch, labelToks) >= 1 || controlAliasSets.some((al) => controlSlotMatches(ch, al)) || componentNameRelated(ch, labelToks);
      return chFunctional && rel;
    });
    if (kids.length) return { tier: 'split', units: uniq([s.u, ...kids]), labelPresent: true };
  }

  // No correlated functional scope. Distinguish uncorrelated-but-present (ambiguous) from absent (missing).
  const weakFunctional = scored.some((s) => s.functional && s.mention >= 1);
  if (anyLabelSomewhere && weakFunctional) return { tier: 'ambiguous', units: [], labelPresent: true };
  return { tier: 'missing', units: [], labelPresent: anyLabelSomewhere };
}

/* ── In-scope executable evidence. ── */
interface ScopeEvidence { hasState: boolean; hasHandler: boolean; hasControl: boolean; hasDerivedOutput: boolean; controlDriven: string[]; outputTiedToControls: boolean; }
function scopeEvidence(units: FileUnit[]): ScopeEvidence {
  const stateVars = new Set<string>(); const rendered = new Set<string>(); const derived: DerivedVar[] = [];
  const controlDriven = new Set<string>(); let hasState = false; let hasHandler = false; let controls = 0;
  for (const u of units) {
    if (u.hasState) hasState = true;
    if (u.hasHandler) hasHandler = true;
    controls += u.controls.length;
    u.stateVars.forEach((v) => stateVars.add(v));
    u.renderedTokens.forEach((v) => rendered.add(v));
    u.derivedVars.forEach((d) => derived.push(d));
    u.controlDrivenStateVars.forEach((v) => controlDriven.add(v));
  }
  // Any state-derived visible output: a state var rendered, or a derived-of-state var rendered.
  const stateRendered = [...stateVars].some((v) => rendered.has(v));
  const derivedRendered = derived.some((d) => rendered.has(d.name) && d.refs.length > 0);
  const hasDerivedOutput = stateRendered || derivedRendered;
  // Output TIED TO THE CONTROLS: a control-driven state var rendered, or a derived var of one rendered.
  const cd = new Set(controlDriven);
  const controlStateRendered = [...cd].some((v) => rendered.has(v));
  const controlDerivedRendered = derived.some((d) => rendered.has(d.name) && d.refs.some((r) => cd.has(r)));
  return { hasState, hasHandler, hasControl: controls > 0, hasDerivedOutput, controlDriven: [...cd], outputTiedToControls: controlStateRendered || controlDerivedRendered };
}

/* ── Software-product module clusters (for cross-sector drift). A cluster fires only with ≥2
 *  DISTINCT term matches (or an explicit forbidden-module heading), never an isolated word. ── */
const SOFTWARE_CLUSTERS: Array<{ label: string; terms: string[] }> = [
  { label: 'SaaS pricing tiers', terms: ['pricing tier', 'per month', '/mo', 'per seat', 'per user/month', 'subscription plan', 'billed annually', 'choose your plan', 'free tier', 'pro plan', 'enterprise plan', 'most popular plan'] },
  { label: 'analytics dashboard', terms: ['analytics dashboard', 'metrics dashboard', 'reporting dashboard', 'real-time analytics', 'kpi', 'data dashboard', 'usage analytics'] },
  { label: 'software integrations / channel map', terms: ['integrations', 'integration map', 'channel integration', 'native integrations', 'connect your tools', 'works with your stack', 'omnichannel', '1-click integration'] },
  { label: 'API / developer docs', terms: ['api documentation', 'api reference', 'rest api', 'graphql api', 'api key', 'sdk', 'developer docs', 'endpoint', 'curl -x'] },
  { label: 'CRM workflow', terms: ['crm', 'sales pipeline', 'deal stage', 'lead scoring', 'contact management', 'pipeline stage'] },
  { label: 'answer routing', terms: ['answer routing', 'intent routing', 'routing engine', 'route questions', 'ticket routing', 'auto-routing'] },
  { label: 'support handoff flow', terms: ['support handoff', 'human handoff', 'agent handoff', 'escalate to agent', 'handoff to a human', 'live agent handoff'] },
  { label: 'knowledge-base product demo', terms: ['knowledge base', 'kb article', 'help center demo', 'self-serve articles', 'article search', 'searchable knowledge'] },
  { label: 'security & compliance product', terms: ['soc 2', 'soc2', 'iso 27001', 'gdpr compliant', 'hipaa', 'compliance dashboard', 'enterprise-grade security', 'security & compliance', 'compliance certifications'] },
];

function analyzeDrift(files: FrontendGeneratedFile[], src: string, policy: DriftPolicy | undefined): BindingIssue[] {
  const issues: BindingIssue[] = [];
  if (!policy) return issues;
  const forbiddenLabels = (policy.forbiddenModuleLabels || []).map((s) => s.toLowerCase());
  const mustNot = (policy.mustNotBecome || []).map((s) => s.toLowerCase());
  for (const cluster of SOFTWARE_CLUSTERS) {
    // A software module cluster is only a DRIFT problem for a non-software operator sector.
    if (policy.isSoftwareSector) continue;
    const matched = cluster.terms.filter((t) => src.includes(t.toLowerCase()));
    // Strong heading signal: the vertical policy / mustNotBecome explicitly forbids this module.
    const explicitlyForbidden = forbiddenLabels.some((l) => cluster.label.split(' ').some((w) => w.length > 3 && l.includes(w)))
      || mustNot.some((l) => cluster.label.split(' ').some((w) => w.length > 3 && l.includes(w)));
    // Block only on a correlated cluster (≥2 distinct terms) OR an explicit forbid + ≥1 term.
    if (matched.length >= 2 || (explicitlyForbidden && matched.length >= 1)) {
      issues.push({
        code: 'cross-sector-semantic-drift',
        severity: 'blocker',
        label: cluster.label,
        files: filesMatching(files, cluster.terms),
        evidence: cap(`software-product module "${cluster.label}" detected on a non-software (${policy.isSoftwareSector ? 'software' : 'operator'}) site — correlated terms: ${matched.slice(0, MAX_DRIFT_TERMS).join(', ')}`),
        repairInstruction: cap(`Remove the "${cluster.label}" software-product module and replace it with a section appropriate to this business; keep normal supportive copy (e.g. traveler support, secure payment) but do not adopt the software archetype.`),
      });
      if (issues.length >= MAX_ISSUES) break;
    }
  }
  return issues;
}

/* ── Semantic image-coverage acceptance (feature-scoped; reuses the media image model) ───────────
 * For a `required`/`image-led` coverage contract, prove that EACH required semantic image is a
 * rendered, non-decorative, semantically-relevant content image — never a logo/avatar/icon, an
 * unused manifest asset, a URL that only appears in a constant, or one unrelated photo reused for
 * every purpose (greedy per-target assignment). Absent/`none`/`optional`/explicit-no-photo ⇒ no
 * findings (so explicit typography-only and software/dashboard builds are never blocked). Pure. */
interface ImageCoverageAnalysis { issues: BindingIssue[]; required: number; rendered: number; uncovered: number; }
function analyzeImageCoverage(
  units: FileUnit[], list: FrontendGeneratedFile[], srcLower: string,
  coverage: ImageCoverageRequirement | undefined,
): ImageCoverageAnalysis {
  const empty: ImageCoverageAnalysis = { issues: [], required: 0, rendered: 0, uncovered: 0 };
  if (!coverage || coverage.explicitNoPhoto) return empty;
  if (coverage.mode !== 'required' && coverage.mode !== 'image-led') return empty;
  const requiredTargets = (coverage.targets || []).filter((t) => t.required);
  if (!requiredTargets.length) return empty;

  // Rendered, non-decorative content images available across the project (greedy pool).
  const pool = units.flatMap((u) => u.images).filter((im) => im.content && !im.decorative).map((im) => ({ im, used: false }));
  const anyContentImages = pool.length > 0;
  const issues: BindingIssue[] = [];
  let rendered = 0; let uncovered = 0;

  for (const t of requiredTargets) {
    const exp = new Set<string>();
    for (const a of (t.aliases || [])) tokenize(a, 3).forEach((x) => exp.add(x));
    labelTokens(t.label).forEach((x) => exp.add(x));
    tokenize(t.query, 3).forEach((x) => exp.add(x));
    // Purpose/section words help match a relevant image; drop generic stop tokens.
    [...exp].filter((x) => STOP.has(x)).forEach((x) => exp.delete(x));

    const hit = pool.find((p) => !p.used && p.im.tokens.some((tok) => exp.has(tok)));
    if (hit) { hit.used = true; rendered += 1; continue; }

    uncovered += 1;
    const approved = t.matchStatus === 'sourced';
    const label = t.label || t.purpose;
    if (approved && !anyContentImages) {
      issues.push({ code: 'required-image-not-rendered', severity: 'major', requirementId: t.id, label,
        files: filesMatching(list, ['img', 'image', 'picture']),
        evidence: cap(`required image "${label}" has an approved sourced asset but no rendered semantic <img>/picture consumes it — a URL hidden in a constant or unused manifest asset does not count`),
        repairInstruction: cap(`Render the approved image for "${label}" as a real semantic <img> (or a single permitted background image) in its intended section, using the provided url + data-korvix-image-slot; do not leave it unused.`) });
    } else if (anyContentImages) {
      issues.push({ code: 'required-image-semantically-mismatched', severity: 'major', requirementId: t.id, label,
        files: filesMatching(list, ['img', 'image', 'picture']),
        evidence: cap(`required image "${label}" is not satisfied — the rendered content images are not semantically relevant to it (a logo/avatar/icon, a decorative shape, or one unrelated photo reused for every section does not satisfy a distinct semantic purpose)`),
        repairInstruction: cap(`Render a distinct, semantically-relevant image for "${label}" (matching alt/source/slot text); do not reuse one unrelated photo for multiple required purposes.`) });
    } else {
      issues.push({ code: 'required-image-uncovered', severity: 'major', requirementId: t.id, label,
        files: [],
        evidence: cap(`required image "${label}" is uncovered — no relevant rendered imagery, and stock/AI fallback produced no safe persistable asset${t.failureReason ? ` (${t.failureReason})` : ''}`),
        repairInstruction: cap(`Provide a real, semantically-relevant image for "${label}" (stock or manual upload); a gradient, CSS shape, logo or icon does not satisfy required photography.`) });
    }
  }
  return { issues, required: requiredTargets.length, rendered, uncovered };
}

/**
 * Run the deterministic binding-satisfaction + cross-sector-drift + image-coverage analysis over the
 * COMPLETE generated project. `binding` undefined ⇒ legacy binding result, but drift AND image
 * coverage can still be enforced when their inputs are supplied. Pure.
 */
export function analyzeBindingAcceptance(
  files: FrontendGeneratedFile[] | undefined,
  binding: FrontendBindingRequirements | undefined,
  policy?: DriftPolicy,
  coverage?: ImageCoverageRequirement,
): BindingAcceptanceResult {
  try {
    if (!binding || !Array.isArray(binding.requirements) || binding.requirements.length === 0) {
      // No binding contract, but drift AND image coverage can still be enforced from their inputs.
      const listNB = Array.isArray(files) ? files : [];
      const srcLowerNB = listNB.map((f) => f.content).join('\n').slice(0, MAX_SRC_CHARS).toLowerCase();
      const driftOnly = analyzeDrift(listNB, srcLowerNB, policy);
      const cov = analyzeImageCoverage(listNB.slice(0, MAX_UNITS).map(buildUnit), listNB, srcLowerNB, coverage);
      const covFields = cov.required
        ? { imageCoverageStatus: (cov.uncovered ? 'fail' : 'pass') as 'fail' | 'pass', requiredImageCount: cov.required, renderedRequiredImageCount: cov.rendered, uncoveredRequiredImageCount: cov.uncovered }
        : {};
      const allIssues = [...driftOnly, ...cov.issues].slice(0, MAX_ISSUES);
      if (allIssues.length) {
        const blockingNB = allIssues.some((i) => i.severity === 'blocker' || i.code === 'cross-sector-semantic-drift' || i.code.startsWith('required-image-'));
        return { ...LEGACY_RESULT, legacyContractUsed: !binding, status: blockingNB ? 'fail' : 'warning', driftIssueCount: driftOnly.length, issues: allIssues, ...covFields };
      }
      return { ...LEGACY_RESULT, legacyContractUsed: !binding, ...covFields };
    }
    const list = Array.isArray(files) ? files : [];
    const src = list.map((f) => f.content).join('\n').slice(0, MAX_SRC_CHARS);
    const srcLower = src.toLowerCase();
    const units = list.slice(0, MAX_UNITS).map(buildUnit);
    const anyResponsive = units.some((u) => u.hasResponsive);
    const issues: BindingIssue[] = [];

    let satisfied = 0; let missing = 0; let ambiguous = 0;
    let satisfiedControls = 0; let controlTotal = 0;
    const push = (i: BindingIssue) => { if (issues.length < MAX_ISSUES) issues.push(i); };

    // The primary interactive feature scope — reused to correlate its dynamic outcome.
    let primaryScope: FileUnit[] | null = null;

    const controlAliasSetsOf = (req: FrontendBindingRequirements['requirements'][number]): string[][] =>
      (req.controls || []).map((c) => (c.aliases && c.aliases.length ? c.aliases : [c.label]));

    for (const req of binding.requirements) {
      if (!req.required) continue;
      switch (req.kind) {
        case 'interactive-experience': {
          const labelToks = labelTokens(req.label);
          const ctrlSets = controlAliasSetsOf(req);
          const scope = resolveScope(labelToks, ctrlSets, units);
          const files0 = filesMatching(list, labelToks);
          const ctrls = req.controls || [];
          controlTotal += ctrls.length;

          if (scope.tier === 'missing') {
            missing += 1;
            push({ code: 'binding-interaction-missing', severity: 'blocker', requirementId: req.id, label: req.label, files: files0,
              evidence: cap(`interactive experience "${req.label}" ${scope.labelPresent ? 'appears as a heading/label only' : 'is absent'} — no correlated component with controls, state and handlers was found (unrelated state or inputs elsewhere in the project do NOT satisfy it)`),
              repairInstruction: cap(`Implement "${req.label}" as ONE real stateful tool: actual form controls, local component state (useState/useReducer), change/click handlers, and a visible output derived from those controls' state — all inside the same feature component. A heading, or unrelated inputs in other components, do not satisfy it.`) });
            // Every required control is unmet when there is no functional scope.
            for (const c of ctrls) {
              missing += 1;
              push({ code: 'binding-control-missing', severity: 'major', requirementId: req.id, label: `${req.label} · ${c.label}`, files: files0,
                evidence: cap(`required control "${c.label}" for "${req.label}" has no interactive element in a correlated feature scope`),
                repairInstruction: cap(`Add a distinct, labelled, keyboard-usable control for "${c.label}" inside the "${req.label}" component.`) });
            }
            break;
          }
          if (scope.tier === 'ambiguous') {
            ambiguous += 1;
            push({ code: 'requirement-evidence-ambiguous', severity: 'minor', requirementId: req.id, label: req.label, files: files0,
              evidence: cap(`interactive experience "${req.label}": functional code exists but could not be correlated to this feature (label and controls live in unrelated components / no import link) — manual review, not a pass`),
              repairInstruction: cap(`Co-locate "${req.label}" — put its controls, state and derived output in one component (or a component the feature section imports and renders), so the interactivity is provably part of this feature.`) });
            break;
          }
          // Correlated scope (single unit or import-linked split) — evaluate WITHIN scope only.
          if (scope.tier === 'scope' && !primaryScope) primaryScope = scope.units;
          const ev = scopeEvidence(scope.units);
          const scopeFiles = scope.units.map((u) => u.path).slice(0, MAX_ISSUE_FILES);
          const evCount = [ev.hasState, ev.hasHandler, ev.hasControl, ev.hasDerivedOutput].filter(Boolean).length;
          if (evCount >= 3 && ev.hasDerivedOutput) {
            satisfied += 1;
          } else {
            ambiguous += 1;
            push({ code: 'requirement-evidence-ambiguous', severity: 'minor', requirementId: req.id, label: req.label, files: scopeFiles,
              evidence: cap(`interactive experience "${req.label}" is partially implemented in scope (state=${ev.hasState}, handler=${ev.hasHandler}, controls=${ev.hasControl}, state-derived output=${ev.hasDerivedOutput})`),
              repairInstruction: cap(`Complete "${req.label}" in its component: real controls + local state + change handlers AND a visible output that is derived from that state.`) });
          }

          // Controls — greedy per-element assignment: one control element cannot cover two dimensions.
          const slots = scope.units.flatMap((u) => u.controls).map((s) => ({ s, used: false }));
          for (const c of ctrls) {
            const aliases = c.aliases && c.aliases.length ? c.aliases : [c.label];
            const slot = slots.find((x) => !x.used && aliasHitTokens(aliases, new Set(x.s.tokens)));
            if (slot) { slot.used = true; satisfiedControls += 1; continue; }
            missing += 1;
            push({ code: 'binding-control-missing', severity: 'major', requirementId: req.id, label: `${req.label} · ${c.label}`, files: scopeFiles,
              evidence: cap(`required control "${c.label}" for "${req.label}" was not backed by a distinct interactive element in the feature scope (copy that merely names it, or another control already used for a different dimension, does not count)`),
              repairInstruction: cap(`Add a distinct, labelled, keyboard-usable control for "${c.label}" inside "${req.label}"; one input cannot satisfy several dimensions.`) });
          }
          break;
        }
        case 'dynamic-outcome': {
          const labelToks = labelTokens(req.label);
          const scope = resolveScope(labelToks, [], units);
          const scopeUnits = (scope.tier === 'scope' || scope.tier === 'split') ? scope.units : (primaryScope || []);
          const ev = scopeUnits.length ? scopeEvidence(scopeUnits) : null;
          const ok = !!ev && ev.hasState && ev.hasHandler && ev.controlDriven.length > 0 && ev.outputTiedToControls;
          if (ok) { satisfied += 1; }
          else {
            missing += 1;
            const detail = ev
              ? `state=${ev.hasState}, handler=${ev.hasHandler}, control-driven state=${ev.controlDriven.length > 0}, output tied to controls=${ev.outputTiedToControls}`
              : 'no correlated interactive feature scope found';
            push({ code: 'binding-dynamic-outcome-missing', severity: 'blocker', requirementId: req.id, label: req.label, files: (scopeUnits.map((u) => u.path).slice(0, MAX_ISSUE_FILES)),
              evidence: cap(`dynamic outcome "${req.label}" is not proven to depend on the controls (${detail}) — static text, an animation, an unrelated rendered value, or a tab/carousel does not count`),
              repairInstruction: cap(`Make "${req.label}" recompute from the control state and render the derived value; changing a control must visibly change this output (control → setState → derived value → rendered JSX).`) });
          }
          break;
        }
        case 'section': {
          const tokens = labelTokens(req.label);
          const aliasTokens = (req.aliases && req.aliases.length ? req.aliases : []).concat(tokens);
          const ctaLike = /call-to-action|cta/i.test(req.label);
          const ok = ctaLike ? /<(?:a|button)\b/i.test(src) : (tokens.length === 0 ? true : anyPresent(aliasTokens, src));
          if (ok) { satisfied += 1; }
          else {
            missing += 1;
            push({ code: 'binding-section-missing', severity: 'major', requirementId: req.id, label: req.label, files: [],
              evidence: cap(`required section "${req.label}" was not found as a real rendered section`),
              repairInstruction: cap(`Add a materially-implemented "${req.label}" section (real structure and content), not just a heading.`) });
          }
          break;
        }
        case 'behavior-navigation': {
          const workingNav = units.find((u) => u.hasNav && u.hasState && u.hasHandler
            && /(isopen|menuopen|navopen|mobilemenu|showmenu|drawer|toggle|open)/i.test(u.content));
          const hasHamburger = units.some((u) => /hamburger|menu[- ]?(?:icon|button|toggle)|aria-label=["'][^"']*menu/i.test(u.content));
          if (workingNav) { satisfied += 1; }
          else if (hasHamburger) {
            missing += 1;
            push({ code: 'binding-mobile-nav-nonfunctional', severity: 'major', requirementId: req.id, label: req.label, files: filesMatching(list, ['nav', 'menu']),
              evidence: cap('a mobile menu icon exists but no single component ties toggle state + handler + a nav panel together — the navigation is non-functional'),
              repairInstruction: cap('Wire the mobile menu to component state (open/close) and toggle a real navigation panel in the same component; an icon alone is not working navigation.') });
          } else {
            ambiguous += 1;
            push({ code: 'requirement-evidence-ambiguous', severity: 'minor', requirementId: req.id, label: req.label, files: [],
              evidence: cap('working navigation requested but no clear nav toggle/panel evidence was found in any single component'),
              repairInstruction: cap('Add a real, stateful (mobile) navigation with a toggle and a nav panel in one component.') });
          }
          break;
        }
        case 'behavior-responsive': {
          if (anyResponsive) { satisfied += 1; }
          else {
            ambiguous += 1;
            push({ code: 'binding-responsive-evidence-missing', severity: 'minor', requirementId: req.id, label: req.label, files: [],
              evidence: cap('no static responsive evidence (Tailwind breakpoints / @media) found — static evidence only, not runtime proof'),
              repairInstruction: cap('Add responsive CSS (breakpoint utilities or media queries) so the layout adapts on mobile.') });
          }
          break;
        }
        case 'media': {
          const reqTokens = new Set<string>([...labelTokens(req.label), ...(req.aliases || []).flatMap((a) => tokenize(a, 3))]);
          const allImages = units.flatMap((u) => u.images);
          const contentImages = allImages.filter((im) => im.content && !im.decorative);
          const relevant = contentImages.find((im) => im.tokens.some((t) => reqTokens.has(t)));
          if (relevant) { satisfied += 1; }
          else if (contentImages.length > 0) {
            // Real imagery exists but none is provably relevant to THIS media requirement.
            ambiguous += 1;
            push({ code: 'requirement-evidence-ambiguous', severity: 'minor', requirementId: req.id, label: req.label, files: filesMatching(list, ['img', 'image', 'picture']),
              evidence: cap(`media "${req.label}" required — content images exist but none has alt/source/slot text relevant to "${req.label}" (a generic/unrelated photo cannot be confirmed as the requested imagery)`),
              repairInstruction: cap(`Render imagery clearly for "${req.label}" — give it descriptive alt text or an image-slot name that reflects "${req.label}" so its relevance is unambiguous.`) });
          } else {
            missing += 1;
            push({ code: 'binding-media-missing', severity: 'major', requirementId: req.id, label: req.label, files: [],
              evidence: cap(`explicit media "${req.label}" required but no relevant rendered content imagery was found — a logo, icon, avatar, decorative shape or gradient does not satisfy it`),
              repairInstruction: cap(`Render real, semantically-relevant imagery for "${req.label}" (a content <img>/picture/background image or provided asset slot with matching alt/slot text); do not substitute a logo, icon, gradient or CSS orb.`) });
          }
          break;
        }
        // 'motion' is enforced by the existing motion contract; 'frontend-only' and 'prohibition'
        // are enforced via the generation contract + drift analysis. They are not re-checked here.
        default:
          satisfied += 1;
          break;
      }
    }

    // ── Cross-sector semantic drift. ──
    const driftIssues = analyzeDrift(list, srcLower, policy);
    for (const d of driftIssues) push(d);

    // ── Semantic image coverage (reuses the media image model; feature-scoped, greedy). ──
    const coverageAnalysis = analyzeImageCoverage(units, list, srcLower, coverage);
    for (const c of coverageAnalysis.issues) push(c);

    const blocking = issues.some((i) => i.severity === 'blocker'
      || i.code === 'binding-control-missing' || i.code === 'binding-media-missing'
      || i.code === 'binding-section-missing' || i.code === 'binding-mobile-nav-nonfunctional'
      || i.code === 'required-image-not-rendered' || i.code === 'required-image-semantically-mismatched'
      || i.code === 'required-image-uncovered');
    const warned = issues.some((i) => i.code === 'requirement-evidence-ambiguous' || i.code === 'binding-responsive-evidence-missing');
    const status: BindingAcceptanceResult['status'] = blocking ? 'fail' : warned ? 'warning' : 'pass';

    const requiredCount = binding.requirements.filter((r) => r.required && r.kind !== 'motion' && r.kind !== 'frontend-only' && r.kind !== 'prohibition').length
      + controlTotal;
    return {
      status,
      legacyContractUsed: false,
      requiredCount,
      satisfiedCount: satisfied,
      missingCount: missing,
      ambiguousCount: ambiguous,
      interactionCount: binding.counts.interaction,
      controlCount: controlTotal,
      satisfiedControlCount: satisfiedControls,
      driftIssueCount: driftIssues.length,
      issues: issues.slice(0, MAX_ISSUES),
      ...(coverageAnalysis.required
        ? { imageCoverageStatus: (coverageAnalysis.uncovered ? 'fail' : 'pass') as 'fail' | 'pass',
            requiredImageCount: coverageAnalysis.required, renderedRequiredImageCount: coverageAnalysis.rendered,
            uncoveredRequiredImageCount: coverageAnalysis.uncovered }
        : {}),
    };
  } catch {
    // Fail-open: never break the build. Treat as legacy (no blocking findings) on internal error.
    return { ...LEGACY_RESULT, legacyContractUsed: !binding };
  }
}

/** True when the result carries a blocking finding that must prevent model-native acceptance. */
export function hasBlockingBindingFindings(result: BindingAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

/* ── Map binding issues → the existing review-issue shape for the SINGLE existing repair. ── */
const CODE_CATEGORY: Record<BindingIssueCode, FrontendBuilderReviewCategory> = {
  'binding-section-missing': 'contract-fidelity',
  'binding-interaction-missing': 'contract-fidelity',
  'binding-control-missing': 'contract-fidelity',
  'binding-dynamic-outcome-missing': 'contract-fidelity',
  'binding-mobile-nav-nonfunctional': 'responsive-intent',
  'binding-responsive-evidence-missing': 'responsive-intent',
  'binding-media-missing': 'component-composition',
  'cross-sector-semantic-drift': 'concept-drift',
  'requirement-evidence-ambiguous': 'maintainability',
  'required-image-not-rendered': 'component-composition',
  'required-image-semantically-mismatched': 'component-composition',
  'required-image-uncovered': 'component-composition',
};

export function bindingIssuesToReviewIssues(result: BindingAcceptanceResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    // Ambiguous (manual-review) findings are advisory — they do not enter the repair as blockers.
    if (issue.code === 'requirement-evidence-ambiguous') continue;
    out.push({
      id: `binding-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: CODE_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: cap(issue.evidence),
      repairInstruction: cap(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

/** Bounded issue codes for owner diagnostics (deduped). */
export function bindingIssueCodes(result: BindingAcceptanceResult | undefined): string[] {
  if (!result) return [];
  return [...new Set(result.issues.map((i) => i.code))].slice(0, 16);
}
