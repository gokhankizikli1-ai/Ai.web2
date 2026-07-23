/**
 * Web Build SEMANTIC CONTENT GUARD (PR #515).
 *
 * A post-generation quality check: it reads the ALREADY-generated section structure + the plan
 * and reports whether sections carry MEANINGFUL semantic value (real proof, evidence, business
 * substance) instead of decorative filler. It is NOT a generation system, makes NO model call,
 * and NEVER rewrites content — it emits a typed SemanticContentReport of SUGGESTIONS only.
 *
 * `evaluateSemanticContent` is pure, synchronous, network-free, bounded, JSON-serializable and
 * FAILS OPEN (returns `undefined` on any problem, never throws).
 *
 * INTENT-AWARE (critical): it consumes the ExperienceArchitecturePlan (+ Layout & Asset
 * strategies) so it NEVER forces more content, never punishes intentional whitespace, treats a
 * minimal site as valid, and lets the user request override. When no plan is present it applies
 * only conservative, universally-safe checks.
 *
 * Feature flag (default OFF → no report is produced; the validation artifact is byte-for-byte
 * the prior contract):
 *
 *     VITE_ENABLE_SEMANTIC_CONTENT_GUARD=false
 */
import type {
  FrontendGeneratedFile, FrontendBuildSpecification, ExperienceArchitecturePlan,
  SemanticContentReport, SemanticSectionFinding, SemanticIssueType, SemanticIssueSeverity,
  SemanticContentQuality, SemanticProofCoverage,
} from '@/lib/webBuildAgents';

export function isSemanticContentGuardEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_SEMANTIC_CONTENT_GUARD;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const MAX_FINDINGS = 24;
const SEVERITY_RANK: Record<SemanticIssueSeverity, number> = { high: 0, medium: 1, low: 2 };
const norm = (v: string): string => (v || '').toLowerCase();
const idToken = (id: string): string => norm(id).replace(/[^a-z0-9]+/g, '');
const has = (re: RegExp, hay: string): boolean => re.test(hay);
const cnt = (re: RegExp, hay: string): number => (hay.match(re) || []).length;

interface Intent {
  minimal: boolean;
  isApp: boolean;
  directives: string;
}

function readIntent(plan: ExperienceArchitecturePlan | undefined): Intent {
  if (!plan) return { minimal: false, isApp: false, directives: '' };
  const directives = [
    ...(plan.userDirectives || []),
    ...(plan.signature?.userDirectives || []),
    ...(plan.assetStrategy?.userDirectives || []),
    ...(plan.layoutStrategy?.userDirectives || []),
  ].join(' ').toLowerCase();
  const minimal = plan.textDensity === 'low'
    || plan.layoutStrategy?.contentDensity === 'minimal'
    || plan.signature?.interactionPattern === 'minimal_static'
    || /minimal|simple landing|text-only/.test(directives);
  const isApp = plan.layoutStrategy?.pageStructure === 'application'
    || plan.landingRequired === false
    || /interactive-demo|app-first/.test(plan.entryPattern || '');
  return { minimal, isApp, directives };
}

function finding(sectionId: string, issueType: SemanticIssueType, severity: SemanticIssueSeverity, message: string, suggestion: string): SemanticSectionFinding {
  return { sectionId, issueType, severity, message, suggestion };
}

/* ── Per-business required proof signals ──────────────────────────────────────*/
interface ProofSpec { label: string; signals: RegExp[]; }
const PROOF_BY_TYPE: Record<string, ProofSpec> = {
  'catalog-commerce': { label: 'product proof, pricing, variants and trust signals', signals: [
    /(\$|€|£|\bprice\b|\/mo\b|pricing)/, /(size|colou?r|variant|option|sku)/, /(review|rating|guarantee|secure|return|warranty)/,
  ] },
  'product-demonstration': { label: 'a real product/workflow demonstration', signals: [
    /(usestate|onclick|onchange|<button\b|<input\b|role=["']tab)/, /(workflow|dashboard|demo|integration|how it works)/, /<img\b|<svg[\s\S]{0,2000}<text\b/,
  ] },
  'work-showcase': { label: 'real work/project evidence', signals: [
    /(project|case study|portfolio|work\b|selected)/, /<img\b/, /(role|client|year|outcome|result)/,
  ] },
  'atmosphere-editorial': { label: 'atmosphere, menu, location and reservation/story', signals: [
    /(menu|dish|cuisine|tasting)/, /(reserv|book a table|opening|hours|address|location)/, /(story|chef|about|since \d{4})/,
  ] },
  'trust-clarity': { label: 'clear data/proof and trust signals', signals: [
    /(\d|chart|rate|apr|data)/, /(secure|regulated|insured|licen[cs]e|trust)/, /(how it works|guide)/,
  ] },
};

/**
 * Evaluate the semantic content of generated files against the (optional) plan. Returns
 * `undefined` when the flag is off, there are no files, or on any failure. Never throws.
 * Suggestions only — it changes nothing.
 */
export function evaluateSemanticContent(
  files: FrontendGeneratedFile[] | undefined,
  spec: FrontendBuildSpecification | undefined,
): SemanticContentReport | undefined {
  try {
    if (!isSemanticContentGuardEnabled()) return undefined;
    if (!Array.isArray(files) || files.length === 0) return undefined;

    const plan = spec?.experienceArchitecture;
    const intent = readIntent(plan);
    const blob = files.map((f) => `${f.path}\n${f.content}`).join('\n');
    const low = norm(blob);

    const findings: SemanticSectionFinding[] = [];
    const push = (f: SemanticSectionFinding) => { if (findings.length < MAX_FINDINGS) findings.push(f); };

    // ── Per-section checks (associate to the plan's section ids when available) ──
    const contracts = plan?.sectionContracts || [];
    for (const c of contracts) {
      const tok = idToken(c.id);
      if (!tok) continue;
      const at = low.indexOf(tok);
      if (at < 0) continue;
      const win = blob.slice(at, at + 2200);
      const winLow = norm(win);
      const words = (win.replace(/<[^>]+>/g, ' ').match(/[A-Za-z]{3,}/g) || []).length;

      // Placeholder content (always a real defect, regardless of minimal intent).
      if (/(lorem ipsum|\bplaceholder\b|your text here|section title|subheading here|dummy text|tbd\b)/.test(winLow)) {
        push(finding(c.id, 'placeholder-content', 'high',
          'Section contains placeholder/lorem text instead of real copy.',
          'Replace the placeholder with real, concrete audience-facing copy for this section.'));
      }

      // Proof section rendered as decoration (skeleton/SVG) with no real evidence.
      if (c.proofRequirement) {
        const skeleton = /(animate-pulse|skeleton|placeholder-bar)/.test(winLow);
        const realEvidence = /(<img\b|\d|<button\b|<input\b|<table\b|aria-label|recharts)/.test(winLow);
        if (!realEvidence || skeleton) {
          push(finding(c.id, 'decorative-proof', 'high',
            'A section that must show real proof appears decorative (skeleton/SVG, no concrete evidence).',
            'Render the actual proof (real numbers, product UI, image or data) — decorative visuals do not count as evidence.'));
        }
      }

      // Empty marketing section — a heading with almost no substance (skipped when minimal).
      if (!intent.minimal && /<h[12]\b/i.test(win) && words < 12 && !/<img\b|<button\b|<input\b/i.test(win)) {
        push(finding(c.id, 'empty-marketing-section', 'medium',
          'Section has a heading but very little meaningful content.',
          'Give the section a concrete purpose (real copy, evidence or a component) or fold it into another section.'));
      }

      // Purposeless visual — a decorative SVG with no nearby text/heading.
      if (/<svg\b/i.test(win) && words < 6 && !/<h[1-3]\b/i.test(win)) {
        push(finding(c.id, 'purposeless-visual', 'low',
          'A decorative visual appears with no supporting content or purpose.',
          'Tie the visual to real content, or remove it so the section reads with intent.'));
      }
    }

    // ── Global structural checks ────────────────────────────────────────────────
    // Generic feature cards without evidence (numbers / specifics).
    const cardLike = cnt(/rounded-(xl|2xl|3xl)[^"']*border[^"']*p-[4-8]/g, low);
    const genericGrid = has(/grid-cols-3/, low) && cardLike >= 3;
    // Look for concrete evidence in the TEXT content only — strip all markup first so tag
    // names (h1/h2/h3) and utility classes (p-6, border-slate-200) never count as "evidence".
    const textOnly = blob.replace(/<[^>]+>/g, ' ');
    if (genericGrid && !has(/\d/, textOnly)) {
      push(finding('(global)', 'generic-feature-cards', 'medium',
        'A three-card feature grid is present with no concrete evidence (numbers/specifics).',
        'Back each card with a real specific (metric, capability, example) or replace the grid with substantive content.'));
    }

    // Repeated AI landing template pattern.
    const genericTemplate = genericGrid && /hero/.test(low) && /(cta|get started|sign up)/.test(low);

    // Fake statistics — round stat numbers with no real sources behind the build.
    const didUseRealSources = !!spec?.researchEvidence?.didUseRealSources;
    const statLike = has(/\b\d{1,3}(,\d{3})+\+?\b/, blob) || has(/\b\d{2,3}\s*%/, blob) || has(/\b\d{2,3}[kKmM]\+/, blob);
    if (statLike && !didUseRealSources && /(customers|users|clients|companies|rating|satisf|uptime|%)/.test(low)) {
      push(finding('(global)', 'fake-statistics', 'high',
        'Prominent statistics appear without any real source behind this build.',
        'Only show metrics you can substantiate; otherwise remove the numbers rather than fabricating proof.'));
    }

    // Unnecessary marketing sections on an application/dashboard.
    if (intent.isApp) {
      if (/(testimonial|trusted by|pricing plan|final cta|start your free trial)/.test(low)) {
        push(finding('(global)', 'unnecessary-section', 'medium',
          'Marketing sections (testimonials / pricing / trust badges) appear on an application/dashboard.',
          'Drop marketing sections on a functional app; keep the interface focused on the workspace.'));
      }
    }

    // ── Business proof coverage ─────────────────────────────────────────────────
    let proofCoverage: SemanticProofCoverage = 'strong';
    const proofSpec = plan ? PROOF_BY_TYPE[plan.experienceType] : undefined;
    if (proofSpec && !intent.isApp) {
      const present = proofSpec.signals.filter((re) => re.test(low)).length;
      proofCoverage = present >= proofSpec.signals.length ? 'strong' : present > 0 ? 'partial' : 'missing';
      if (proofCoverage !== 'strong' && !intent.minimal) {
        push(finding('(global)', 'missing-business-proof', proofCoverage === 'missing' ? 'high' : 'medium',
          `Expected ${proofSpec.label} for this business, but it is ${proofCoverage}.`,
          `Add the missing business evidence (${proofSpec.label}) so the page proves its value — without padding unrelated sections.`));
      }
    } else if (intent.isApp) {
      proofCoverage = 'strong';   // an app proves itself through its interface, not marketing proof
    }

    // ── Roll-ups ────────────────────────────────────────────────────────────────
    const highs = findings.filter((f) => f.severity === 'high').length;
    const mediums = findings.filter((f) => f.severity === 'medium').length;
    let contentQuality: SemanticContentQuality;
    if (highs > 0 || proofCoverage === 'missing') contentQuality = 'weak';
    else if (mediums > 0 || proofCoverage === 'partial') contentQuality = 'acceptable';
    else contentQuality = 'meaningful';
    // A minimal site is never called 'weak' merely for being spare (only real defects downgrade it).
    if (intent.minimal && contentQuality === 'weak' && highs === 0) contentQuality = 'acceptable';

    findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

    return {
      version: 'semantic-content-v1',
      sectionFindings: findings,
      contentQuality,
      proofCoverage,
      genericPatternDetected: genericTemplate || genericGrid,
    };
  } catch {
    return undefined;   // fail open — never break validation
  }
}
