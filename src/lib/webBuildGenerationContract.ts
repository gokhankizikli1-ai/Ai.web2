/**
 * Web Build HARD GENERATION CONTRACT (PR #519, Part A).
 *
 * Translates the EXISTING ExperienceArchitecturePlan (+ its nested Signature / Asset / Motion /
 * Layout strategies) into ONE compact, BINDING generation contract — hard requirements,
 * forbidden patterns, optional creative freedom — so the frontend_builder can no longer treat
 * the design guidance as optional inspiration and fall back to its familiar generic template.
 *
 * It is NOT a new plan, NOT a new intelligence system, and adds NO model call: it re-states
 * existing decisions as enforceable model-facing language (no scores, confidence, reasoning or
 * raw enums), and its STATIC checks feed the EXISTING review merge + EXISTING single bounded
 * repair (never a second validator/repair).
 *
 * Feature flag (default OFF → the request + validation are byte-for-byte unchanged):
 *     VITE_ENABLE_HARD_GENERATION_CONTRACT=false
 */
import type {
  ExperienceArchitecturePlan, FrontendGenerationContract,
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderReviewCategory,
  FrontendBuilderReviewSeverity, ExperienceVisualMedium,
} from '@/lib/webBuildAgents';

export function isHardGenerationContractEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_HARD_GENERATION_CONTRACT;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const MAX_LIST = 12;
const MAX_FIELD = 200;
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cap = (v: string): string => (v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) : v).trim();

function cleanList(xs: ReadonlyArray<string | undefined | null> | undefined, n = MAX_LIST): string[] {
  if (!Array.isArray(xs)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of xs) {
    const t = cap(s(raw));
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/* Generic AI-template tells that are forbidden UNLESS the plan/request explicitly justifies
 * them. Phrased as strict negative constraints. */
const GENERIC_FALLBACKS = [
  'centered large headline + two CTA buttons as the dominant hero',
  'a generic three-identical-card features section',
  'meaningless metric/number cards without real data',
  'decorative dashboard/analytics mockups presented as product proof',
  'unlabeled node/graph diagrams',
  'empty skeleton bars standing in for content',
  'a default dark-purple AI aesthetic',
  'neon/futuristic styling merely because the product uses AI',
];

interface Intent { minimal: boolean; appFirst: boolean; expectsImages: boolean; }
function readIntent(plan: ExperienceArchitecturePlan): Intent {
  const directives = [
    ...(plan.userDirectives || []), ...(plan.signature?.userDirectives || []),
    ...(plan.assetStrategy?.userDirectives || []), ...(plan.layoutStrategy?.userDirectives || []),
  ].join(' ').toLowerCase();
  const minimal = plan.textDensity === 'low' || plan.layoutStrategy?.contentDensity === 'minimal'
    || plan.signature?.interactionPattern === 'minimal_static' || /minimal|no images|text-only|simple landing/.test(directives);
  // app-first = NO marketing landing (open into the app). interactive-demo is product-first
  // (a landing dominated by a demo), so it is NOT app-first here.
  const appFirst = plan.landingRequired === false || /app-first/.test(plan.entryPattern || '')
    || plan.layoutStrategy?.pageStructure === 'application';
  const heroAsset = plan.assetStrategy?.heroAsset;
  const expectsImages = plan.primaryVisualMedium === 'photography'
    || (heroAsset !== undefined && heroAsset !== 'none' && heroAsset !== 'interactive_demo')
    || (plan.sectionContracts || []).some((c) => c.visualMedium === 'photography');
  return { minimal, appFirst, expectsImages };
}

function mediumLabel(m: ExperienceVisualMedium): string {
  return m.replace(/_/g, ' ');
}

/**
 * Build the binding generation contract from an already-built plan. Returns `undefined` when
 * the flag is off or there is no usable plan. Pure + fail-open — never throws.
 */
export function buildGenerationContract(plan: ExperienceArchitecturePlan | undefined): FrontendGenerationContract | undefined {
  try {
    if (!isHardGenerationContractEnabled()) return undefined;
    if (!plan || plan.version !== 'experience-arch-v1') return undefined;
    const intent = readIntent(plan);

    // Entry requirement.
    let entryRequirement: string;
    if (intent.appFirst) {
      entryRequirement = 'Open directly into the application/product experience — do NOT build a marketing landing page.';
    } else if (/product-first|interactive-demo/.test(plan.entryPattern || '') || plan.heroContentPriority === 'interaction' || plan.heroContentPriority === 'product_ui') {
      entryRequirement = 'The first viewport must be dominated by a functional product experience, not a marketing headline.';
    } else if (/atmosphere/.test(plan.entryPattern || '')) {
      entryRequirement = 'Open with atmosphere-setting editorial visuals, not a generic SaaS hero.';
    } else if (/work-first/.test(plan.entryPattern || '')) {
      entryRequirement = 'Open with the actual work/portfolio, not a marketing headline.';
    } else {
      entryRequirement = 'Open with a clear, specific value proposition for this business — not a generic template hero.';
    }

    // Hero requirement.
    const heroRequirement = (plan.heroContentPriority === 'none' || /no hero|none/i.test(plan.heroPattern || ''))
      ? 'Do NOT invent a hero section.'
      : `Hero: ${cap(s(plan.heroPattern) || 'concept-led, specific to this business')}. The headline is supporting content unless the hero priority is text.`;

    // Dominant first-viewport element.
    const dominant = ((): string => {
      switch (plan.heroContentPriority) {
        case 'interaction': case 'product_ui': return 'a functional product / interactive demo';
        case 'catalog': return 'the product catalog';
        case 'media': return 'editorial photography / media';
        case 'content': return 'a specific value proposition';
        case 'text': return 'a concrete headline with real supporting copy';
        case 'none': return 'the application workspace';
        default: return 'the primary business experience';
      }
    })();

    // Required proof — business-specific, from the section proof requirements + proof strategy.
    const requiredProof = cleanList([
      ...(plan.sectionContracts || []).filter((c) => c.proofRequirement).map((c) => `${c.id}: ${s(c.proofRequirement)}`),
      s(plan.proofStrategy),
    ], 8);

    // Required visual media — genuine, never decorative substitutes. Skip when no-image intent.
    const media = new Set<ExperienceVisualMedium>();
    if (!intent.minimal) media.add(plan.primaryVisualMedium);
    for (const c of (plan.sectionContracts || [])) {
      if (c.visualMedium !== 'typography' && c.visualMedium !== 'none') media.add(c.visualMedium);
    }
    const requiredVisualMedia = cleanList([...media].filter((m) => m !== 'none' && m !== 'mixed').map(mediumLabel), 6);

    // Required interactions.
    const requiredInteractions = cleanList([
      s(plan.signature?.signatureMoment),
      ...(plan.sectionContracts || []).map((c) => s(c.interaction)).filter(Boolean),
    ], 6);

    // Forbidden — the plan's own avoids + the generic staples that conflict with it.
    const planForbids = cleanList([
      ...(plan.forbiddenPatterns || []),
      ...(plan.layoutStrategy?.avoidPatterns || []),
      ...(plan.assetStrategy?.avoidAssets || []),
      ...(plan.motionStrategy?.avoidMotion || []),
    ], 10);
    const forbiddenPatterns = cleanList([...planForbids, ...GENERIC_FALLBACKS], MAX_LIST);

    const creativeFreedom = cleanList([
      'exact copy wording (kept truthful and specific)',
      'micro-interactions and hover states',
      'the internal layout within each required section',
      'palette refinement within the chosen visual direction',
    ], 6);

    return {
      version: 'generation-contract-v1',
      entryRequirement: cap(entryRequirement),
      heroRequirement: cap(heroRequirement),
      dominantFirstViewportElement: cap(dominant),
      requiredProof,
      requiredVisualMedia,
      requiredInteractions,
      requiredSections: cleanList(plan.sectionSequence, MAX_LIST),
      forbiddenPatterns,
      creativeFreedom,
    };
  } catch {
    return undefined;
  }
}

/**
 * Render the binding contract as a concise, imperative prompt block for the frontend_builder
 * request. Returns "" when no contract — so the request is unchanged. No scores/reasoning.
 */
export function renderGenerationContractBlock(contract: FrontendGenerationContract | undefined): string {
  if (!contract || contract.version !== 'generation-contract-v1') return '';
  const lines = [
    'GENERATION CONTRACT — BINDING (obey exactly; this is a contract, not optional inspiration):',
    `- First viewport: ${contract.entryRequirement}`,
    `- Dominant first-viewport element: ${contract.dominantFirstViewportElement}.`,
    `- ${contract.heroRequirement}`,
  ];
  if (contract.requiredProof.length) lines.push(`- Required proof (must be visible + business-specific, never decorative): ${contract.requiredProof.join('; ')}.`);
  if (contract.requiredVisualMedia.length) lines.push(`- Required visual media (genuine, not decorative substitutes): ${contract.requiredVisualMedia.join('; ')}.`);
  if (contract.requiredInteractions.length) lines.push(`- Required interactions: ${contract.requiredInteractions.join('; ')}.`);
  if (contract.requiredSections.length) lines.push(`- Respect this section sequence: ${contract.requiredSections.join(' → ')}.`);
  lines.push(`- FORBIDDEN (do NOT use unless the user request explicitly asks for it): ${contract.forbiddenPatterns.join('; ')}.`);
  lines.push(`- Creative freedom: ${contract.creativeFreedom.join('; ')}.`);
  lines.push('- Use motion only to explain state/transitions, never as decorative filler.');
  return lines.join('\n');
}

/* ── Deterministic static enforcement ─────────────────────────────────────────*/
export interface ContractFinding {
  code: string;
  severity: FrontendBuilderReviewSeverity;
  message: string;
  repairInstruction: string;
}

const norm = (v: string): string => (v || '').toLowerCase();
const count = (re: RegExp, hay: string): number => (hay.match(re) || []).length;

/**
 * Deterministic static checks of generated source against the contract. Only STRONG evidence
 * yields major/blocker; intentionally minimal / typography-first / app-first sites are not
 * penalised (no false positives). Pure + fail-open — returns [] on any problem.
 */
export function evaluateContractCompliance(
  files: FrontendGeneratedFile[] | undefined,
  plan: ExperienceArchitecturePlan | undefined,
): ContractFinding[] {
  try {
    if (!plan || plan.version !== 'experience-arch-v1') return [];
    if (!Array.isArray(files) || files.length === 0) return [];
    const intent = readIntent(plan);
    const blob = files.map((f) => f.content).join('\n');
    const low = norm(blob);
    const firstSection = blob.split(/<section\b/i)[1] || blob.slice(0, 1500);
    const firstLow = norm(firstSection);
    const out: ContractFinding[] = [];
    const requested = norm(s(plan.userDirectives?.join(' ')) + ' ' + s(plan.experienceType));

    const productFirst = /product-first|interactive-demo/.test(plan.entryPattern || '')
      || plan.heroContentPriority === 'interaction' || plan.heroContentPriority === 'product_ui';
    const interactiveMarkers = /(usestate|onclick|onchange|<button\b|<input\b|<textarea\b|role=["']tab)/;

    // 1. Generic headline-first fallback against a product-first plan.
    if (productFirst && /<h1\b/i.test(firstSection) && !interactiveMarkers.test(firstLow) && !/<img\b/i.test(firstSection)) {
      out.push({
        code: 'contract-headline-first-vs-product-first', severity: 'major',
        message: 'The plan is product-first/interactive, but the first viewport is a text headline with no functional product experience.',
        repairInstruction: 'Reduce headline dominance and make the first viewport a real functional product/interactive demo (state, inputs, or product UI) — not a marketing headline.',
      });
    }

    // 2. Hero generated despite heroPattern none.
    if ((plan.heroContentPriority === 'none' || /no hero/i.test(plan.heroPattern || ''))
      && /class(name)?=["'][^"']*min-h-screen[^"']*["'][\s\S]{0,400}<h1\b/i.test(blob)) {
      out.push({
        code: 'contract-hero-when-none', severity: 'major',
        message: 'The plan requires no hero, but a full-screen headline hero was generated.',
        repairInstruction: 'Remove the invented hero; open directly into the intended experience.',
      });
    }

    // 3. Marketing landing despite landingRequired false.
    if (plan.landingRequired === false && /(pricing|testimonial|trusted by|start your free trial)/.test(low) && /<h1\b/i.test(firstSection)) {
      out.push({
        code: 'contract-marketing-landing-when-app-first', severity: 'major',
        message: 'The plan sets landingRequired=false, but a marketing landing page (hero + pricing/testimonials) was generated.',
        repairInstruction: 'Replace the marketing landing with the application/product experience the plan requires.',
      });
    }

    // 4. Prohibited three-card feature stack (only when forbidden AND not minimal).
    const cardLike = count(/rounded-(xl|2xl|3xl)[^"']*border[^"']*p-[4-8]/g, low);
    if (!intent.minimal && /grid-cols-3/.test(low) && cardLike >= 3
      && (plan.forbiddenPatterns || []).some((f) => /feature|card|template/i.test(f))) {
      out.push({
        code: 'contract-generic-feature-cards', severity: 'major',
        message: 'A generic three-identical-card features section is present, which the plan forbids.',
        repairInstruction: 'Replace the identical feature-card trio with substantive, differentiated content specific to the business.',
      });
    }

    // 5. Automatic pricing/testimonials/final-CTA absent from the plan and not requested.
    for (const [pat, re] of [
      ['pricing', /\bpricing\b/], ['testimonials', /\btestimonial/], ] as Array<[string, RegExp]>) {
      const inPlan = (plan.sectionSequence || []).some((id) => re.test(norm(id)));
      if (!inPlan && !re.test(requested) && re.test(low)) {
        out.push({
          code: `contract-auto-${pat}`, severity: 'minor',
          message: `An automatic ${pat} section was added although the plan and request did not call for it.`,
          repairInstruction: `Remove the unrequested ${pat} section (or replace it with a section the plan actually requires).`,
        });
      }
    }

    // 6. Missing required visual medium (photography expected but no real imagery).
    if (!intent.minimal && intent.expectsImages && !/<img\b/i.test(blob)) {
      out.push({
        code: 'contract-missing-required-medium', severity: 'major',
        message: 'The plan requires real photography, but no real imagery is rendered.',
        repairInstruction: 'Render the planned image slots as real <img> elements; do not substitute decorative SVG/gradients.',
      });
    }

    // 7. Decorative-as-proof / missing required proof markers.
    for (const c of (plan.sectionContracts || [])) {
      if (!c.proofRequirement) continue;
      const tok = norm(c.id).replace(/[^a-z0-9]+/g, '');
      if (!tok) continue;
      const at = low.indexOf(tok);
      if (at < 0) continue;
      const win = norm(blob.slice(at, at + 2200));
      const skeleton = /(animate-pulse|skeleton|placeholder-bar)/.test(win);
      const realEvidence = /(<img\b|\d|<button\b|<input\b|<table\b|aria-label|recharts)/.test(win);
      if (skeleton || !realEvidence) {
        out.push({
          code: 'contract-decorative-proof', severity: 'major',
          message: `Section "${c.id}" must show real proof, but it appears decorative (skeleton/SVG, no concrete evidence).`,
          repairInstruction: `Render the real proof for "${c.id}" (real numbers, product UI, image or data) — decorative visuals do not satisfy a proof requirement.`,
        });
      }
    }

    // 8. Default AI neon/purple aesthetic when forbidden (and not requested).
    const forbidsPurpleNeon = (plan.forbiddenPatterns || []).some((f) => /neon|cyberpunk|purple|futuristic/i.test(f))
      || (plan.assetStrategy?.avoidAssets || []).some((f) => /neon|cyberpunk|purple/i.test(f));
    if (forbidsPurpleNeon && !/neon|purple|cyberpunk|futuristic/.test(requested)
      && (count(/#(a855f7|7c3aed|8b5cf6|6d28d9|9333ea)/g, low) + count(/\b(violet|fuchsia|purple)-[3-9]00\b/g, low)) >= 3) {
      out.push({
        code: 'contract-default-purple-neon', severity: 'minor',
        message: 'A default dark-purple / neon AI aesthetic is used although the plan forbids it and the request did not ask for it.',
        repairInstruction: 'Use the palette from the plan’s visual direction; avoid the generic purple/neon AI look.',
      });
    }

    return out;
  } catch {
    return [];
  }
}

/* Map a contract finding → an EXISTING review category so it rides the existing repair. */
function categoryFor(code: string): FrontendBuilderReviewCategory {
  if (code.includes('headline-first') || code.includes('hero') || code.includes('landing')) return 'concept-drift';
  if (code.includes('feature-cards') || code.includes('auto-')) return 'generic-template';
  if (code.includes('medium') || code.includes('proof')) return 'contract-fidelity';
  if (code.includes('purple') || code.includes('neon')) return 'palette-and-surfaces';
  return 'contract-fidelity';
}

/**
 * Convert contract findings → review issues for the EXISTING bounded repair. Dedups by
 * category (mergeDeterministicIssues also dedups), so this never duplicates the model reviewer.
 */
export function contractFindingsToReviewIssues(findings: ContractFinding[]): FrontendBuilderReviewIssue[] {
  const out: FrontendBuilderReviewIssue[] = [];
  const seen = new Set<FrontendBuilderReviewCategory>();
  for (const f of findings) {
    const category = categoryFor(f.code);
    if (seen.has(category)) continue;
    seen.add(category);
    out.push({
      id: `contract:${f.code}`.slice(0, 80),
      severity: f.severity,
      category,
      files: [],
      evidence: `Generation contract: ${f.message}`.slice(0, 240),
      repairInstruction: f.repairInstruction.slice(0, 240),
    });
  }
  return out;
}

export { buildGenerationContract as _buildGenerationContract };
