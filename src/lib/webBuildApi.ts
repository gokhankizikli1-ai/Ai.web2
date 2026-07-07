/**
 * Web Build API client — KorvixAI Web Build workspace.
 *
 * Unlike the old client-side-only preview, Web Build now POSTs the user's
 * idea to the SAME non-streaming `/chat` backend the rest of the app uses,
 * pinned to the dedicated `website_builder` AI mode. That mode returns a real
 * structured build package (Build Plan → Design Direction → Page Sections →
 * Generated Copy → Frontend Code → Next Steps) which we parse into sections
 * for the UI.
 *
 * Language: the resolved app locale is attached to every request (see
 * getRequestLocale) so the backend answer-language policy generates the whole
 * build — plan, copy, notes — in the user's selected language.
 *
 * Base URL resolution mirrors gameBuilderApi.ts / useChat.ts.
 */
import { getRequestLocale } from '@/lib/locale';
import { parseBuildSections, type BuildSection } from '@/lib/gameBuilderApi';
import { type BuilderMode, buildModeContext } from '@/lib/builderMode';

/** The canonical backend AI mode for this workspace. Must match the mode
 *  registered in backend/services/ai/mode_manager.py. */
export const WEBSITE_BUILDER_MODE = 'website_builder' as const;

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

function apiBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

function getUserId(): string {
  const key = 'korvix_user_id';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now()}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'guest_anon';
  }
}

/** The canonical H2 sections a full Web Build reply should contain. */
export const WEB_BUILD_SECTIONS = [
  'Build Plan', 'Design Direction', 'Page Sections',
  'Generated Copy', 'Frontend Code', 'Next Steps',
] as const;

/** A real research source returned by the backend web_research pre-pass. Only
 *  present when a tool actually ran and returned a URL. */
export interface WebBuildSource { title: string; url: string; snippet?: string }

/** Honest research status for a fresh build. Backend always sends this for a
 *  website_builder build so research can never silently fail:
 *    used_sources — real providers ran and returned real URLs
 *    disabled     — research is off / no provider configured
 *    failed       — a provider was attempted but errored
 *    no_sources   — a provider ran but returned nothing usable
 *  When `didResearch` is false, `fallbackReason` explains why (owner/admin). */
export type WebBuildResearchStatus =
  | 'used_sources' | 'disabled' | 'failed' | 'no_sources' | 'fallback_strategy';

export interface WebBuildResearch {
  didResearch: boolean;
  status: WebBuildResearchStatus;
  provider?: string;
  attemptedProviders?: string[];
  queryCount?: number;
  /** Distinct research angles covered (category, audience, conversion, …). */
  angles?: string[];
  sourceCount?: number;
  fallbackReason?: string;
  sources?: WebBuildSource[];
}

export interface WebBuildResult {
  reply: string;
  sections: BuildSection[];
  model: string;
  mode: string;
  requestId: string;
  /** True when the reply parsed but was incomplete (fallback/partial output
   *  is being shown rather than throwing the whole result away). */
  partial: boolean;
  /** Real research sources (backend web_research). Empty/undefined when no
   *  live research ran — the UI must NOT claim research in that case. */
  sources?: WebBuildSource[];
  /** True only when the backend actually ran research tools. */
  didResearch?: boolean;
  /** Full, honest research status (present for a fresh website_builder build). */
  research?: WebBuildResearch;
}

/**
 * Extracted strategy/brief fields (best-effort, from Build Plan + Design
 * Direction). Every field is OPTIONAL and backward compatible — old saved
 * builds that only carry type/audience/goal/style still load. The richer fields
 * let the frontend drive activity detail, preview visuals and file synthesis
 * from the model's ACTUAL strategy instead of a fixed industry key.
 */
export interface WebBuildBrief {
  type?: string; audience?: string; goal?: string; style?: string;
  // Build Plan strategy
  coreIdea?: string; visitorIntent?: string; strategyInsight?: string;
  conversionStrategy?: string; trustSignals?: string;
  primaryCTA?: string; secondaryCTA?: string;
  // Design Direction
  visualMood?: string; layoutLogic?: string; typographyDirection?: string;
  colorDirection?: string; visualMetaphor?: string; motionDirection?: string;
  // AI-native WEBSITE EXPERIENCE PLAN (Phase 3) — the MODEL's own decision about
  // the website + FRONT-END DEMO architecture (never a real product/backend). All
  // optional & backward compatible; parsed by extractBrief and PREFERRED by the
  // Strategy Agent + Interaction Contract over deterministic keyword fallbacks.
  websiteExperienceModel?: string;
  pageScreenModel?: string;
  primaryWebsiteExperience?: string;
  demoSurfaces?: string;
  statefulDemoComponents?: string;
  navigationModel?: string;
  mediaMotionPlan?: string;
  // UI / Art Director agent palette override (Phase 1). All optional →
  // backward compatible. When set, these drive the design tokens directly so the
  // Art Direction actually controls the preview/files palette + heading style.
  artAccent?: string; artAccent2?: string; artBg?: string; artHeadingSerif?: boolean;
  // Agent pipeline STRUCTURE overrides. The agents (Research/UI/Strategy) decide
  // the layout archetype / hero composition / primary visual module and inject them
  // here, so deriveLayoutPlan (used by BOTH preview and files) obeys the agents
  // instead of re-detecting the archetype from prose. Plain strings (validated at
  // the plan layer) to avoid an import cycle; all optional and backward compatible.
  agentArchetype?: string; agentHero?: string; agentModule?: string;
  // RENDERABLE Art Direction identity — the UI / Art Director's chosen identity,
  // persisted onto the brief so BOTH the preview and the generated files can render
  // the same concept-specific surface/proof/hero language (not just palette). All
  // optional & backward compatible; populated in enrichBriefWithAgents from the
  // ArtDirectionArtifact and consumed via deriveWebBuildArtIdentity().
  artDesignArchetype?: string;
  artVisualSignature?: string;
  artAntiTemplateDiagnosis?: string;
  artCompositionRules?: string[];
  artSurfaceRules?: string[];
  artProofRules?: string[];
  artImageryDirection?: string;
  artHeroTreatment?: string;
  artComponentStyle?: string;
}

/** Pull the labeled strategy lines out of the Build Plan / Design Direction. */
export function extractBrief(sections: BuildSection[]): WebBuildBrief {
  const plan = sections.find((s) => /build\s*plan/i.test(s.title));
  const design = sections.find((s) => /design\s*direction/i.test(s.title));
  const body = `${plan?.body || ''}\n${design?.body || ''}`;
  const grab = (re: RegExp): string | undefined => {
    const m = body.match(re);
    if (!m) return undefined;
    const v = m[1].split(/\n/)[0].replace(/^[\s:–\-*]+/, '').replace(/\*+$/, '').trim();
    return v || undefined;
  };
  return {
    type: grab(/(?:website\s*type|type)\s*[:\-–]\s*(.+)/i),
    audience: grab(/(?:audience|target\s*audience)\s*[:\-–]\s*(.+)/i),
    goal: grab(/(?:primary\s*goal|goal|conversion\s*goal)\s*[:\-–]\s*(.+)/i),
    style: grab(/(?:visual\s*mood|tone|style|mood|design\s*style)\s*[:\-–]\s*(.+)/i),
    coreIdea: grab(/(?:core\s*idea)\s*[:\-–]\s*(.+)/i),
    visitorIntent: grab(/(?:visitor\s*intent)\s*[:\-–]\s*(.+)/i),
    strategyInsight: grab(/(?:strategy\s*insight)\s*[:\-–]\s*(.+)/i),
    conversionStrategy: grab(/(?:conversion\s*strategy)\s*[:\-–]\s*(.+)/i),
    trustSignals: grab(/(?:trust\s*signals?)\s*[:\-–]\s*(.+)/i),
    primaryCTA: grab(/(?:primary\s*cta)\s*[:\-–]\s*(.+)/i),
    secondaryCTA: grab(/(?:secondary\s*cta)\s*[:\-–]\s*(.+)/i),
    visualMood: grab(/(?:visual\s*mood)\s*[:\-–]\s*(.+)/i),
    layoutLogic: grab(/(?:layout\s*logic|layout\s*archetype)\s*[:\-–]\s*(.+)/i),
    typographyDirection: grab(/(?:typography\s*direction|typography)\s*[:\-–]\s*(.+)/i),
    colorDirection: grab(/(?:color\s*direction|colou?r)\s*[:\-–]\s*(.+)/i),
    visualMetaphor: grab(/(?:visual\s*metaphor)\s*[:\-–]\s*(.+)/i),
    motionDirection: grab(/(?:motion\s*direction|motion\s*system|motion)\s*[:\-–]\s*(.+)/i),
    // AI-native Website Experience Plan (Phase 3) — exact labels, all optional.
    websiteExperienceModel: grab(/(?:website\s*experience\s*model|experience\s*model)\s*[:\-–]\s*(.+)/i),
    pageScreenModel: grab(/(?:page\s*\/?\s*screen\s*model|page\s*model|screen\s*model)\s*[:\-–]\s*(.+)/i),
    primaryWebsiteExperience: grab(/(?:primary\s*website\s*experience|primary\s*experience)\s*[:\-–]\s*(.+)/i),
    demoSurfaces: grab(/(?:demo\s*surfaces?)\s*[:\-–]\s*(.+)/i),
    statefulDemoComponents: grab(/(?:stateful\s*demo\s*components?|demo\s*components?)\s*[:\-–]\s*(.+)/i),
    navigationModel: grab(/(?:navigation\s*model|nav\s*model)\s*[:\-–]\s*(.+)/i),
    mediaMotionPlan: grab(/(?:media\s*\/?\s*motion\s*plan|media\s*plan)\s*[:\-–]\s*(.+)/i),
  };
}

/** Best-effort file list from the Frontend Code section's `### <path>` heads. */
export function extractFiles(sections: BuildSection[]): string[] {
  const code = sections.find((s) => /frontend\s*code|code/i.test(s.title));
  if (!code) return [];
  const files = [...code.body.matchAll(/^###\s+(.+?)\s*$/gm)].map((m) => m[1].trim());
  return Array.from(new Set(files)).slice(0, 24);
}

/** Where a Web Build failed — drives the friendly, specific error message. */
export type WebBuildErrorKind =
  | 'empty_prompt' | 'network' | 'http' | 'unreadable'
  | 'empty' | 'invalid' | 'timeout' | 'cancelled';

export class WebBuildError extends Error {
  readonly kind: WebBuildErrorKind;
  readonly reason?: unknown;
  constructor(kind: WebBuildErrorKind, message: string, reason?: unknown) {
    super(message);
    this.name = 'WebBuildError';
    this.kind = kind;
    this.reason = reason;
  }
}

/** The i18n key for the friendly user-facing message per error kind. */
export function webBuildErrorKeyFor(kind: WebBuildErrorKind): string {
  switch (kind) {
    case 'network': return 'wbErrNetwork';
    case 'timeout': return 'wbErrTimeout';
    case 'empty':   return 'wbErrEmpty';
    default:        return 'wbErrGeneric';
  }
}

const BUILD_TIMEOUT_MS = 90_000;

/**
 * Wrap the raw idea in the [WEB BUILD REQUEST] block the website_builder mode
 * knows how to read. For a section-level revision we pass the previous build
 * so the model can update ONE section and preserve the rest.
 */
export function buildWebBuildRequest(
  idea: string,
  opts?: { revise?: boolean; previousReply?: string; mode?: BuilderMode | null },
): string {
  const lines: string[] = ['[WEB BUILD REQUEST]'];
  // Selected build mode is hidden context — it shapes what gets built without
  // ever appearing in the user's message or the persisted prompt.
  const modeCtx = buildModeContext(opts?.mode);
  if (modeCtx) lines.push(`BUILD CONTEXT: ${modeCtx}`, '');
  if (opts?.revise) {
    lines.push(
      'This is a REVISION of an existing website. Apply ONLY the change the user asks for',
      'and keep every other section exactly as it was. Re-output the full build with the',
      'targeted section(s) updated. Keep the same premium bar: specific copy, a strong',
      'conversion path, tasteful motion — never downgrade a section to generic filler.',
      'SCOPE stays WEBSITE + FRONT-END DEMO ONLY: never add a real backend, AI runtime,',
      'database, payments, auth, CRM, real search or real AI logic — demo surfaces are',
      'local, static illustrations only. Preserve the Website Experience Plan fields',
      '(experience model, page/screen model, navigation model, demo surfaces, stateful',
      'demo components) unless the requested change explicitly alters them.',
    );
    if (opts.previousReply) {
      lines.push('', 'PREVIOUS BUILD (preserve unless the change touches it):', opts.previousReply);
    }
    lines.push('', `Requested change: ${idea}`);
  } else {
    lines.push(
      'You are a SENIOR product designer + front-end engineer. Build a real,',
      'premium, production-grade website for the idea below by REASONING FROM THE',
      'IDEA ITSELF — not from a fixed industry template. Two very different ideas',
      'must produce genuinely different structure, visuals and copy because their',
      'strategy is different. Interpret unusual, niche or sophisticated ideas on',
      'their own terms.',
      '',
      'SCOPE — WEBSITE + FRONT-END DEMO ONLY: Build the website and front-end demo',
      'surfaces only. Do not implement the actual product\'s backend, AI runtime,',
      'database, payments, authentication, CRM, real search engine, or real AI',
      'conversation logic. When the idea is a product (AI chatbot, marketplace,',
      'archive, SaaS, store, service…), the site must COMMUNICATE and DEMONSTRATE the',
      'experience — not build it: e.g. a chat / product demo panel with sample',
      'conversation bubbles + feature callouts, listing cards with filters and a',
      'detail preview, a quote / contact / access request FORM SHELL. These are',
      'local, client-side illustrations built from static/sample copy only — no',
      'network or backend, no real AI output, no real submissions/payments/orders/',
      'live inventory/search results, and never a claim that the product is running.',
      '',
      'STEP 1 — RESEARCH & STRATEGY (do this before writing any build):',
      '- Interpret what the idea actually is (business / product / concept / model).',
      '- Work out why someone visits, what they must understand fast, the emotional',
      '  impression to create, the trust barriers, and the single primary conversion.',
      '- Decide the layout logic, the visual metaphor, the sections that genuinely',
      '  fit THIS concept, and the motion that supports it.',
      'RESEARCH: If you have web search / browsing / research tools available, USE',
      'them now to study adjacent sites, the product category, audience expectations',
      'and conversion patterns — as inspiration, not copying — and fold real findings',
      'into "Strategy insight". Include source URLs in Build Plan ONLY if a tool',
      'actually returned them. If you have NO live tools, reason from knowledge and',
      'label it "Strategy insight" — do NOT invent URLs, sources, competitors,',
      'statistics, or claim you browsed/researched anything you did not fetch.',
      '',
      'STEP 2 — OUTPUT. Keep these EXACT H2 sections (the parser depends on them),',
      'and inside the first two use these EXACT labeled fields, one per line:',
      '',
      '## Build Plan',
      'Website type: <…>',
      'Core idea: <one line: what this site is>',
      'Audience: <…>',
      'Visitor intent: <what the visitor is trying to do>',
      'Primary goal: <the single conversion>',
      'Strategy insight: <the key insight from research/analysis that shapes the site>',
      'Conversion strategy: <how the page drives the goal>',
      'Trust signals: <the proof this concept needs>',
      'Primary CTA: <specific action>',
      'Secondary CTA: <specific action>',
      '',
      '## Design Direction',
      'Visual mood: <…>',
      'Layout logic: <how sections are organized & why>',
      'Typography direction: <headline/body personality>',
      'Color direction: <palette intent, e.g. deep botanical greens / warm dining amber>',
      'Visual metaphor: <the core visual idea, e.g. topographic garden plan / live dashboard>',
      'Motion direction: <what animates and why>',
      'Responsive behavior: <…>',
      '— WEBSITE EXPERIENCE PLAN — DECIDE these from THIS idea (they drive the site',
      '  architecture). Website + front-end demo ONLY; never a real backend/AI/db/',
      '  payments/search. Use these EXACT labels, one per line:',
      'Website experience model: <single-page landing | multi-page marketing site | product demo site | catalog/listing site | editorial/archive site | dashboard-style demo site | service lead-gen site>',
      'Page/screen model: <one line: the website pages/screens/demo surfaces this idea needs>',
      'Primary website experience: <what the main CTA opens/does INSIDE the website/demo, and why>',
      'Demo surfaces: <comma-separated front-end demo surfaces, if any (else "none")>',
      'Stateful demo components: <comma-separated LOCAL/front-end demo components only, e.g. chat-demo-page, listing-filter, detail-preview, quote-form-shell, record-detail-preview>',
      'Navigation model: <single-page anchors | internal page tabs | multi-page-style tabs | dashboard/demo shell | catalog/detail shell>',
      'Media/motion plan: <image/video/animated-background direction tied to the concept — compose with CSS/SVG when there is no real asset; no fake assets>',
      'DECIDE, do not default: pick chat ONLY if the website/demo genuinely needs it (not just',
      'because "AI" appears); a focused landing over multi-page when that fits; a dedicated demo',
      'PAGE/SCREEN over a modal when that reads better. Never claim a surface is connected to real',
      'AI/database/payment/search, and never fabricate products, prices, metrics, sources or logos.',
      '',
      '## Page Sections — a section architecture DERIVED from the strategy above (not',
      '   a fixed list). Choose the sections this specific concept needs.',
      '## Generated Copy — specific, natural, benefit-led copy for every section,',
      '   grounded in the Core idea and Strategy insight (never generic filler like',
      '   "Hayallerinize ulaşın", "Kaliteli hizmet", "Get started", "Welcome").',
      '## Frontend Code — real, usable React + Tailwind in a DYNAMIC src/ project whose',
      '   file tree grows with the site: src/main.tsx, src/App.tsx, src/styles.css,',
      '   src/lib/designSystem.ts (reusable tokens from the Color/Type/Motion direction),',
      '   src/data/siteContent.ts (structured copy), and one src/components/<Name>.tsx per',
      '   section (add cards/ visuals/ ui/ when the concept needs them). Clean PascalCase,',
      '   no duplicate/invalid files, no broken imports, no placeholder comments, no empty',
      '   blocks or blank image boxes — compose visuals with CSS/SVG when there is no image.',
      '   Do NOT default to "centered hero + three cards + CTA": pick a distinct layout rhythm',
      '   and section composition that fits THIS concept.',
      '   FRONT-END DEMO ONLY: any interactive surface (chat / product demo, filters,',
      '   detail modal, request/contact/access forms) is a LOCAL, client-side',
      '   simulation using sample copy — no fetch/backend, no real AI, no real submit.',
      '## Next Steps.',
      '',
      'MOTION (premium, restrained, accessible): animated hero, scroll reveal,',
      'floating/tilting cards, hover states, subtle depth/parallax — never childish.',
      'Write ALL copy in the same language as the idea, natural and fluent.',
      '',
      `Idea: ${idea}`,
    );
  }
  return lines.join('\n');
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Generate (or revise) a website build. Throws WebBuildError (with a `kind`)
 * only when there is genuinely nothing usable: network failure, HTTP error,
 * timeout, an empty reply, or a shortcut/one-liner with no build content.
 *
 * TOLERANT PARSING: a reply that parsed but is missing some canonical sections
 * is NOT thrown away — it's returned with `partial: true` so the UI can render
 * what came back. A reply with substantial prose but no `##` sections becomes
 * a single fallback "Overview" section rather than an error. This keeps
 * partial output visible instead of failing the whole flow.
 */
export async function generateWebBuild(
  idea: string,
  opts?: { signal?: AbortSignal; revise?: boolean; previousReply?: string; mode?: BuilderMode | null },
): Promise<WebBuildResult> {
  const trimmed = idea.trim();
  if (!trimmed) throw new WebBuildError('empty_prompt', 'Describe the website you want before generating.');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
  } catch { /* ignore */ }

  // Own timeout, combined with the caller's abort signal.
  const timer = new AbortController();
  const timeoutId = setTimeout(() => timer.abort(), BUILD_TIMEOUT_MS);
  let timedOut = false;
  const onTimeout = () => { timedOut = true; };
  timer.signal.addEventListener('abort', onTimeout);
  if (opts?.signal) {
    if (opts.signal.aborted) timer.abort();
    else opts.signal.addEventListener('abort', () => timer.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}/chat`, {
      method: 'POST',
      headers,
      signal: timer.signal,
      body: JSON.stringify({
        user_id: getUserId(),
        message: buildWebBuildRequest(trimmed, { revise: opts?.revise, previousReply: opts?.previousReply, mode: opts?.mode }),
        platform: 'web',
        mode: WEBSITE_BUILDER_MODE,
        // Language — resolved app locale so the build is generated in the
        // user's selected language (backend answer-language policy).
        ...getRequestLocale(trimmed),
      }),
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      if (timedOut) throw new WebBuildError('timeout', 'The build timed out.', err);
      throw new WebBuildError('cancelled', 'Generation cancelled.', err);
    }
    throw new WebBuildError('network', 'Could not reach the Korvix backend.', err);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new WebBuildError('http', `The backend returned HTTP ${response.status}.`);
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch (err) {
    throw new WebBuildError('unreadable', 'The backend sent an unreadable response.', err);
  }

  const reply = typeof data.reply === 'string' ? data.reply : '';
  if (!reply.trim()) throw new WebBuildError('empty', 'The backend returned an empty result.');

  const reportedMode = typeof data.mode === 'string' ? data.mode : '';
  let sections = parseBuildSections(reply);
  const present = new Set(sections.map((s) => norm(s.title)));

  let partial = false;

  // A different reported mode usually means the request was routed to another
  // handler (e.g. a style/settings shortcut). This used to be a HARD failure —
  // but the backend sometimes MISLABELS the mode on an otherwise genuine build,
  // and throwing here discarded a fully buildable reply before the tolerant
  // parser + self-healing payload layer (buildWebBuildPayload) ever saw it, so the
  // user got the generic "incomplete build package" banner for a valid build.
  // Now we only hard-fail when the reply ALSO has nothing to build from (no parsed
  // sections AND too tiny to be an Overview fallback); otherwise we treat the
  // wrong mode as DEGRADED (partial) and let parsing/synthesis proceed. The warn
  // log is preserved for owner/dev visibility either way.
  if (reportedMode && reportedMode !== WEBSITE_BUILDER_MODE && !opts?.revise) {
    const buildable = sections.length > 0 || reply.trim().length >= 40;
    // eslint-disable-next-line no-console
    console.warn(`[WebBuild] wrong mode="${reportedMode}" (expected ${WEBSITE_BUILDER_MODE})${buildable ? ' — degraded, building from reply' : ''}`);
    if (!buildable) {
      throw new WebBuildError('invalid', `Routed to "${reportedMode}", not the website builder.`);
    }
    partial = true; // reported mode was wrong but the reply is buildable → degraded
  }

  if (sections.length === 0) {
    // No `##` headings. If it's a tiny one-liner it's a shortcut/garbage →
    // fail. If it's substantial prose, keep it as a fallback Overview.
    if (reply.trim().length < 40) {
      // eslint-disable-next-line no-console
      console.warn(`[WebBuild] unusable one-liner reply: ${JSON.stringify(reply.slice(0, 80))}`);
      throw new WebBuildError('invalid', 'The reply had no build sections.');
    }
    // eslint-disable-next-line no-console
    console.warn('[WebBuild] no sections parsed — showing raw reply as a fallback Overview.');
    sections = [{ title: 'Overview', body: reply.trim() }];
    partial = true;
  } else if (!opts?.revise) {
    // Fresh build should ideally have these; if some are missing we still
    // show what we got and flag it partial (don't throw the rest away).
    const required = ['Build Plan', 'Page Sections', 'Frontend Code'];
    const missing = required.filter((r) => !present.has(norm(r)));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[WebBuild] partial build — ${sections.length} section(s), missing [${missing.join(', ')}]`);
      partial = true;
    }
  }

  // Real research metadata — sources are surfaced ONLY when the backend
  // actually ran web_research and returned URLs. Never synthesized here.
  const meta = (data.metadata && typeof data.metadata === 'object') ? data.metadata as Record<string, unknown> : {};
  const research = (meta.research && typeof meta.research === 'object') ? meta.research as Record<string, unknown> : {};
  const rawSources = Array.isArray(meta.sources) ? meta.sources : [];
  const sources: WebBuildSource[] = rawSources
    .map((s) => (s && typeof s === 'object') ? s as Record<string, unknown> : null)
    .filter((s): s is Record<string, unknown> => !!s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url as string))
    .map((s) => ({ title: String(s.title || s.url), url: String(s.url), snippet: typeof s.snippet === 'string' ? s.snippet : undefined }))
    .slice(0, 8);
  // did_research is honoured ONLY when it lines up with real URLs — the UI can
  // never claim research ran unless we actually hold sources.
  const didResearch = research.did_research === true && sources.length > 0;

  // Build the full, honest research object when the backend reported one (it
  // always does for a fresh website_builder build). Status is normalized: a
  // claimed did_research with zero real sources is downgraded to no_sources so
  // the UI never over-claims.
  const hasResearchMeta = meta.research && typeof meta.research === 'object';
  const rawStatus = typeof research.status === 'string' ? research.status : undefined;
  const status: WebBuildResearchStatus = didResearch
    ? 'used_sources'
    : (rawStatus as WebBuildResearchStatus) || (sources.length ? 'no_sources' : 'fallback_strategy');
  const asStrList = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  const researchObj: WebBuildResearch | undefined = hasResearchMeta
    ? {
        didResearch,
        status,
        provider: typeof research.provider === 'string' ? research.provider : undefined,
        attemptedProviders: asStrList(research.attempted_providers),
        queryCount: typeof research.query_count === 'number' ? research.query_count : undefined,
        angles: asStrList(research.angles),
        sourceCount: typeof research.source_count === 'number' ? research.source_count : sources.length,
        fallbackReason: typeof research.fallback_reason === 'string' ? research.fallback_reason : undefined,
        sources: sources.length ? sources : undefined,
      }
    : undefined;

  return {
    reply,
    sections,
    partial,
    model: typeof data.model === 'string' ? data.model : 'unknown',
    mode: reportedMode || WEBSITE_BUILDER_MODE,
    requestId: typeof data.request_id === 'string' ? data.request_id : '',
    sources: sources.length ? sources : undefined,
    didResearch: didResearch || undefined,
    research: researchObj,
  };
}
