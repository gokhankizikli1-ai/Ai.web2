/**
 * Web Build DETERMINISTIC OPTIMIZATION PASS (Quality V2).
 *
 * A pure, network-free, ZERO-model-call analysis of the generated model-native project that
 * produces MEASURABLE efficiency findings. It is the "optimize" stage of the Quality V2 loop:
 *
 *   generated project → deterministic optimization analysis → ONE consolidated advisory review
 *     issue → the EXISTING bounded repair (lowest priority) → the EXISTING acceptance gates
 *
 * DESIGN CONSTRAINTS (deliberate, and enforced by the tests):
 *   • It creates NO second repair engine, NO second evaluator and NO provider call. Every finding
 *     is derived from the generated source with plain string/AST-lite analysis.
 *   • Findings are ADVISORY ONLY. They map to a single `minor` review issue in the NEW
 *     `performance` category, so `mergeDeterministicIssues` can only ever add ONE of them and
 *     only when there is room left after every blocker / gate-critical obligation. A performance
 *     finding can therefore NEVER displace a P0–P5 obligation, and can never block acceptance.
 *   • Every finding carries MEASURED evidence (counts / characters / paths) — never an estimate,
 *     never a fabricated score, never a synthetic Web Vital.
 *   • Strong evidence only. Every detector is written to under-report rather than over-report,
 *     because a false "remove this import" instruction sent to the repair model is far more
 *     expensive than a missed optimization.
 *   • FAIL-OPEN: any internal error yields an empty report, so a build is never affected.
 *
 * It deliberately does NOT: rewrite the project, redesign anything, introduce caching, remove
 * requested visual effects, or change architecture. It only reports what is provably wasteful.
 *
 * ── EXPERIENCE-INTELLIGENCE GUARD (optional) ────────────────────────────────────────────────
 * When the caller supplies an `OptimizationGuardPolicy` (derived from the build's Experience
 * Intelligence contract) this pass gains TWO things and loses none of its previous behaviour:
 *
 *   PROTECTION  Findings whose only available remedy would damage a higher-order goal are never
 *               raised. A planned section/screen component is never reported as a deletable dead
 *               file, and a required lead image is never reported as a lazy-loading candidate.
 *               Those suppressions are COUNTED (`measured.guardSuppressedCount`) so the report
 *               stays honest about what it chose not to say.
 *
 *   BUDGETS     Three additional MEASURED findings compare the generated source against the
 *               budgets the design was actually planned against: first-viewport media weight,
 *               looping-animation count and blur/effect layer count. They are advisory like every
 *               other finding and ride the SAME single consolidated issue.
 *
 * Without a policy the analysis is byte-for-byte what it was before: the three budget codes are
 * never emitted, no finding is suppressed, and the new `measured` fields stay undefined.
 */
import type {
  FrontendGeneratedFile, FrontendBuilderReviewIssue,
  WebBuildOptimizationReport, WebBuildOptimizationFinding, WebBuildOptimizationCode,
} from '@/lib/webBuildAgents';
// Experience Intelligence supplies the OPTIMIZATION GUARD POLICY: the protected surfaces/media
// this analysis may never propose removing, plus the motion / above-the-fold / effect budgets the
// design was planned against. Type-only — this module still performs no IO and calls nothing.
import type { OptimizationGuardPolicy } from '@/lib/experienceIntelligence';

/* ── Thresholds. Set high on purpose: a finding must be obvious to a human reviewer. ────────── */
/** A declaration body must be at least this long before repetition is worth consolidating. */
const CSS_DUP_MIN_BODY_CHARS = 60;
/** How many identical CSS declaration bodies before it is worth reporting. */
const CSS_DUP_MIN_OCCURRENCES = 3;
/** A className literal must be at least this long before repetition is worth extracting. */
const CLASS_DUP_MIN_CHARS = 40;
/** How many identical long className literals before it is worth reporting. */
const CLASS_DUP_MIN_OCCURRENCES = 4;
/** A remote image asking for at least this many pixels on one axis is oversized for the web. */
const OVERSIZED_IMAGE_PX = 2000;
/** How many attribute-less nested wrappers before the DOM is provably over-wrapped. */
const WRAPPER_MIN_OCCURRENCES = 6;
/** Hard bound on the findings retained (ranked by measured magnitude). */
const MAX_FINDINGS = 12;
/** How many findings are described inside the single consolidated repair instruction. */
const MAX_FINDINGS_IN_ISSUE = 4;
/** Hard bound on the consolidated repair instruction. Raised from the previous inline 240 to
 *  360 so the preservation clause and at least one concrete fix always fit together; still a
 *  fraction of one issue's share of the request and well inside the existing size guards. */
const MAX_REPAIR_INSTRUCTION_CHARS = 360;

/** Severity weight used only for ranking findings for reporting. Never a build score. */
const SEVERITY_RANK: Record<WebBuildOptimizationFinding['severity'], number> = { high: 0, medium: 1, low: 2 };

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Strip block + line comments and string/template literals so identifier scans do not match
 *  text inside copy. Conservative: on any doubt it keeps the original text (fail-open). */
function stripNoise(src: string): string {
  try {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
      .replace(/`(?:\\[\s\S]|[^\\`])*`/g, ' ')
      .replace(/"(?:\\[\s\S]|[^\\"])*"/g, ' ')
      .replace(/'(?:\\[\s\S]|[^\\'])*'/g, ' ');
  } catch {
    return src;
  }
}

/* ── 1) Dead imports ────────────────────────────────────────────────────────────────────────
 * An imported binding that never appears again in the file body. Skips side-effect imports,
 * `import type` (erased at build time anyway), and `React` (the automatic JSX runtime makes a
 * bare `React` import legitimately unreferenced in source). */
const IMPORT_RE = /^[ \t]*import\s+(?!type\s)([\s\S]*?)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm;

function importedBindings(statementBody: string): string[] {
  const out: string[] = [];
  // `* as Ns`
  const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(statementBody);
  if (ns) out.push(ns[1]);
  // Named `{ a, b as c }` — the LOCAL name is what must be referenced.
  const named = /\{([\s\S]*?)\}/.exec(statementBody);
  if (named) {
    for (const part of named[1].split(',')) {
      const p = part.trim();
      if (!p || p.startsWith('type ')) continue;          // inline type specifier — erased
      const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(p);
      const name = alias ? alias[1] : p;
      if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push(name);
    }
  }
  // Default import — the leading identifier before any `,` or `{`.
  const def = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(statementBody.replace(/\{[\s\S]*?\}/g, ''));
  if (def) out.push(def[1]);
  return Array.from(new Set(out));
}

function findDeadImports(files: FrontendGeneratedFile[]): { file: string; names: string[] }[] {
  const out: { file: string; names: string[] }[] = [];
  for (const f of files) {
    if (f.language === 'css') continue;
    // Import statements are removed FIRST, then string/comment noise. Doing it the other way
    // round would blank the module specifier, so the statement would no longer match IMPORT_RE
    // and every imported name would look "used" by its own import line.
    const body = stripNoise(f.content.replace(IMPORT_RE, ' '));
    const dead: string[] = [];
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(f.content)) !== null) {
      for (const name of importedBindings(m[1])) {
        if (name === 'React') continue;                    // automatic JSX runtime
        const used = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(body);
        if (!used) dead.push(name);
      }
    }
    if (dead.length) out.push({ file: f.path, names: Array.from(new Set(dead)).slice(0, 8) });
  }
  return out;
}

/* ── 2) Unreferenced component files ────────────────────────────────────────────────────────
 * A component under src/components/ or src/sections/ whose name is never mentioned by any OTHER
 * file. `src/screens/` is deliberately EXCLUDED — the existing validator already reports
 * `unwired-screen` for app screens, and duplicating it would double-charge the repair budget. */
function findUnreferencedComponents(files: FrontendGeneratedFile[]): string[] {
  const candidates = files.filter(
    (f) => f.language !== 'css' && /^src\/(components|sections)\/[^/]+\.tsx?$/.test(f.path),
  );
  const out: string[] = [];
  for (const c of candidates) {
    const name = (c.path.split('/').pop() || '').replace(/\.tsx?$/, '');
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    const re = new RegExp(`\\b${name}\\b`);
    const referenced = files.some((f) => f.path !== c.path && re.test(f.content));
    if (!referenced) out.push(c.path);
  }
  return out;
}

/* ── 3) Duplicate CSS declaration bodies ────────────────────────────────────────────────────
 * Identical declaration bodies repeated across selectors. Reports the REAL character count that
 * consolidation would remove (occurrences beyond the first). */
function findDuplicateCss(files: FrontendGeneratedFile[]): { bodies: number; occurrences: number; wastedChars: number } {
  let occurrences = 0;
  let wastedChars = 0;
  let bodies = 0;
  const counts = new Map<string, { n: number; chars: number }>();
  for (const f of files) {
    if (f.language !== 'css') continue;
    const re = /\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) {
      const norm = m[1].replace(/\s+/g, ' ').trim();
      if (norm.length < CSS_DUP_MIN_BODY_CHARS) continue;
      const prev = counts.get(norm);
      if (prev) prev.n += 1;
      else counts.set(norm, { n: 1, chars: norm.length });
    }
  }
  for (const { n, chars } of counts.values()) {
    if (n < CSS_DUP_MIN_OCCURRENCES) continue;
    bodies += 1;
    occurrences += n;
    wastedChars += chars * (n - 1);
  }
  return { bodies, occurrences, wastedChars };
}

/* ── 4) Duplicate long className literals ───────────────────────────────────────────────────
 * The same long utility-class string repeated many times. Consolidating it into one shared class
 * is a genuine, safe size win that does NOT change the design. */
function findDuplicateClassLiterals(files: FrontendGeneratedFile[]): { literals: number; occurrences: number; wastedChars: number } {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.language === 'css') continue;
    const re = /className\s*=\s*"([^"]{20,})"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) {
      const norm = m[1].replace(/\s+/g, ' ').trim();
      if (norm.length < CLASS_DUP_MIN_CHARS) continue;
      counts.set(norm, (counts.get(norm) || 0) + 1);
    }
  }
  let literals = 0;
  let occurrences = 0;
  let wastedChars = 0;
  for (const [lit, n] of counts) {
    if (n < CLASS_DUP_MIN_OCCURRENCES) continue;
    literals += 1;
    occurrences += n;
    wastedChars += lit.length * (n - 1);
  }
  return { literals, occurrences, wastedChars };
}

/* ── 5) Image loading hygiene ───────────────────────────────────────────────────────────────
 * Counts real `<img>` tags and the subset that (a) sit outside the hero yet load eagerly, and
 * (b) request an enormous remote source. Both are measurable payload facts, not opinions. */
function findImageIssues(
  files: FrontendGeneratedFile[],
  heroComponentPath: string | undefined,
  protectedSlotIds: string[],
  leadVisualRequired: boolean,
): { total: number; eagerOffscreen: number; oversized: number; oversizedPaths: string[]; eagerPaths: string[]; suppressed: number } {
  let total = 0;
  let eagerOffscreen = 0;
  let oversized = 0;
  let suppressed = 0;
  const oversizedPaths = new Set<string>();
  const eagerPaths = new Set<string>();
  for (const f of files) {
    if (f.language === 'css') continue;
    const isHero = !!heroComponentPath && f.path === heroComponentPath;
    const re = /<img\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) {
      const tag = m[0];
      total += 1;
      // GUARD — a REQUIRED coverage image is load-critical evidence, not decoration. When the
      // experience direction says the lead visual is required, an image carrying one of those
      // protected slot ids is never reported as a lazy-loading candidate: telling the repair to
      // defer it would trade the first meaningful paint of the product's own subject for bytes.
      const isProtectedSlot = leadVisualRequired && protectedSlotIds.some((id) => id && tag.includes(id));
      // Eager offscreen media — the hero is legitimately eager, everything else should be lazy.
      if (!isHero && !/\bloading\s*=/.test(tag)) {
        if (isProtectedSlot) suppressed += 1;
        else {
          eagerOffscreen += 1;
          eagerPaths.add(f.path);
        }
      }
      // An explicit remote request for a 2000px+ asset.
      const dims = /[?&](?:w|width|h|height)=(\d{3,5})/gi;
      let d: RegExpExecArray | null;
      while ((d = dims.exec(tag)) !== null) {
        if (Number(d[1]) >= OVERSIZED_IMAGE_PX) {
          oversized += 1;
          oversizedPaths.add(f.path);
          break;
        }
      }
    }
  }
  return {
    total, eagerOffscreen, oversized, suppressed,
    oversizedPaths: [...oversizedPaths].slice(0, 6),
    eagerPaths: [...eagerPaths].slice(0, 6),
  };
}

/* ── 6) Unbounded effects ───────────────────────────────────────────────────────────────────
 * `useEffect(() => { … })` with NO dependency array whose body calls a state setter — a genuine
 * render-loop / wasted-work pattern. Uses a real bracket scanner (not a regex) so nested
 * braces/parens inside the effect body cannot produce a false positive. */
function scanCallArgs(src: string, openParenIdx: number): { args: number; endIdx: number } | null {
  let depth = 0;
  let topLevelCommas = 0;
  for (let i = openParenIdx; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return { args: topLevelCommas + 1, endIdx: i };
      if (depth < 0) return null;
    } else if (c === ',' && depth === 1) topLevelCommas += 1;
  }
  return null;
}

function findUnboundedEffects(files: FrontendGeneratedFile[]): { count: number; paths: string[] } {
  let count = 0;
  const paths = new Set<string>();
  for (const f of files) {
    if (f.language === 'css') continue;
    const src = f.content;
    const re = /\buseEffect\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const open = m.index + m[0].length - 1;
      const scan = scanCallArgs(src, open);
      if (!scan || scan.args !== 1) continue;              // has a dependency array → fine
      const body = src.slice(open, scan.endIdx);
      if (!/\bset[A-Z][\w$]*\s*\(/.test(body)) continue;   // no state write → not a loop risk
      count += 1;
      paths.add(f.path);
    }
  }
  return { count, paths: [...paths].slice(0, 6) };
}

/* ── 7) Excessive DOM wrappers ──────────────────────────────────────────────────────────────
 * Attribute-less `<div>` directly wrapping another element. One is fine; many mean the tree is
 * needlessly deep. Threshold is high so ordinary layout nesting is never reported. */
function findRedundantWrappers(files: FrontendGeneratedFile[]): { count: number; paths: string[] } {
  let count = 0;
  const paths = new Set<string>();
  for (const f of files) {
    if (f.language === 'css') continue;
    const matches = f.content.match(/<div>\s*<(?:div|section|span)\b/g);
    const n = matches ? matches.length : 0;
    if (n > 0) { count += n; paths.add(f.path); }
  }
  return { count, paths: [...paths].slice(0, 6) };
}

/* ── 8) BUDGET detectors (guard-policy only) ────────────────────────────────────────────────
 * These compare the generated source against the budgets the DESIGN was planned against. They
 * exist only when a policy is supplied, and — like every detector here — they under-report. */

/** Media assets in the first-viewport component (the hero for a website, the entry screen for an
 *  app): `<img>` tags plus CSS background-image declarations in that ONE file.
 *
 *  When the caller cannot name the first-viewport file the check is SKIPPED rather than guessed.
 *  Picking "the first component file" would be arbitrary — file order carries no meaning — and a
 *  false "your first viewport is too heavy" instruction is exactly the kind of confident-but-wrong
 *  advice this module is written to avoid. */
function countAboveFoldMedia(files: FrontendGeneratedFile[], entryPath: string | undefined): { count: number; path?: string } | undefined {
  if (!entryPath) return undefined;
  const entry = files.find((f) => f.path === entryPath);
  if (!entry) return undefined;
  const imgs = entry.content.match(/<img\b/gi);
  const bgs = entry.content.match(/background-image\s*:/gi);
  return { count: (imgs ? imgs.length : 0) + (bgs ? bgs.length : 0), path: entry.path };
}

/** LOOPING animations — the only animations that provably run at the same time. A finite
 *  entrance transition is not counted: it is over before the next one starts. */
function countLoopingAnimations(files: FrontendGeneratedFile[]): { count: number; paths: string[] } {
  let count = 0;
  const paths = new Set<string>();
  for (const f of files) {
    const hits = f.content.match(/\banimate-(?:pulse|spin|bounce|ping)\b|animation[^;{}]*\binfinite\b|repeat\s*:\s*Infinity/g);
    const n = hits ? hits.length : 0;
    if (n > 0) { count += n; paths.add(f.path); }
  }
  return { count, paths: [...paths].slice(0, 6) };
}

/** Blur / backdrop-blur / heavy drop-shadow layers. Paint-expensive and, past a couple, a
 *  substitute for real hierarchy rather than an addition to it. */
function countEffectLayers(files: FrontendGeneratedFile[]): { count: number; paths: string[] } {
  let count = 0;
  const paths = new Set<string>();
  for (const f of files) {
    const hits = f.content.match(/\bbackdrop-blur(?:-[a-z0-9]+)?\b|\bblur-(?:sm|md|lg|xl|2xl|3xl)\b|filter\s*:[^;{}]*blur\s*\(|\bdrop-shadow-(?:lg|xl|2xl)\b/g);
    const n = hits ? hits.length : 0;
    if (n > 0) { count += n; paths.add(f.path); }
  }
  return { count, paths: [...paths].slice(0, 6) };
}

/* ── Report assembly ────────────────────────────────────────────────────────────────────────── */

function finding(
  code: WebBuildOptimizationCode,
  severity: WebBuildOptimizationFinding['severity'],
  magnitude: number,
  files: string[],
  evidence: string,
  suggestion: string,
): WebBuildOptimizationFinding {
  return {
    code, severity, magnitude,
    files: files.slice(0, 6),
    evidence: trunc(evidence, 240),
    suggestion: trunc(suggestion, 240),
  };
}

/** The empty, always-safe report — used on failure and when there is nothing to optimize. */
function emptyReport(fileCount: number): WebBuildOptimizationReport {
  return {
    version: 'web-build-optimization-v1',
    findings: [],
    measured: {
      fileCount,
      sourceCharCount: 0,
      cssCharCount: 0,
      deadImportCount: 0,
      unreferencedComponentCount: 0,
      duplicateCssRuleCount: 0,
      duplicateCssCharCount: 0,
      duplicateClassLiteralCount: 0,
      duplicateClassCharCount: 0,
      imageCount: 0,
      eagerOffscreenImageCount: 0,
      oversizedImageCount: 0,
      unboundedEffectCount: 0,
      redundantWrapperCount: 0,
    },
  };
}

/**
 * Analyze a validated model-native project for MEASURABLE, SAFE optimization opportunities.
 * Pure, deterministic, network-free and fail-open — it never throws and never mutates its input.
 */
export function analyzeOptimization(
  files: FrontendGeneratedFile[] | undefined,
  opts?: { heroComponentPath?: string; policy?: OptimizationGuardPolicy },
): WebBuildOptimizationReport {
  const list = Array.isArray(files) ? files.filter((f) => !!f && typeof f.content === 'string') : [];
  if (list.length === 0) return emptyReport(0);
  try {
    const sourceCharCount = list.filter((f) => f.language !== 'css').reduce((n, f) => n + f.content.length, 0);
    const cssCharCount = list.filter((f) => f.language === 'css').reduce((n, f) => n + f.content.length, 0);

    const policy = opts?.policy;
    const protectedFiles = new Set((policy?.protectedFiles || []).filter((f) => typeof f === 'string'));
    let guardSuppressed = 0;

    const dead = findDeadImports(list);
    const deadImportCount = dead.reduce((n, d) => n + d.names.length, 0);
    const unreferencedAll = findUnreferencedComponents(list);
    // GUARD — a PLANNED surface component that is not yet imported is a contract-fidelity defect
    // (the section/screen is missing), and the owning analyzer already reports it as such. Telling
    // the repair it is a deletable dead file here would be a priority inversion: it would trade the
    // product's own surface for a smaller bundle. Those paths are withheld and counted.
    const unreferenced = unreferencedAll.filter((path) => {
      if (!protectedFiles.has(path)) return true;
      guardSuppressed += 1;
      return false;
    });
    const css = findDuplicateCss(list);
    const cls = findDuplicateClassLiterals(list);
    const img = findImageIssues(list, opts?.heroComponentPath, policy?.protectedMediaSlotIds || [], !!policy?.leadVisualRequired);
    guardSuppressed += img.suppressed;
    const effects = findUnboundedEffects(list);
    const wrappers = findRedundantWrappers(list);

    /* Budget measurements — only meaningful with a policy, so they stay undefined without one. */
    const aboveFold = policy ? countAboveFoldMedia(list, policy.firstViewportPath || opts?.heroComponentPath) : undefined;
    const looping = policy ? countLoopingAnimations(list) : undefined;
    const effectLayers = policy ? countEffectLayers(list) : undefined;

    const findings: WebBuildOptimizationFinding[] = [];

    if (deadImportCount > 0) {
      findings.push(finding(
        'dead-import', 'medium', deadImportCount,
        dead.map((d) => d.file),
        `${deadImportCount} imported binding(s) are never referenced in their own file (e.g. ${dead.slice(0, 2).map((d) => `${d.file}: ${d.names.slice(0, 3).join(', ')}`).join('; ')}).`,
        'Delete the unused import bindings. Do not change any rendered markup, copy or styling.',
      ));
    }
    if (unreferenced.length > 0) {
      findings.push(finding(
        'unreferenced-component', 'medium', unreferenced.length, unreferenced,
        `${unreferenced.length} component file(s) are never imported by any other file: ${unreferenced.slice(0, 3).join(', ')}.`,
        'Either render the component where the plan requires it, or remove the dead file and its imports. Never delete a component the page architecture still requires.',
      ));
    }
    if (css.bodies > 0) {
      findings.push(finding(
        'duplicate-css-rule', 'low', css.wastedChars, [],
        `${css.bodies} CSS declaration body/bodies are repeated across ${css.occurrences} rules (${css.wastedChars} duplicated characters).`,
        'Consolidate the repeated declaration bodies into one shared class or CSS custom property. The rendered appearance must not change.',
      ));
    }
    if (cls.literals > 0) {
      findings.push(finding(
        'duplicate-class-literal', 'low', cls.wastedChars, [],
        `${cls.literals} long className string(s) are repeated ${cls.occurrences} times (${cls.wastedChars} duplicated characters).`,
        'Extract the repeated className strings into a shared constant or CSS class. The rendered appearance must not change.',
      ));
    }
    if (img.eagerOffscreen > 0) {
      findings.push(finding(
        'eager-offscreen-image', 'medium', img.eagerOffscreen, img.eagerPaths,
        `${img.eagerOffscreen} of ${img.total} <img> element(s) outside the hero load eagerly (no loading attribute).`,
        'Add loading="lazy" and decoding="async" to images below the fold. Leave the hero image eager so the first paint is unaffected.',
      ));
    }
    if (img.oversized > 0) {
      findings.push(finding(
        'oversized-remote-image', 'high', img.oversized, img.oversizedPaths,
        `${img.oversized} image source(s) request an asset of at least ${OVERSIZED_IMAGE_PX}px on one axis.`,
        `Request a source sized for the region it renders in (reduce the width/height query parameter below ${OVERSIZED_IMAGE_PX}px). Keep the same image — only the requested dimensions change.`,
      ));
    }
    if (effects.count > 0) {
      findings.push(finding(
        'unbounded-effect', 'high', effects.count, effects.paths,
        `${effects.count} useEffect call(s) have no dependency array and write component state, so they re-run on every render.`,
        'Add the correct dependency array (or an empty one for mount-only work) so the effect does not run on every render. Do not change what the effect does.',
      ));
    }
    if (wrappers.count >= WRAPPER_MIN_OCCURRENCES) {
      findings.push(finding(
        'redundant-dom-wrapper', 'low', wrappers.count, wrappers.paths,
        `${wrappers.count} attribute-less <div> wrappers directly contain a single element, deepening the DOM without effect.`,
        'Remove the attribute-less wrapper elements that carry no class, style or handler. The layout must render identically.',
      ));
    }

    /* ── Budget findings. Advisory like every other finding; they ride the SAME single
     *    consolidated `minor` performance issue, so they consume no extra repair budget. ── */
    if (policy && aboveFold && aboveFold.count > policy.maxAboveFoldMedia) {
      findings.push(finding(
        'above-fold-media-overweight', 'medium', aboveFold.count - policy.maxAboveFoldMedia,
        aboveFold.path ? [aboveFold.path] : [],
        `The first-viewport component loads ${aboveFold.count} media asset(s); this experience was planned for at most ${policy.maxAboveFoldMedia}.`,
        `Keep at most ${policy.maxAboveFoldMedia} eagerly-loaded media asset in the first viewport and defer the rest with loading="lazy". Do NOT delete a required image — move it below the fold or lazy-load it.`,
      ));
    }
    if (policy && looping && looping.count > policy.maxSimultaneousAnimations) {
      findings.push(finding(
        'motion-budget-exceeded', 'low', looping.count - policy.maxSimultaneousAnimations, looping.paths,
        `${looping.count} looping animation(s) run continuously; the planned motion budget allows ${policy.maxSimultaneousAnimations}.`,
        'Stop the purely decorative looping animations (keep any that communicate a real state such as loading). Do not remove functional transitions or the signature moment the design calls for.',
      ));
    }
    if (policy && effectLayers && effectLayers.count > policy.maxBlurLayers + 2) {
      findings.push(finding(
        'excessive-visual-effects', 'low', effectLayers.count - policy.maxBlurLayers, effectLayers.paths,
        `${effectLayers.count} blur / backdrop-blur / heavy drop-shadow layer(s) are applied; this design was planned for about ${policy.maxBlurLayers}.`,
        'Remove the blur and heavy shadow layers that are not doing real work (an overlay behind text may stay). Replace that depth with spacing, borders and value contrast — the layout must read the same or better.',
      ));
    }

    const ranked = findings
      .sort((a, b) => (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || (b.magnitude - a.magnitude))
      .slice(0, MAX_FINDINGS);

    return {
      version: 'web-build-optimization-v1',
      findings: ranked,
      measured: {
        fileCount: list.length,
        sourceCharCount,
        cssCharCount,
        deadImportCount,
        unreferencedComponentCount: unreferenced.length,
        duplicateCssRuleCount: css.bodies,
        duplicateCssCharCount: css.wastedChars,
        duplicateClassLiteralCount: cls.literals,
        duplicateClassCharCount: cls.wastedChars,
        imageCount: img.total,
        eagerOffscreenImageCount: img.eagerOffscreen,
        oversizedImageCount: img.oversized,
        unboundedEffectCount: effects.count,
        redundantWrapperCount: wrappers.count,
        ...(aboveFold ? { aboveFoldMediaCount: aboveFold.count } : {}),
        ...(looping ? { animatedLayerCount: looping.count } : {}),
        ...(effectLayers ? { blurLayerCount: effectLayers.count } : {}),
        ...(policy ? { guardSuppressedCount: guardSuppressed } : {}),
      },
    };
  } catch {
    return emptyReport(list.length);      // fail-open — optimization must never break a build
  }
}

/**
 * Convert an optimization report into review issues for the EXISTING bounded repair.
 *
 * Returns AT MOST ONE issue, always `minor`, always in the `performance` category. This is
 * deliberate: `mergeDeterministicIssues` treats a non-gate-critical issue as advisory and adds it
 * only while room remains under the fixed issue budget, so a performance instruction can never
 * displace a functional/visual obligation. The single issue carries the top findings so the repair
 * receives concrete, file-scoped work rather than "make it faster".
 */
export function optimizationToReviewIssues(
  report: WebBuildOptimizationReport | undefined,
  policy?: OptimizationGuardPolicy,
): FrontendBuilderReviewIssue[] {
  if (!report || report.version !== 'web-build-optimization-v1') return [];
  const top = report.findings.slice(0, MAX_FINDINGS_IN_ISSUE);
  if (top.length === 0) return [];
  const files = Array.from(new Set(top.flatMap((f) => f.files))).slice(0, 6);
  /* The PRESERVATION clause. Without it, the single performance instruction reads as an open
   * licence to make the project lighter; with it, the repair is told in the same breath what
   * "lighter" may never cost. It is placed FIRST and the concrete fixes then fill the remaining
   * room, so a long suggestion list can never truncate the guard away — the reverse ordering
   * would have made the protection the first thing lost on a busy build. */
  const guard = policy && policy.protectedElements.length
    ? `Do NOT remove or weaken ${policy.protectedElements.slice(0, 2).join('; ')}. `
    : '';
  const lead = `${guard}Apply these SAFE efficiency fixes without changing the design, layout, copy or any requested visual effect:`;
  let instruction = lead;
  for (const f of top) {
    const next = `${instruction} ${f.suggestion}`;
    if (next.length > MAX_REPAIR_INSTRUCTION_CHARS) break;
    instruction = next;
  }
  return [{
    id: `optimization:${top.map((f) => f.code).join('+')}`.slice(0, 80),
    severity: 'minor',
    category: 'performance',
    files,
    evidence: trunc(top.map((f) => f.evidence).join(' '), 240),
    repairInstruction: trunc(instruction, MAX_REPAIR_INSTRUCTION_CHARS),
  }];
}

/** True when the report found nothing worth repairing (used to skip work + report honestly). */
export function isOptimizationClean(report: WebBuildOptimizationReport | undefined): boolean {
  return !report || report.findings.length === 0;
}
