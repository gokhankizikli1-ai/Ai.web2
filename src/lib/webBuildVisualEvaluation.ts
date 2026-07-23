/**
 * Web Build VISUAL EVALUATION LAYER (PR #514).
 *
 * A post-generation quality loop: it reads the ALREADY-generated frontend-files-v1 source and
 * emits a typed VisualEvaluationReport of SUGGESTIONS. It is NOT a generation system, performs
 * NO redesign, makes NO model call, and NEVER edits anything — it only surfaces suggested
 * fixes for a human / a later opt-in repair to consider.
 *
 * `evaluateVisualQuality` is pure, synchronous, network-free, bounded, JSON-serializable and
 * FAILS OPEN (returns `undefined` on any problem, never throws).
 *
 * INTENT-AWARE (critical): it consumes the ExperienceArchitecturePlan on the spec (when
 * present) so it NEVER flags good minimal design as a defect, never proposes complexity that
 * contradicts the user request, and never second-guesses the business intent. When the plan is
 * absent it applies only conservative, universally-safe checks.
 *
 * Feature flag (default OFF → no report is produced; the validation artifact is byte-for-byte
 * the prior contract):
 *
 *     VITE_ENABLE_VISUAL_EVALUATION=false
 */
import type {
  FrontendGeneratedFile, FrontendBuildSpecification, ExperienceArchitecturePlan,
  VisualEvaluationReport, VisualEvaluationIssue, VisualEvaluationSeverity,
} from '@/lib/webBuildAgents';

export function isVisualEvaluationEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_VISUAL_EVALUATION;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const MAX_PER_CATEGORY = 12;
const MAX_PRIORITY = 8;
const SEVERITY_RANK: Record<VisualEvaluationSeverity, number> = { high: 0, medium: 1, low: 2 };
const count = (re: RegExp, hay: string): number => (hay.match(re) || []).length;

/** Intent flags derived from the plan (when present) so we never fight the user's design. */
interface Intent {
  minimal: boolean;
  lowMotion: boolean;
  expectsImages: boolean;
  appFirst: boolean;
  landingExpected: boolean;
}

function readIntent(plan: ExperienceArchitecturePlan | undefined): Intent {
  if (!plan) {
    // No plan → conservative: assume nothing, so only universally-safe checks fire.
    return { minimal: false, lowMotion: false, expectsImages: false, appFirst: false, landingExpected: true };
  }
  const directives = [
    ...(plan.userDirectives || []),
    ...(plan.signature?.userDirectives || []),
    ...(plan.assetStrategy?.userDirectives || []),
    ...(plan.motionStrategy?.userDirectives || []),
  ].join(' ').toLowerCase();

  const minimal = plan.textDensity === 'low'
    || plan.signature?.interactionPattern === 'minimal_static'
    || /minimal|no images|no image|simple landing|text-only/.test(directives);

  const lowMotion = plan.motionStrategy?.motionLevel === 'none' || plan.motionStrategy?.motionLevel === 'subtle'
    || plan.signature?.motionIntensity === 'none' || plan.signature?.motionIntensity === 'subtle'
    || /no animation|no motion|static/.test(directives);

  const heroAsset = plan.assetStrategy?.heroAsset;
  const expectsImages = plan.primaryVisualMedium === 'photography'
    || (heroAsset !== undefined && heroAsset !== 'none' && heroAsset !== 'interactive_demo')
    || (plan.sectionContracts || []).some((c) => c.visualMedium === 'photography')
    || (plan.assetStrategy?.sectionAssets || []).some((a) => a.assetType === 'photography');

  const appFirst = plan.landingRequired === false
    || /interactive-demo|app-first/.test(plan.entryPattern || '');

  return { minimal, lowMotion, expectsImages, appFirst, landingExpected: plan.landingRequired !== false };
}

function issue(code: string, severity: VisualEvaluationSeverity, message: string, suggestion: string): VisualEvaluationIssue {
  return { code, severity, message, suggestion };
}

/**
 * Evaluate the visual quality of generated files against the (optional) plan. Returns
 * `undefined` when the flag is off, there are no files, or on any failure. Never throws.
 * Suggestions only — it changes nothing.
 */
export function evaluateVisualQuality(
  files: FrontendGeneratedFile[] | undefined,
  spec: FrontendBuildSpecification | undefined,
): VisualEvaluationReport | undefined {
  try {
    if (!isVisualEvaluationEnabled()) return undefined;
    if (!Array.isArray(files) || files.length === 0) return undefined;

    const blob = files.map((f) => f.content).join('\n');
    const low = blob.toLowerCase();
    const intent = readIntent(spec?.experienceArchitecture);

    const overall: VisualEvaluationIssue[] = [];
    const layout: VisualEvaluationIssue[] = [];
    const visual: VisualEvaluationIssue[] = [];
    const ux: VisualEvaluationIssue[] = [];
    const mobile: VisualEvaluationIssue[] = [];

    const imgCount = count(/<img\b/gi, blob);
    const h1Count = count(/<h1\b/gi, blob);
    const h2Count = count(/<h2\b/gi, blob);
    const buttonCount = count(/<button\b|<a\b[^>]*class/gi, blob);
    const sectionCount = Math.max(count(/<section\b/gi, blob), 1);

    // 1. Hero imbalance — a big text hero where a visual was planned, with no hero media.
    if (intent.expectsImages && h1Count >= 1 && imgCount === 0 && !/<svg\b|<video\b|<canvas\b/i.test(blob)) {
      visual.push(issue('hero-imbalance', 'high',
        'The hero is text-only, but the plan expected a visual medium there.',
        'Add the planned hero visual (photography/product UI) beside or behind the headline to balance the composition.'));
    }

    // 2. Excessive whitespace — many very-large vertical paddings (skip when minimal is intended).
    if (!intent.minimal) {
      const bigPad = count(/\bpy-(2[4-9]|3\d|40|48|56|64)\b/g, low) + count(/\bmy-(2[4-9]|3\d|40)\b/g, low);
      if (bigPad >= sectionCount + 3) {
        layout.push(issue('excessive-whitespace', 'medium',
          'Several sections use very large vertical spacing, which can read as empty.',
          'Tighten oversized vertical padding or add supporting content/visuals so sections feel intentional, not sparse.'));
      }
    }

    // 3. Missing visual assets — images expected by the plan but none rendered.
    if (intent.expectsImages && imgCount === 0) {
      visual.push(issue('missing-visual-assets', 'high',
        'No real imagery was rendered although the asset strategy expected photography.',
        'Render the planned image slots as real <img> elements; do not substitute decorative SVG/gradients for genuine imagery.'));
    }

    // 4. Repeated AI template patterns — 3-col grid of ≥3 near-identical cards.
    const cardLike = count(/rounded-(xl|2xl|3xl)[^"']*border[^"']*p-[4-8]/g, low);
    if (/grid-cols-3/.test(low) && cardLike >= 3) {
      overall.push(issue('repeated-template-pattern', 'medium',
        'A generic "three identical feature cards" grid is present — a common AI-template tell.',
        'Differentiate the cards (varied size/media/rhythm) or replace the grid with a more intentional, business-specific layout.'));
    }
    if (/kx-orb|radial-gradient\(circle/.test(low) && count(/radial-gradient\(circle/g, low) >= 2 && !intent.minimal) {
      overall.push(issue('generic-gradient-hero', 'low',
        'The hero uses the generic glowing-orb/gradient treatment seen in many AI templates.',
        'Consider a hero visual grounded in the actual business (real imagery/product) instead of abstract gradient orbs.'));
    }

    // 5. Weak hierarchy — many sections but effectively one heading level / no scale variation.
    if (sectionCount >= 4 && h1Count >= 1 && h2Count === 0 && !/text-(4xl|5xl|6xl|7xl)/.test(low)) {
      visual.push(issue('weak-hierarchy', 'medium',
        'Type hierarchy looks flat — little heading-level or size variation across sections.',
        'Introduce clear heading levels and a stronger type scale so the eye is guided through the page.'));
    }

    // 6. Bad CTA placement — a landing page with no CTA in the first section.
    if (intent.landingExpected && !intent.appFirst && buttonCount >= 1) {
      const firstSection = blob.split(/<section\b/i)[1] || '';
      if (!/<button\b|<a\b/i.test(firstSection)) {
        ux.push(issue('cta-placement', 'medium',
          'The primary call-to-action does not appear in the first viewport.',
          'Surface a primary CTA in the hero so the main action is reachable above the fold (without adding clutter).'));
      }
    }

    // 7. Poor section rhythm — every section shares the exact same vertical padding.
    const padClasses = (low.match(/\bpy-\d+\b/g) || []);
    if (sectionCount >= 4 && padClasses.length >= sectionCount) {
      const uniq = new Set(padClasses);
      if (uniq.size === 1) {
        layout.push(issue('poor-section-rhythm', 'low',
          'Every section uses identical vertical spacing, giving a monotonous rhythm.',
          'Vary section spacing/backgrounds so the page has intentional pacing instead of a uniform stack.'));
      }
    }

    // 8. Mobile overflow risk — large fixed widths or non-responsive multi-column grids.
    const fixedWide = count(/\b(w|min-w)-\[\d{3,}px\]/g, low);
    const wideGrid = /grid-cols-[4-9]/.test(low) && !/(sm|md|lg):grid-cols-/.test(low);
    if (fixedWide > 0 || wideGrid) {
      mobile.push(issue('mobile-overflow-risk', 'high',
        'Fixed large widths or non-responsive multi-column grids can overflow on mobile.',
        'Use responsive widths (max-w-full, %-based) and add sm:/md: breakpoints to multi-column grids.'));
    }
    if (count(/whitespace-nowrap/g, low) >= 3) {
      mobile.push(issue('mobile-nowrap-risk', 'low',
        'Multiple whitespace-nowrap usages can force horizontal scrolling on small screens.',
        'Limit whitespace-nowrap to short labels; allow wrapping for longer text.'));
    }

    // 9. Unnecessary animations — heavy motion where a low-motion design was intended.
    if (intent.lowMotion) {
      const anim = count(/animate-|motion\.|@keyframes|transition-all/g, low);
      if (anim >= 6) {
        overall.push(issue('unnecessary-animation', 'medium',
          'The output uses substantial animation although a low-motion design was intended.',
          'Remove decorative animation and keep only subtle, purposeful motion (respecting prefers-reduced-motion).'));
      }
    }

    // Bound each category.
    const clip = (xs: VisualEvaluationIssue[]) =>
      xs.slice().sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, MAX_PER_CATEGORY);

    const all = [...overall, ...layout, ...visual, ...ux, ...mobile]
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    const priorityFixes = all.slice(0, MAX_PRIORITY).map((i) => i.suggestion);

    return {
      version: 'visual-evaluation-v1',
      overallIssues: clip(overall),
      layoutIssues: clip(layout),
      visualIssues: clip(visual),
      uxIssues: clip(ux),
      mobileIssues: clip(mobile),
      priorityFixes,
    };
  } catch {
    return undefined;   // fail open — never break validation
  }
}
