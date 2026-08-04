/**
 * Web Build BINDING USER REQUIREMENTS — deterministic extraction (Phase 12G).
 *
 * Pure, network-free, EN/TR-aware extraction of the EXPLICIT functional requirements a user asked
 * for (a named interactive tool + its controls + the visible outcome that must change; required
 * sections; media; navigation/responsive behavior; motion; explicit prohibitions; frontend-only
 * constraints) into ONE bounded, JSON-serializable contract. The SAME normalized contract drives
 * the initial generation contract AND the deterministic acceptance analyzer — it is never
 * reconstructed later from model output or reviewer prose. NEVER makes a model/provider call.
 *
 * Metaphor-safe by construction: an interactive experience requires an actual TOOL NOUN
 * (finder/calculator/configurator/planner/…), so "customer journey" or "interactive experience"
 * alone never becomes a tool; generic marketing words ("platform", "dynamic brand") are ignored.
 * Nothing here is travel-specific: the same rules extract a mortgage calculator, a product
 * configurator, a reservation form, a fitness assessment, a comparison tool, etc.
 */
import type {
  FrontendBindingRequirements, BindingRequirement, BindingControl,
  BindingRequirementKind,
} from '@/lib/webBuildAgents';

/** Minimal structural view of the brief the extractor reads (avoids a cross-module type import). */
export interface BindingBriefLike {
  coreIdea?: string;
  type?: string;
  goal?: string;
  visitorIntent?: string;
}

/* ── Named bounds ─────────────────────────────────────────────────────────── */
const MAX_REQUIREMENTS = 24;
const MAX_CONTROLS = 8;
const MAX_SECTIONS = 12;
const MAX_PROHIBITIONS = 8;
const MAX_LABEL = 64;
const MAX_DETAIL = 96;
const MAX_EVIDENCE = 140;
const MAX_ALIASES = 6;

/* ── Small sanitizers ─────────────────────────────────────────────────────── */
const collapse = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();
const capStr = (s: string, n: number): string => { const t = collapse(s); return t.length > n ? t.slice(0, n).trim() : t; };
function cleanLabel(s: string): string {
  return capStr((s || '').replace(/^[\s"'`([{–—-]+/, '').replace(/[\s"'`)\]}.,;:!?]+$/, ''), MAX_LABEL);
}
function slugOf(s: string, fallback: string): string {
  const base = (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || fallback;
}
function uniqStrings(xs: string[], n: number): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of xs) { const t = collapse(x); const k = t.toLowerCase(); if (t && !seen.has(k)) { seen.add(k); out.push(t); if (out.length >= n) break; } }
  return out;
}

/** Leading filler stripped from a tool label so "an interactive journey finder" → "journey finder". */
const TOOL_FILLER_RE = /^(?:an?|the|our|your|a real|real|working|simple|fully|truly|interactive|dynamic|custom|smart|little|small|nice|beautiful|premium|luxury)\s+/i;

/* ── Interactive-tool nouns (EN + TR). Each match yields ONE interactive-experience. The
 *  capture grabs up to two preceding descriptor words to form a semantic label. ── */
const TOOL_NOUN = '(?:finder|calculator|configurator|planner|estimator|quiz|assessment|wizard|comparison tool|reservation(?:\\s+(?:form|system|widget))?|booking(?:\\s+(?:form|widget|tool))?|quote(?:\\s+(?:form|tool|calculator))?|search(?:\\s*(?:&|and)\\s*filter)?|filtering|selector|builder tool|matcher|bulucu|hesaplama(?:cı)?|planlay[ıi]c[ıi]|rezervasyon|kar[şs][ıi]la[şs]t[ıi]rma)';
const TOOL_RE = new RegExp(`((?:[\\p{L}][\\p{L}-]*\\s+){0,2})(${TOOL_NOUN})\\b`, 'giu');

/* ── Control-enumeration clauses. The capture is a short list scanned near a control verb. ── */
const CONTROL_CLAUSE_RES: RegExp[] = [
  /(?:choose|select|pick|filter\s+by|enter|specify|adjust|set|input|customi[sz]e|configure|toggle)\s+(?:a\s+|the\s+|your\s+|their\s+|between\s+)?([\p{L}0-9 ,/&+-]{3,180})/giu,
  /(?:controls?|inputs?|fields?|options?|parameters?|dimensions?|filters?)\s*(?:for|:|of|include[sd]?|are|such\s+as|like)\s+([\p{L}0-9 ,/&+-]{3,180})/giu,
  /(?:se[çc](?:im|ebilece[ğg]i)|gir(?:ebilece[ğg]i|i[şs])|belirle(?:yebilece[ğg]i)?)\s+([\p{L}0-9 ,/&+-]{3,180})/giu,
];
const LIST_SPLIT_RE = /\s*(?:,|;|\/|&|\band\b|\bor\b|\bve\b|\bveya\b|\bile\b)\s*/giu;
const CONTROL_STOPWORDS = new Set(['etc', 'more', 'so on', 'and so on', 'others', 'the site', 'a backend', 'backend', 'options', 'preferences', 'more options']);

/* ── Dynamic-outcome signals: a change-verb + an output noun. ── */
const OUTPUT_NOUN = '(?:recommendation|recommended\\s+[\\p{L}]+|summary|result|results|price|pricing|total|payment|estimate|quote|preview|output|itinerary|plan|selection\\s+summary|monthly\\s+payment|cost|breakdown|sonu[çc]|[öo]zet|tavsiye|fiyat|tahmin)';
const DYNAMIC_RES: RegExp[] = [
  new RegExp(`(?:update|updates|updating|change|changes|changing|recalculat\\w*|refresh\\w*|adjust\\w*|reflect\\w*|show\\w*\\s+(?:a\\s+)?(?:different|new|updated))\\s+(?:the\\s+|a\\s+|your\\s+)?(${OUTPUT_NOUN})`, 'giu'),
  new RegExp(`(${OUTPUT_NOUN})\\s+(?:should\\s+)?(?:update|updates|change[sd]?|recalculat\\w*|güncelle\\w*|de[ğg]i[şs]\\w*)`, 'giu'),
];

const FRONTEND_ONLY_RE = /\b(?:without\s+(?:\w+\s+){0,2}(?:a\s+|any\s+)?back[- ]?end|without\s+(?:\w+\s+){0,2}(?:a\s+)?server|no\s+back[- ]?end(?:\s+needed)?|no\s+server|does\s+not\s+(?:require|need)\s+(?:a\s+)?(?:back[- ]?end|server)|front[- ]?end[- ]only|client[- ]side\s+only|purely\s+front[- ]?end|backend\s+olmadan|sunucusuz|sadece\s+[öo]n\s*y[üu]z)\b/iu;

/* ── Section / media / behavior / motion / prohibition signals. ── */
const SECTION_NAMED_RE = /([\p{L}][\p{L}0-9 &'-]{2,38}?)\s+section\b/giu;
const SECTION_INCLUDE_RE = /\binclude\s+(?:a\s+|an\s+|the\s+)?([\p{L}][\p{L}0-9 &'-]{2,38}?)(?=[.,;]|\s+section\b|\s+and\b|\s+with\b|$)/giu;
const CTA_RE = /\b([\p{L}][\p{L} -]{0,24}?)?\bc(?:all[- ]to[- ]action|ta)\b/iu;
const NAV_RE = /\b(?:responsive\s+navigation|mobile\s+(?:nav|menu|navigation)|hamburger|nav(?:igation)?\s+(?:that\s+)?collaps\w*|mobil\s+men[üu]|mobil\s+navigasyon)\b/iu;
const RESPONSIVE_RE = /\b(?:responsive|mobile[- ]friendly|mobile[- ]responsive|works?\s+on\s+mobile|adapts?\s+to\s+(?:screen|device)|mobil\s+uyumlu|duyarl[ıi])\b/iu;
const MEDIA_RE = /((?:[\p{L}][\p{L}-]*\s+){0,2})(imagery|photograph(?:y|s)?|photos?|pictures?|images?|gallery|visuals?|g[öo]rsel(?:ler)?|foto[ğg]raf(?:lar)?|resim(?:ler)?|galeri)\b/giu;
const MOTION_RE = /\b((?:purposeful|smooth|subtle|tasteful|cinematic|elegant|gentle)\s+)?(motion|animation|animations|animate[d]?|parallax|transitions?|micro[- ]interactions?|animasyon|hareket)\b/iu;
const PROHIBITION_RE = /\b(?:do\s+not|don'?t|avoid|never|no\s+(?!back[- ]?end|server)|without\s+(?!a\s+back|any\s+back|a\s+server|any\s+server))\s+([\p{L}][\p{L}0-9 &/-]{2,40}?)(?=[.,;!?]|\band\b|\bor\b|$)/giu;

/** Words that must NOT become a "control" (they are the outcome, or generic filler). */
const OUTPUT_TOKENS = /(recommendation|summary|result|price|total|payment|estimate|quote|preview|output|itinerary|breakdown|sonu[çc]|[öo]zet|tavsiye|fiyat)/i;

function pushReq(list: BindingRequirement[], req: BindingRequirement): void {
  if (list.length >= MAX_REQUIREMENTS) return;
  if (list.some((r) => r.kind === req.kind && r.label.toLowerCase() === req.label.toLowerCase())) return;
  list.push(req);
}

/** Extract the control tokens from a captured enumeration clause. */
function parseControls(clause: string): string[] {
  const parts = collapse(clause).split(LIST_SPLIT_RE);
  const out: string[] = [];
  for (const raw of parts) {
    const label = cleanLabel(raw).toLowerCase();
    if (!label) continue;
    const words = label.split(' ');
    if (words.length > 5) continue;                        // prose, not a control
    if (CONTROL_STOPWORDS.has(label)) continue;
    if (OUTPUT_TOKENS.test(label)) continue;               // the outcome, not a control
    if (/^(and|or|the|a|an|your|their|between|different|options?)$/.test(label)) continue;
    out.push(label);
    if (out.length >= MAX_CONTROLS) break;
  }
  return uniqStrings(out, MAX_CONTROLS);
}

function controlAliases(label: string): string[] {
  const l = label.toLowerCase();
  const aliases = [l, l.replace(/\s+/g, ''), l.replace(/\s+/g, '-')];
  // singular helper for simple plural forms
  if (l.endsWith('s') && l.length > 3) aliases.push(l.slice(0, -1));
  return uniqStrings(aliases, MAX_ALIASES);
}

/**
 * Deterministically derive the binding user-requirements contract. Returns undefined when no
 * explicit functional requirement was found (⇒ legacy behavior). Pure + bounded + fail-open.
 */
export function deriveBindingRequirements(prompt: string, brief?: BindingBriefLike): FrontendBindingRequirements | undefined {
  try {
    const primary = collapse(prompt || '');
    if (!primary) return undefined;
    const supporting = collapse([brief?.coreIdea, brief?.type, brief?.goal, brief?.visitorIntent].filter(Boolean).join(' '));
    const hay = `${primary} ${supporting}`.slice(0, 4000);
    const lowerPrompt = primary.toLowerCase();
    const requirements: BindingRequirement[] = [];

    // ── 1. Interactive experience(s) from named tool nouns. ──
    const toolLabels: string[] = [];
    TOOL_RE.lastIndex = 0;
    let tm: RegExpExecArray | null;
    while ((tm = TOOL_RE.exec(primary)) !== null && toolLabels.length < 3) {
      const descriptor = (tm[1] || '').replace(TOOL_FILLER_RE, '').replace(TOOL_FILLER_RE, '');
      const label = cleanLabel(`${descriptor} ${tm[2]}`);
      if (label && label.length >= 3) toolLabels.push(label);
    }

    // ── 2. Controls near control verbs (bounded, deduped). ──
    let controls: string[] = [];
    for (const re of CONTROL_CLAUSE_RES) {
      re.lastIndex = 0;
      let cm: RegExpExecArray | null;
      while ((cm = re.exec(hay)) !== null && controls.length < MAX_CONTROLS) {
        controls = uniqStrings([...controls, ...parseControls(cm[1] || '')], MAX_CONTROLS);
      }
      if (controls.length >= MAX_CONTROLS) break;
    }

    // ── 3. Dynamic outcome (change-verb + output noun). ──
    let dynamicOutcome = '';
    for (const re of DYNAMIC_RES) {
      re.lastIndex = 0; const dm = re.exec(hay);
      if (dm) { dynamicOutcome = cleanLabel(dm[1] || 'recommendation'); break; }
    }

    // ── 4. Frontend-only constraint. ──
    const frontendOnly = FRONTEND_ONLY_RE.test(hay);

    // Attach controls/outcome/frontend-only to an interactive experience when one is warranted:
    // a named tool, OR clear controls (≥2) + a dynamic outcome (a real unnamed tool).
    const controlObjs: BindingControl[] = controls.map((c) => ({ id: slugOf(c, 'control'), label: capStr(c, MAX_LABEL), aliases: controlAliases(c) }));
    const hasInteraction = toolLabels.length > 0 || (controlObjs.length >= 2 && !!dynamicOutcome);
    if (hasInteraction) {
      const label = toolLabels[0] || 'interactive tool';
      pushReq(requirements, {
        id: slugOf(`exp-${label}`, 'interactive-experience'),
        kind: 'interactive-experience',
        label: capStr(label, MAX_LABEL),
        required: true,
        strength: toolLabels.length > 0 ? 'explicit' : 'strong',
        evidence: capStr(`explicit interactive tool requested: ${label}${controlObjs.length ? ` with ${controlObjs.length} control(s)` : ''}`, MAX_EVIDENCE),
        controls: controlObjs.length ? controlObjs : undefined,
        dynamicOutcome: dynamicOutcome || undefined,
        frontendOnly: frontendOnly || undefined,
      });
      // A second named tool becomes its own (control-less) interaction.
      for (const extra of toolLabels.slice(1)) {
        pushReq(requirements, {
          id: slugOf(`exp-${extra}`, 'interactive-experience'),
          kind: 'interactive-experience', label: capStr(extra, MAX_LABEL),
          required: true, strength: 'explicit',
          evidence: capStr(`explicit interactive tool requested: ${extra}`, MAX_EVIDENCE),
        });
      }
      if (dynamicOutcome) {
        pushReq(requirements, {
          id: slugOf(`outcome-${dynamicOutcome}`, 'dynamic-outcome'),
          kind: 'dynamic-outcome', label: capStr(dynamicOutcome, MAX_LABEL),
          detail: capStr(`the ${dynamicOutcome} must visibly change from the user's selections`, MAX_DETAIL),
          required: true, strength: 'explicit',
          evidence: capStr(`explicit dynamic outcome: ${dynamicOutcome} updates from selections`, MAX_EVIDENCE),
        });
      }
      if (frontendOnly) {
        pushReq(requirements, {
          id: 'frontend-only', kind: 'frontend-only', label: 'frontend-only (no backend)',
          required: true, strength: 'explicit',
          evidence: 'explicit: must work client-side with no invented backend/API',
        });
      }
    }

    // ── 5. Named sections/modules. ──
    const sectionLabels: string[] = [];
    for (const re of [SECTION_NAMED_RE, SECTION_INCLUDE_RE]) {
      re.lastIndex = 0; let sm: RegExpExecArray | null;
      while ((sm = re.exec(primary)) !== null && sectionLabels.length < MAX_SECTIONS) {
        const l = cleanLabel(sm[1] || '');
        if (l && l.split(' ').length <= 5) sectionLabels.push(l);
      }
    }
    if (CTA_RE.test(lowerPrompt)) sectionLabels.push('call-to-action');
    for (const l of uniqStrings(sectionLabels, MAX_SECTIONS)) {
      pushReq(requirements, {
        id: slugOf(`section-${l}`, 'section'), kind: 'section', label: capStr(l, MAX_LABEL),
        required: true, strength: 'explicit',
        evidence: capStr(`explicit section requested: ${l}`, MAX_EVIDENCE),
        aliases: uniqStrings([l.toLowerCase(), l.toLowerCase().replace(/\s+/g, '')], MAX_ALIASES),
      });
    }

    // ── 6. Behavior: navigation + responsive. ──
    if (NAV_RE.test(lowerPrompt)) {
      pushReq(requirements, {
        id: 'behavior-navigation', kind: 'behavior-navigation', label: 'working (mobile) navigation',
        required: true, strength: 'explicit',
        evidence: 'explicit: responsive/mobile navigation must actually toggle a nav panel',
      });
    }
    if (RESPONSIVE_RE.test(lowerPrompt)) {
      pushReq(requirements, {
        id: 'behavior-responsive', kind: 'behavior-responsive', label: 'responsive layout',
        required: true, strength: 'explicit',
        evidence: 'explicit: responsive / mobile-friendly layout requested',
      });
    }

    // ── 7. Media / imagery. ──
    MEDIA_RE.lastIndex = 0; const mm = MEDIA_RE.exec(primary);
    if (mm) {
      const qualifier = (mm[1] || '').replace(TOOL_FILLER_RE, '').trim();
      const label = cleanLabel(`${qualifier} ${mm[2]}`) || 'imagery';
      pushReq(requirements, {
        id: slugOf(`media-${label}`, 'media'), kind: 'media', label: capStr(label, MAX_LABEL),
        required: true, strength: 'explicit',
        evidence: capStr(`explicit media requested: ${label} (real rendered imagery, not decorative gradients/shapes)`, MAX_EVIDENCE),
        aliases: uniqStrings([qualifier.toLowerCase(), 'photo', 'photograph', 'image'].filter(Boolean), MAX_ALIASES),
      });
    }

    // ── 8. Motion (recorded; enforced by the existing motion contract — not re-analyzed here). ──
    if (MOTION_RE.test(lowerPrompt)) {
      pushReq(requirements, {
        id: 'motion', kind: 'motion', label: 'purposeful motion',
        required: true, strength: 'explicit',
        evidence: 'explicit: purposeful motion/animation requested (enforced by the motion contract, reduced-motion aware)',
      });
    }

    // ── 9. Explicit prohibitions (never the frontend-only "no backend"). ──
    PROHIBITION_RE.lastIndex = 0; let pm: RegExpExecArray | null; let pcount = 0;
    while ((pm = PROHIBITION_RE.exec(primary)) !== null && pcount < MAX_PROHIBITIONS) {
      const l = cleanLabel(pm[1] || '');
      if (!l || l.split(' ').length > 5) continue;
      if (/back[- ]?end|server/i.test(l)) continue;
      pushReq(requirements, {
        id: slugOf(`no-${l}`, 'prohibition'), kind: 'prohibition', label: capStr(l, MAX_LABEL),
        required: true, strength: 'explicit',
        evidence: capStr(`explicit prohibition: do not include ${l}`, MAX_EVIDENCE),
        aliases: uniqStrings([l.toLowerCase()], MAX_ALIASES),
      });
      pcount += 1;
    }

    if (requirements.length === 0) return undefined;

    const counts = {
      total: requirements.length,
      section: requirements.filter((r) => r.kind === 'section').length,
      interaction: requirements.filter((r) => r.kind === 'interactive-experience').length,
      control: requirements.reduce((n, r) => n + (r.controls?.length || 0), 0),
      dynamicOutcome: requirements.filter((r) => r.kind === 'dynamic-outcome').length,
      behavior: requirements.filter((r) => r.kind === 'behavior-navigation' || r.kind === 'behavior-responsive').length,
      media: requirements.filter((r) => r.kind === 'media').length,
      motion: requirements.filter((r) => r.kind === 'motion').length,
      prohibition: requirements.filter((r) => r.kind === 'prohibition').length,
    };
    return { version: 'binding-requirements-v1', requirements, counts };
  } catch {
    return undefined;
  }
}

/* ── Compact generation-contract rendering (bounded, imperative acceptance conditions). ── */
/**
 * Render the binding requirements into a compact, token-efficient block for the frontend-builder
 * request. Tells the builder these are ACCEPTANCE CONDITIONS with real functional obligations.
 * Composes with (never duplicates) the motion contract. Returns [] when absent.
 */
export function renderBindingRequirementsBlock(binding: FrontendBindingRequirements | undefined): string[] {
  if (!binding || !binding.requirements.length) return [];
  const lines: string[] = [
    'BINDING USER REQUIREMENTS — these are ACCEPTANCE CONDITIONS, not optional inspiration. The',
    'generated project MUST implement each item as REAL frontend behavior; a matching label, heading,',
    'decorative chart, static mockup or unrelated tab does NOT satisfy a functional requirement.',
  ];
  const by = (k: BindingRequirementKind) => binding.requirements.filter((r) => r.kind === k);

  for (const exp of by('interactive-experience')) {
    lines.push(`- REQUIRED interactive experience "${exp.label}": build a REAL stateful tool with actual controls, event/change handlers, local component state, and a visible output derived from that state. It must WORK client-side.`);
    const ctrls = exp.controls || [];
    if (ctrls.length) {
      lines.push(`  - REQUIRED controls (each must exist as a SEPARATE, labelled, keyboard-usable control — one generic input cannot cover several): ${ctrls.map((c) => c.label).join(', ')}.`);
    }
    if (exp.dynamicOutcome) {
      lines.push(`  - REQUIRED dynamic outcome: the "${exp.dynamicOutcome}" must VISIBLY change when the user changes any control (real derived output tied to state — never static placeholder text, an animation alone, or an unrelated carousel/tab switch).`);
    }
    if (exp.frontendOnly) {
      lines.push('  - This tool MUST work with local deterministic state/data ONLY — do NOT invent backend/API/network calls.');
    }
  }
  const sections = by('section');
  if (sections.length) lines.push(`- REQUIRED sections/modules (materially implemented, not just a heading): ${sections.map((s) => s.label).join('; ')}.`);
  if (by('behavior-navigation').length) lines.push('- REQUIRED working navigation: mobile navigation must actually open/close a real nav panel via component state — not a static hamburger icon.');
  if (by('behavior-responsive').length) lines.push('- REQUIRED responsive behavior: the layout must adapt across breakpoints with real responsive CSS.');
  for (const m of by('media')) lines.push(`- REQUIRED media "${m.label}": include real rendered imagery (semantic <img>/picture/background image or a provided asset slot) — an empty placeholder, gradient or CSS shape does NOT satisfy an explicit photography/image requirement.`);
  const prohibitions = by('prohibition');
  if (prohibitions.length) lines.push(`- PROHIBITED (must NOT appear): ${prohibitions.map((p) => p.label).join('; ')}.`);
  // Motion intentionally deferred to the existing motion contract (composed, not duplicated).
  return lines;
}
