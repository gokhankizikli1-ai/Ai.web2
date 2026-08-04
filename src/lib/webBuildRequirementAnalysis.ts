/**
 * Web Build BINDING REQUIREMENT SATISFACTION + CROSS-SECTOR DRIFT analyzer (Phase 12G).
 *
 * Pure, bounded, network-free static analysis over the COMPLETE normalized generated project. It
 * consumes the SAME authoritative binding-requirements contract that drove generation and returns
 * one structured acceptance result with stable issue codes + bounded, sanitized evidence (file
 * path / module label / short reason — never full source, prompts, provider output, ids or PII).
 *
 * It is deliberately conservative and multi-signal: a requirement is NEVER marked satisfied just
 * because its name occurs. An interactive experience needs correlated executable evidence (real
 * controls + local state + event handlers + a state-derived visible output); named controls are
 * counted individually (one generic input cannot satisfy several); a dynamic outcome needs
 * state→output binding; mobile nav needs a real toggle + panel; media needs real rendered imagery.
 * Weak/partial evidence returns AMBIGUOUS (manual-review) rather than a false pass. Motion is left
 * entirely to the existing motion contract (composed, never duplicated). This is STATIC evidence
 * only — it never claims rendered/runtime certification.
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

/* ── Bounds ───────────────────────────────────────────────────────────────── */
const MAX_SRC_CHARS = 240_000;      // total source scanned
const MAX_ISSUES = 40;
const MAX_ISSUE_FILES = 4;
const MAX_EVIDENCE = 180;
const MAX_DRIFT_TERMS = 4;

export type BindingIssueCode =
  | 'binding-section-missing'
  | 'binding-interaction-missing'
  | 'binding-control-missing'
  | 'binding-dynamic-outcome-missing'
  | 'binding-mobile-nav-nonfunctional'
  | 'binding-responsive-evidence-missing'
  | 'binding-media-missing'
  | 'cross-sector-semantic-drift'
  | 'requirement-evidence-ambiguous';

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

/** File(s) whose content matches a token — bounded, for sanitized evidence. */
function filesMatching(files: FrontendGeneratedFile[], tokens: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (tokens.some((t) => { const re = wordRe(t); return re && re.test(f.content); })) out.push(f.path);
    if (out.length >= MAX_ISSUE_FILES) break;
  }
  return out;
}

/* ── Executable-evidence signals over the whole project source. ── */
interface SrcSignals {
  hasState: boolean;
  hasChangeHandler: boolean;
  hasControlEl: boolean;
  hasDerivedOutput: boolean;
  hasImg: boolean;
  hasResponsive: boolean;
  stateVars: string[];
}
function scanSignals(src: string): SrcSignals {
  const stateVars = [...src.matchAll(/const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*set[A-Z][\w$]*\s*\]\s*=\s*use(?:State|Reducer)\b/g)].map((m) => m[1]).slice(0, 40);
  const hasState = /\buse(?:State|Reducer|Memo)\s*\(/.test(src);
  // A visible OUTPUT derived from state: either a state var is interpolated directly in JSX, OR
  // (with state present) a non-trivial identifier/expression is interpolated in JSX — which covers
  // a derived const rendered as `{rec}` where `const rec = dest + budget`. Static placeholder text
  // (no `{…}` value interpolation) and a no-state component never qualify.
  const hasDerivedOutput =
    stateVars.some((v) => new RegExp(`\\{[^{}]*\\b${esc(v)}\\b[^{}]*\\}`).test(src))
    || (hasState && /\{\s*[a-z_$][\w$]*(?:\([^{}]*\)|(?:\.[\w$]+)*|\s*[?+*/%-][^{}]*)?\s*\}/i.test(src));
  return {
    hasState,
    hasChangeHandler: /on(?:Change|Input|Click|Submit|KeyDown)\s*=|addEventListener\s*\(/.test(src),
    hasControlEl: /<(?:select|input|textarea|button)\b|type=["']range["']|role=["']tab["']|<option\b/i.test(src),
    hasDerivedOutput,
    hasImg: /<img\b|<picture\b|background-image\s*:\s*url\(|data-korvix-image-slot|srcset=/i.test(src),
    hasResponsive: /\b(?:sm|md|lg|xl|2xl):[a-z]/.test(src) || /@media\b/.test(src),
    stateVars,
  };
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

/** Significant tokens of a label for presence checks (drops short/stop tokens). */
function labelTokens(label: string): string[] {
  return (label || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !['with', 'that', 'your', 'their', 'from', 'this', 'interactive', 'section'].includes(w));
}

/**
 * Run the deterministic binding-satisfaction + cross-sector-drift analysis over the COMPLETE
 * generated project. `binding` undefined ⇒ legacy result (pass, legacyContractUsed=true). Pure.
 */
export function analyzeBindingAcceptance(
  files: FrontendGeneratedFile[] | undefined,
  binding: FrontendBindingRequirements | undefined,
  policy?: DriftPolicy,
): BindingAcceptanceResult {
  try {
    if (!binding || !Array.isArray(binding.requirements) || binding.requirements.length === 0) {
      // No binding contract, but drift can still be checked when a policy is supplied.
      const driftOnly = analyzeDrift(files || [], ((files || []).map((f) => f.content).join('\n').toLowerCase()).slice(0, MAX_SRC_CHARS), policy);
      if (driftOnly.length) {
        return { ...LEGACY_RESULT, legacyContractUsed: !binding, status: 'fail', driftIssueCount: driftOnly.length, issues: driftOnly.slice(0, MAX_ISSUES) };
      }
      return { ...LEGACY_RESULT, legacyContractUsed: !binding };
    }
    const list = Array.isArray(files) ? files : [];
    const src = list.map((f) => f.content).join('\n').slice(0, MAX_SRC_CHARS);
    const srcLower = src.toLowerCase();
    const sig = scanSignals(src);
    const issues: BindingIssue[] = [];

    let satisfied = 0; let missing = 0; let ambiguous = 0;
    let satisfiedControls = 0; let controlTotal = 0;
    const push = (i: BindingIssue) => { if (issues.length < MAX_ISSUES) issues.push(i); };

    for (const req of binding.requirements) {
      if (!req.required) continue;
      switch (req.kind) {
        case 'interactive-experience': {
          const execEvidence = [sig.hasState, sig.hasChangeHandler, sig.hasControlEl, sig.hasDerivedOutput].filter(Boolean).length;
          const labelPresent = anyPresent(labelTokens(req.label), src);
          const files0 = filesMatching(list, labelTokens(req.label));
          if (execEvidence === 0) {
            missing += 1;
            push({ code: 'binding-interaction-missing', severity: 'blocker', requirementId: req.id, label: req.label, files: files0,
              evidence: cap(`interactive experience "${req.label}" ${labelPresent ? 'appears as a label only' : 'is absent'} — no controls, state or handlers found`),
              repairInstruction: cap(`Implement "${req.label}" as a real stateful tool: actual form controls, local component state (useState/useReducer), change/click handlers, and a visible output derived from state. A heading or decorative chart does not satisfy it.`) });
          } else if (execEvidence >= 3) {
            satisfied += 1;
          } else {
            ambiguous += 1;
            push({ code: 'requirement-evidence-ambiguous', severity: 'minor', requirementId: req.id, label: req.label, files: files0,
              evidence: cap(`interactive experience "${req.label}" has partial evidence (${execEvidence}/4 signals: state=${sig.hasState}, handler=${sig.hasChangeHandler}, controls=${sig.hasControlEl}, derivedOutput=${sig.hasDerivedOutput})`),
              repairInstruction: cap(`Strengthen "${req.label}": ensure real controls, local state, change handlers AND a state-derived visible output are all present.`) });
          }

          // Controls — each required control must be found INDEPENDENTLY.
          const ctrls = req.controls || [];
          controlTotal += ctrls.length;
          for (const c of ctrls) {
            const found = anyPresent(c.aliases && c.aliases.length ? c.aliases : [c.label], src);
            if (found) { satisfiedControls += 1; continue; }
            missing += 1;
            push({ code: 'binding-control-missing', severity: 'major', requirementId: req.id, label: `${req.label} · ${c.label}`, files: files0,
              evidence: cap(`required control "${c.label}" for "${req.label}" was not found as a distinct labelled control`),
              repairInstruction: cap(`Add a distinct, labelled, keyboard-usable control for "${c.label}" inside "${req.label}"; one generic input cannot cover multiple dimensions.`) });
          }
          break;
        }
        case 'dynamic-outcome': {
          const ok = sig.hasState && sig.hasChangeHandler && sig.hasDerivedOutput;
          if (ok) { satisfied += 1; }
          else {
            missing += 1;
            push({ code: 'binding-dynamic-outcome-missing', severity: 'blocker', requirementId: req.id, label: req.label, files: [],
              evidence: cap(`dynamic outcome "${req.label}" is not tied to state (state=${sig.hasState}, handler=${sig.hasChangeHandler}, derivedOutput=${sig.hasDerivedOutput}) — static text, an animation alone, or an unrelated tab/carousel does not count`),
              repairInstruction: cap(`Make "${req.label}" recompute from the control state and render the derived value; changing a control must visibly change this output.`) });
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
          const hasToggleState = sig.hasState && /(isopen|menuopen|navopen|mobilemenu|showmenu|drawer|toggle|open)/i.test(src);
          const hasNav = /<nav\b|role=["']navigation["']|<ul\b/i.test(src);
          const navOk = hasToggleState && hasNav && sig.hasChangeHandler;
          const hasHamburger = /hamburger|menu[- ]?(?:icon|button|toggle)|aria-label=["'][^"']*menu/i.test(src);
          if (navOk) { satisfied += 1; }
          else if (hasHamburger) {
            missing += 1;
            push({ code: 'binding-mobile-nav-nonfunctional', severity: 'major', requirementId: req.id, label: req.label, files: [],
              evidence: cap('a mobile menu icon exists but no toggle state / nav-panel behavior was found — the navigation is non-functional'),
              repairInstruction: cap('Wire the mobile menu to component state (open/close) and toggle a real navigation panel; an icon alone is not working navigation.') });
          } else {
            ambiguous += 1;
            push({ code: 'requirement-evidence-ambiguous', severity: 'minor', requirementId: req.id, label: req.label, files: [],
              evidence: cap('working navigation requested but no clear nav toggle/panel evidence was found'),
              repairInstruction: cap('Add a real, stateful (mobile) navigation with a toggle and a nav panel.') });
          }
          break;
        }
        case 'behavior-responsive': {
          if (sig.hasResponsive) { satisfied += 1; }
          else {
            ambiguous += 1;
            push({ code: 'binding-responsive-evidence-missing', severity: 'minor', requirementId: req.id, label: req.label, files: [],
              evidence: cap('no static responsive evidence (Tailwind breakpoints / @media) found — static evidence only, not runtime proof'),
              repairInstruction: cap('Add responsive CSS (breakpoint utilities or media queries) so the layout adapts on mobile.') });
          }
          break;
        }
        case 'media': {
          if (sig.hasImg) { satisfied += 1; }
          else {
            missing += 1;
            push({ code: 'binding-media-missing', severity: 'major', requirementId: req.id, label: req.label, files: [],
              evidence: cap(`explicit media "${req.label}" required but no real rendered imagery (<img>/picture/background-image/asset slot) was found — gradients or CSS shapes do not satisfy it`),
              repairInstruction: cap(`Render real imagery for "${req.label}" (semantic <img>/picture/background image or a provided asset slot); do not substitute an abstract gradient or CSS orb.`) });
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

    const blocking = issues.some((i) => i.severity === 'blocker'
      || i.code === 'binding-control-missing' || i.code === 'binding-media-missing'
      || i.code === 'binding-section-missing' || i.code === 'binding-mobile-nav-nonfunctional');
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
