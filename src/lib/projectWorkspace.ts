/**
 * projectWorkspace — the typed contract + PURE presentation logic for the
 * Project Workspace surface.
 *
 * The Project page renders from ONE backend read model
 * (`GET /v2/projects/{id}/workspace`, built by
 * `backend/services/project_brain/workspace.py`). Everything that has to make a
 * decision about that payload — normalization, relative time, freshness
 * wording, which suggested questions are honest to show, which provider label
 * belongs to a row — lives here rather than inside the component, for two
 * reasons:
 *
 *   1. it is unit-testable in the repo's node-environment Vitest setup, and
 *   2. it keeps the page a renderer, so the page can never quietly become a
 *      second source of truth about project state.
 *
 * NOTHING here invents data. Every function either passes real backend values
 * through or returns a null/empty result the caller renders as "nothing to
 * say". There are no fabricated statuses, no fake percentages, no derived
 * "health scores".
 */

/* ── Backend contract (mirrors the read model, field for field) ───────────── */

export interface WorkspaceProject {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

/** Attention severity, strongest first. Ordering is decided server-side; the
 *  frontend only maps a severity to a tone. */
export type AttentionSeverity = 'blocking' | 'time_sensitive' | 'waiting';

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  /** Stable reason code → a translated "why this matters" line. */
  reason: string;
  source: string;
  kind: string;
  /** Provider- or user-authored text (may be empty). */
  title: string;
  /** Short resource label (repo, environment, project name); may be empty. */
  context: string;
  observed_at: string;
  /** Deliverable id for a failed build, else "". */
  ref: string;
}

export interface ActivityItem {
  id: string;
  source: string;
  kind: string;
  title: string;
  occurred_at: string;
  ref: string;
}

export interface WorkspaceGoal {
  id: string;
  title: string;
  priority: number | null;
  source: 'goals' | 'memory' | string;
}

export interface WorkspaceProduct {
  deliverable_id?: string;
  build_type?: string;
  title?: string;
  status?: string;
  artifact_ref?: string;
  build_ref?: string;
  run_id?: string;
  node_id?: string;
  /** The chat this product was generated in, when one was recorded. */
  thread_id?: string;
  updated_at?: string;
}

export interface WorkspaceChat {
  thread_id: string;
  title: string;
  mode: string;
  updated_at: string;
}

export interface WorkspaceConnector {
  provider: string;
  label: string;
  resource_kind: string;
  resource_noun: string;
  /** Human resource labels only — never an opaque provider id. */
  resources: string[];
  resource_count: number;
  status: string;
  last_sync_at: string;
}

/**
 * SMART REFRESH — coordination metadata, not project state.
 *
 * The snapshot is always the PERSISTED one. This block says whether the backend
 * decided any of the project's bound connectors were stale enough to refresh in
 * the background, so the page knows whether there is any point re-reading.
 *
 * `recheckInMs` of 0 means "nothing is coming" and the page must not re-read.
 * It is the backend that decides the interval and whether one exists at all —
 * the frontend never invents a polling cadence.
 */
export interface WorkspaceRefresh {
  /** Refreshes THIS read started. A provider call is now running for each. */
  started: string[];
  /** Already being refreshed — another tab, or this page's previous read. */
  inFlight: string[];
  /** Everything past its freshness TTL, acted on or not (some are backing off
   *  after a failure, which is why this can exceed started + inFlight). */
  stale: string[];
  /** How long to wait before ONE re-read, or 0 for "do not re-read". */
  recheckInMs: number;
}

/** Whether anything is actually coming, i.e. whether a re-read could show
 *  something new. The single question the page asks this block. */
export function refreshPending(refresh: WorkspaceRefresh | null | undefined): boolean {
  if (!refresh) return false;
  return refresh.recheckInMs > 0
    && (refresh.started.length > 0 || refresh.inFlight.length > 0);
}

/* ── Feed presentation preference ─────────────────────────────────────────── */

/**
 * PRESENTATION ONLY. How prominently one user wants one source to appear in one
 * project's activity feed.
 *
 * It never changes what Korvix knows, ranks or decides — Needs Attention,
 * Today, Focus, Project State and the Business Brain are computed from the
 * observations and have never heard of this. Hiding Vercel hides deployments
 * from YOUR feed; a production outage is still ranked and still shown.
 */
export type FeedPreference = 'highlight' | 'normal' | 'hidden';

export const FEED_PREFERENCES: FeedPreference[] = ['highlight', 'normal', 'hidden'];

/** Explicit choices only, keyed by source. A source absent from the map is on
 *  the default (`normal`) — the backend never round-trips defaults, so an
 *  untouched project reads as `{}` rather than as fully configured. */
export type FeedPreferences = Record<string, FeedPreference>;

export function normalizeFeedPreference(value: unknown): FeedPreference {
  return value === 'highlight' || value === 'hidden' ? value : 'normal';
}

export function feedPreferenceOf(
  preferences: FeedPreferences | null | undefined,
  source: string,
): FeedPreference {
  return normalizeFeedPreference(preferences?.[source]);
}

/** i18n key for a preference's label. Stable codes → translated words. */
export function feedPreferenceKey(preference: FeedPreference): string {
  return {
    highlight: 'projectFeedPrefHighlight',
    normal: 'projectFeedPrefNormal',
    hidden: 'projectFeedPrefHidden',
  }[preference];
}

/**
 * The sources worth offering in the Customize panel, in a stable order.
 *
 * A source is offered when the project is CONNECTED to it, when it has actually
 * appeared in the feed, or when the user already has a preference for it (so a
 * choice can always be undone even after the source went quiet). Offering every
 * conceivable source would ask people about tools they do not use.
 */
export function customizableSources(
  workspace: ProjectWorkspace | null,
  available: readonly string[] = [],
): string[] {
  if (!workspace) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (source: string) => {
    const key = String(source || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const connector of workspace.connectors) add(connector.provider);
  for (const row of workspace.activity) add(row.source);
  for (const source of Object.keys(workspace.feedPreferences)) add(source);
  // `available` is the backend's own source vocabulary; it decides the ORDER,
  // so the panel matches the registry rather than the accident of what this
  // project happened to log first.
  if (available.length > 0) {
    const known = new Set(available);
    return [...available.filter((s) => seen.has(s)),
            ...out.filter((s) => !known.has(s))];
  }
  return out;
}

export interface WorkspaceFreshness {
  generated_at: string;
  last_activity_at: string;
  last_connector_sync_at: string;
  last_observation_at: string;
  last_chat_at: string;
  last_product_at: string;
}

/**
 * TODAY — the top of the page. `attention` is the top-ranked signal passed
 * through verbatim; `recommendation` is the deterministic next best action the
 * backend chose from the attention → task → goal ladder. Both may be null, and
 * null is the truthful state of a quiet project, not a rendering bug.
 */
export interface TodayRecommendation {
  /** Stable reason code → a translated sentence. Never English from the API. */
  reason: string;
  /** Which authority the recommendation came from; also names `ref_id`'s space. */
  source: 'attention' | 'task' | 'goal' | string;
  ref_id: string;
  /** The underlying thing's own words (signal summary, task title, goal title). */
  title: string;
  context: string;
  /** Stable action codes, each naming an affordance that exists on this page. */
  actions: string[];
}

export interface WorkspaceToday {
  attention: AttentionItem | null;
  recommendation: TodayRecommendation | null;
}

/** The four states a project task can be in. Decided server-side. */
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';

export interface ProjectTask {
  id: string;
  title: string;
  details: string;
  status: TaskStatus;
  /** 1 low · 2 normal · 3 high. An ordinal for ordering — never a score. */
  priority: number;
  source: string;
  origin_ref: string;
  created_at: string;
  updated_at: string;
  completed_at: string;
}

export interface WorkspaceTasks {
  items: ProjectTask[];
  counts: Record<string, number>;
}

/** The durable knowledge vocabulary, strongest (most binding) first. */
export type KnowledgeKind = 'decision' | 'requirement' | 'constraint' | 'fact' | 'note';

export interface KnowledgeItem {
  /** Namespaced (`decision:…` / `memory:…`) — the backend dispatches removal on it. */
  id: string;
  kind: KnowledgeKind;
  text: string;
  /** A real topic heading when the authority has one (a build decision), else "". */
  label: string;
  source: string;
  created_at: string;
  /** Whether THIS user may remove it. Items Korvix derived are read-only here. */
  removable: boolean;
}

export interface WorkspaceKnowledge {
  items: KnowledgeItem[];
  counts: Record<string, number>;
}

export interface ChangeItem {
  /** Dedup identity — the thing the change is about, not the event id. */
  key: string;
  change: string;
  source: string;
  /** PROVIDER-AUTHORED for a connector row. Render through `providerText`. */
  title: string;
  detail: string;
  occurred_at: string;
  ref: string;
  /** The CORRELATED subject this change belongs to, when the backend's
   *  membership index spoke for it. "" means the row stands alone — which is
   *  the honest answer, not a missing field. */
  subject_id: string;
  subject: string;
  /** The subject's state, from the same closed vocabulary as `SubjectState`. */
  state: string;
}

/**
 * The change list AND the claim it is allowed to make.
 *
 * `since_last_visit` means a real per-user marker exists and the window starts
 * there. `recent` means it does not, and the section must be titled "Recent
 * changes" — the page may never print the stronger claim over the weaker data.
 */
export interface WorkspaceChanges {
  mode: 'since_last_visit' | 'recent';
  /** The instant the window opens at. */
  since: string;
  /** The stored marker ("" when this user has never acknowledged a visit). */
  last_viewed_at: string;
  items: ChangeItem[];
  /** Deduplicated changes in the window — may exceed `items.length`. */
  count: number;
  truncated: boolean;
}

/* ── Project understanding (backend `project_intelligence`) ────────────────
 *
 * Korvix's reading of what the connected tools ADD UP TO. Everything here is
 * a stable CODE from a closed backend vocabulary, rendered through the locale
 * dictionaries — the API never sends a user-facing sentence for any of it, so
 * every language gets the same reading rather than an English one.
 *
 * Nothing in this block is a score. There is no project health number, no
 * percentage and no ranking: `open`/`uncertain`/`resolvedRecently` are slices
 * of the order the backend already produced, and "what deserves attention" is
 * still `attention`'s answer alone.
 */

/** The inferred state of one subject. Same vocabulary at project level, plus
 *  `no_evidence` for a project nothing has been observed about. */
export type SubjectState =
  | 'unresolved' | 'conflicting' | 'in_progress' | 'likely_resolved' | 'observed';
export type ProjectState = SubjectState | 'no_evidence';

/** Which part of the project a subject touches. `basis` says whether the
 *  backend derived it from a recorded fact (a deployment IS a deployment) or
 *  from wording — the page shows the distinction rather than hiding it. */
export interface AffectedArea {
  area: string;
  basis: 'structural' | 'textual' | 'none';
}

export interface ChangeKind {
  kind: string;
  basis: 'structural' | 'textual' | 'none';
}

/** A code + whatever bounded params the backend attached to it. */
export interface UnderstandingCode {
  code: string;
}

/** A concrete negative reading standing between a subject and "done" — always
 *  a real observation, never a sentence Korvix composed. */
export interface SubjectBlocker {
  code: string;
  facet: string;
  environment: string;
  source: string;
  title: string;
  observation_id: string;
  observed_at: string;
  regressed: boolean;
  /** Present on the project-level list; absent on a subject's own. */
  subject?: string;
  subject_id?: string;
}

export interface MeaningfulChange {
  at: string;
  code: string;
  facet: string;
  environment: string;
  source: string;
  title: string;
  observation_id: string;
  subject?: string;
  subject_id?: string;
}

/** The interpretation attached to one correlated subject. */
export interface SubjectUnderstanding {
  id: string;
  areas: AffectedArea[];
  change_kind: ChangeKind;
  environments: string[];
  /** What the evidence MEANS. Never an action — proposing work is the
   *  Business Brain's job and this page never does it. */
  implications: UnderstandingCode[];
  /** What is still NOT known. Empty means the evidence really is unambiguous. */
  uncertainty: UnderstandingCode[];
  blockers: SubjectBlocker[];
  last_meaningful_change: MeaningfulChange | null;
}

/** Which way one piece of evidence points. The backend's own reading, carried
 *  on the row — the page never derives an outcome from a title or a kind. */
export type EvidencePolarity = 'positive' | 'negative' | 'pending' | 'neutral' | '';

export interface EvidenceRef {
  observation_id: string;
  source: string;
  kind: string;
  semantic_type: string;
  /** `positive` / `negative` / `pending` / `neutral`, decided server-side. */
  polarity: EvidencePolarity;
  /** The deploy target this row speaks about, or "" when it is not about a
   *  deployment at all. "" NEVER means production. */
  environment: string;
  /** PROVIDER-AUTHORED TEXT. Render through `ProviderText` / `providerText`,
   *  never as markdown and never as a heading. */
  title: string;
  observed_at: string;
}

/* ── Grounding: what ONE story's evidence establishes ──────────────────────
 *
 * The backend's `project_intelligence.grounding` reading, computed over the
 * observations that belong to this subject. Every value is a stable code from
 * a closed vocabulary; there is no percentage, no score and no second
 * confidence model. `direct` means a source recorded this claim's own kind of
 * evidence. `indirect` means an ADJACENT fact exists and the claim itself is
 * unproven — it is never rendered as the claim.
 */
export type ClaimSupport = 'none' | 'indirect' | 'direct';
export type ClaimBasis = 'structural' | 'recorded' | 'textual' | '';

export interface GroundedClaim {
  claim: string;
  support: ClaimSupport;
  basis: ClaimBasis;
  sources: string[];
  evidence_count: number;
  /** One tool reporting is never corroboration — the backend says so per claim. */
  single_source: boolean;
  /** Evidence classes that WOULD establish it. Empty once `direct`. */
  missing: string[];
}

export interface StoryGrounding {
  claims: GroundedClaim[];
  sources: string[];
  observations: number;
  single_source: boolean;
}

/** One correlated subject: what Korvix thinks is going on, and why. */
export interface ProjectStateItem {
  id: string;
  subject: string;
  entity_type: string;
  state: SubjectState;
  confidence: { score: number | null; level: string };
  sources: string[];
  evidence_count: number;
  member_count: number;
  corroborated: boolean;
  supporting: EvidenceRef[];
  contradicting: EvidenceRef[];
  context: EvidenceRef[];
  first_seen: string;
  last_seen: string;
  understanding: SubjectUnderstanding | null;
  /** What THIS story's evidence does and does not establish, or null when the
   *  backend could not ground it. Never a score. */
  grounding: StoryGrounding | null;
}

/** What the reading is BASED on. The page shows this whenever it is thin,
 *  because "one tool, three events" and "four tools, sixty events" support
 *  very different sentences. */
export interface UnderstandingCoverage {
  observations: number;
  sources: string[];
  source_count: number;
  subjects: number;
  single_source: boolean;
  oldest_observed_at: string;
  newest_observed_at: string;
  recent: boolean;
  window_days: number;
}

export interface SubjectRef {
  id: string;
  subject: string;
  state: SubjectState;
  entity_type: string;
  confidence: string;
  areas: string[];
  change_kind: string;
  sources: string[];
  last_seen: string;
  last_change_at: string;
}

export interface SubjectRelationship {
  kind: string;
  a_id: string;
  a_subject: string;
  b_id: string;
  b_subject: string;
  shared_evidence: number;
}

export interface ProjectUnderstanding {
  generated_at: string;
  window_days: number;
  state: ProjectState;
  coverage: UnderstandingCoverage;
  open: SubjectRef[];
  resolved_recently: SubjectRef[];
  uncertain: SubjectRef[];
  blockers: SubjectBlocker[];
  meaningful_changes: MeaningfulChange[];
  gaps: UnderstandingCode[];
  relationships: SubjectRelationship[];
  counts: Record<string, number>;
}

/* ── Focus (backend `orchestrator.decision_context`) ───────────────────────
 *
 * WHY the leading concern leads, in the same closed-code style as everything
 * above: a tier BASIS, the reasons it matters now, what would make the reading
 * wrong, and who has to act. There is no score here and no percentage — the
 * backend's tier integer is deliberately not part of this contract, because a
 * number rendered at a person is exactly the unearned precision this surface
 * refuses to ship.
 *
 * It is NOT a second ranking. The backend computes it with the identical
 * function and the identical ladder that orders the Business Brain's
 * candidates, so the page and the Brain give one answer to "what matters most".
 */

/** Who has to act for the problem to go away. */
export type FocusResolution = 'korvix' | 'human_external' | 'unknown' | '';

export interface FocusActionability {
  /** What Korvix can do on its own (`investigate` today, or nothing). */
  korvix: string;
  capability: string;
  /** The EXISTING execution-policy tier, product-named. */
  autonomy: string;
  resolution: FocusResolution;
  /** Providers whose systems a fix would have to change. Names only. */
  external_providers: string[];
}

export interface FocusCommitment {
  /** Opaque digest — never the provider's calendar event id. */
  event_key: string;
  title: string;
  at: string;
  hours_until: number | null;
  pressure: 'none' | 'approaching' | 'imminent' | string;
  kind: string;
  kind_basis: string;
}

export interface FocusItem {
  subject_id: string;
  subject: string;
  project_state: SubjectState | string;
  unresolved: boolean;
  areas: string[];
  /** Stable tier code — `deadline_risk`, `production_broken`, … */
  priority_basis: string;
  /** Why it matters now. Stable codes, most load-bearing first. */
  why_now: string[];
  /** What would make this reading wrong. Stable codes. */
  caveats: string[];
  actionability: FocusActionability;
  deadline_pressure: string;
  production_impact: string;
  customer_impact: string;
  evidence_strength: string;
  blocker_state: string;
  confidence_level: string;
}

export interface ProjectFocus {
  top: FocusItem | null;
  next: FocusItem[];
  commitment: FocusCommitment | null;
  blocked: boolean;
  waiting_on: FocusResolution;
  counts: Record<string, number>;
}

export interface ProjectWorkspace {
  project: WorkspaceProject;
  summary: { text: string; source: string };
  today: WorkspaceToday;
  goals: WorkspaceGoal[];
  attention: AttentionItem[];
  projectState: ProjectStateItem[];
  understanding: ProjectUnderstanding | null;
  /** null on a project with nothing pressing — the truthful state, not a gap. */
  focus: ProjectFocus | null;
  activity: ActivityItem[];
  changes: WorkspaceChanges;
  tasks: WorkspaceTasks;
  knowledge: WorkspaceKnowledge;
  products: WorkspaceProduct[];
  chats: WorkspaceChat[];
  connectors: WorkspaceConnector[];
  /** This user's explicit presentation choices for this project. */
  feedPreferences: FeedPreferences;
  /** Smart-refresh coordination for this read (never project state). */
  refresh: WorkspaceRefresh;
  freshness: WorkspaceFreshness;
  counts: Record<string, number>;
}

/* ── Defensive normalization ──────────────────────────────────────────────── */

const SEVERITIES: AttentionSeverity[] = ['blocking', 'time_sensitive', 'waiting'];

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'waiting', 'done'];
const KNOWLEDGE_KINDS: KnowledgeKind[] = ['decision', 'requirement', 'constraint', 'fact', 'note'];

function counts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(value))) {
    const n = num(v);
    if (n !== null) out[k] = n;
  }
  return out;
}

function normalizeAttentionItem(value: unknown): AttentionItem | null {
  const o = obj(value);
  const id = str(o.id);
  if (!id) return null;
  const severity = str(o.severity) as AttentionSeverity;
  return {
    id,
    severity: SEVERITIES.includes(severity) ? severity : 'waiting',
    reason: str(o.reason),
    source: str(o.source),
    kind: str(o.kind),
    title: str(o.title),
    context: str(o.context),
    observed_at: str(o.observed_at),
    ref: str(o.ref),
  };
}

/** A task the backend could not describe (no id, no title) is dropped rather
 *  than rendered as a blank row the user cannot act on. */
export function normalizeTask(value: unknown): ProjectTask | null {
  const o = obj(value);
  const id = str(o.id);
  const title = str(o.title);
  if (!id || !title) return null;
  const status = str(o.status) as TaskStatus;
  return {
    id,
    title,
    details: str(o.details),
    status: TASK_STATUSES.includes(status) ? status : 'todo',
    priority: num(o.priority) ?? 2,
    source: str(o.source, 'user'),
    origin_ref: str(o.origin_ref),
    created_at: str(o.created_at),
    updated_at: str(o.updated_at),
    completed_at: str(o.completed_at),
  };
}

/** A knowledge item whose kind this bundle does not know is dropped: showing
 *  the text under a made-up heading would misrepresent what it is. */
export function normalizeKnowledgeItem(value: unknown): KnowledgeItem | null {
  const o = obj(value);
  const id = str(o.id);
  const text = str(o.text);
  const kind = str(o.kind) as KnowledgeKind;
  if (!id || !text || !KNOWLEDGE_KINDS.includes(kind)) return null;
  return {
    id,
    kind,
    text,
    label: str(o.label),
    source: str(o.source),
    created_at: str(o.created_at),
    removable: o.removable === true,
  };
}

function normalizeToday(value: unknown): WorkspaceToday {
  const o = obj(value);
  const reco = obj(o.recommendation);
  const reason = str(reco.reason);
  return {
    attention: normalizeAttentionItem(o.attention),
    recommendation: reason
      ? {
        reason,
        source: str(reco.source),
        ref_id: str(reco.ref_id),
        title: str(reco.title),
        context: str(reco.context),
        actions: arr(reco.actions).map((a) => str(a)).filter(Boolean),
      }
      : null,
  };
}

/**
 * Normalize the change block, defaulting to the WEAKER claim.
 *
 * An unrecognised (or absent) mode becomes `recent`, never `since_last_visit`:
 * if the payload cannot prove a visit, the page must not print one.
 */
function normalizeChanges(value: unknown): WorkspaceChanges {
  const o = obj(value);
  const items = arr(o.items).map((raw) => {
    const c = obj(raw);
    return {
      key: str(c.key),
      change: str(c.change),
      source: str(c.source),
      title: str(c.title),
      detail: str(c.detail),
      occurred_at: str(c.occurred_at),
      ref: str(c.ref),
      subject_id: str(c.subject_id),
      subject: str(c.subject),
      state: str(c.state),
    };
  }).filter((c) => !!c.key);
  return {
    mode: str(o.mode) === 'since_last_visit' ? 'since_last_visit' : 'recent',
    since: str(o.since),
    last_viewed_at: str(o.last_viewed_at),
    items,
    // Never claim fewer changes than we are about to render.
    count: Math.max(num(o.count) ?? 0, items.length),
    truncated: o.truncated === true,
  };
}

/* ── Project understanding normalization ──────────────────────────────────── */

const SUBJECT_STATES: SubjectState[] =
  ['unresolved', 'conflicting', 'in_progress', 'likely_resolved', 'observed'];
const BASES = ['structural', 'textual', 'none'];

function normalizeCodes(value: unknown): UnderstandingCode[] {
  return arr(value)
    .map((raw) => ({ ...obj(raw), code: str(obj(raw).code) }))
    .filter((c): c is UnderstandingCode => !!c.code) as UnderstandingCode[];
}

function normalizeBlocker(value: unknown): SubjectBlocker | null {
  const o = obj(value);
  const code = str(o.code);
  if (!code) return null;
  return {
    code,
    facet: str(o.facet),
    environment: str(o.environment),
    source: str(o.source),
    title: str(o.title),
    observation_id: str(o.observation_id),
    observed_at: str(o.observed_at),
    regressed: o.regressed === true,
    subject: str(o.subject) || undefined,
    subject_id: str(o.subject_id) || undefined,
  };
}

function normalizeChange(value: unknown): MeaningfulChange | null {
  const o = obj(value);
  const at = str(o.at);
  if (!at) return null;
  return {
    at,
    code: str(o.code),
    facet: str(o.facet),
    environment: str(o.environment),
    source: str(o.source),
    title: str(o.title),
    observation_id: str(o.observation_id),
    subject: str(o.subject) || undefined,
    subject_id: str(o.subject_id) || undefined,
  };
}

function normalizeUnderstanding(value: unknown): SubjectUnderstanding | null {
  const o = obj(value);
  if (!Object.keys(o).length) return null;
  const kind = obj(o.change_kind);
  const kindBasis = str(kind.basis, 'none');
  return {
    id: str(o.id),
    areas: arr(o.areas).map((raw) => {
      const a = obj(raw);
      const basis = str(a.basis, 'none');
      return {
        area: str(a.area),
        basis: (BASES.includes(basis) ? basis : 'none') as AffectedArea['basis'],
      };
    }).filter((a) => !!a.area),
    change_kind: {
      kind: str(kind.kind),
      basis: (BASES.includes(kindBasis) ? kindBasis : 'none') as ChangeKind['basis'],
    },
    environments: arr(o.environments).map((e) => str(e)).filter(Boolean),
    implications: normalizeCodes(o.implications),
    uncertainty: normalizeCodes(o.uncertainty),
    blockers: arr(o.blockers).map(normalizeBlocker)
      .filter((b): b is SubjectBlocker => b !== null),
    last_meaningful_change: normalizeChange(o.last_meaningful_change),
  };
}

const POLARITIES: EvidencePolarity[] = ['positive', 'negative', 'pending', 'neutral'];

function normalizeEvidence(value: unknown): EvidenceRef[] {
  return arr(value).map((raw) => {
    const o = obj(raw);
    const polarity = str(o.polarity) as EvidencePolarity;
    return {
      observation_id: str(o.observation_id),
      source: str(o.source),
      kind: str(o.kind),
      semantic_type: str(o.semantic_type),
      // An unrecognised polarity degrades to "" — the page then shows the row
      // with no outcome mark rather than guessing which way it points.
      polarity: (POLARITIES.includes(polarity) ? polarity : '') as EvidencePolarity,
      environment: str(o.environment),
      title: str(o.title),
      observed_at: str(o.observed_at),
    };
  });
}

const SUPPORTS: ClaimSupport[] = ['none', 'indirect', 'direct'];
const CLAIM_BASES: ClaimBasis[] = ['structural', 'recorded', 'textual'];

/**
 * The grounding block, or null.
 *
 * A claim whose support level this bundle does not recognise degrades to
 * `none` — the WEAKEST reading — for the same reason `changes` defaults to
 * `recent`: if the payload cannot prove support, the page must not print it.
 */
export function normalizeGrounding(value: unknown): StoryGrounding | null {
  const o = obj(value);
  if (!Object.keys(o).length) return null;
  const claims = arr(o.claims).map((raw) => {
    const c = obj(raw);
    const claim = str(c.claim);
    if (!claim) return null;
    const support = str(c.support) as ClaimSupport;
    const basis = str(c.basis) as ClaimBasis;
    return {
      claim,
      support: (SUPPORTS.includes(support) ? support : 'none') as ClaimSupport,
      basis: (CLAIM_BASES.includes(basis) ? basis : '') as ClaimBasis,
      sources: arr(c.sources).map((x) => str(x)).filter(Boolean),
      evidence_count: num(c.evidence_count) ?? 0,
      single_source: c.single_source === true,
      missing: arr(c.missing).map((x) => str(x)).filter(Boolean),
    };
  }).filter((c): c is GroundedClaim => c !== null);
  if (!claims.length) return null;
  return {
    claims,
    sources: arr(o.sources).map((x) => str(x)).filter(Boolean),
    observations: num(o.observations) ?? 0,
    single_source: o.single_source === true,
  };
}

/** A subject with no id or no state this bundle knows is DROPPED. Rendering a
 *  story under a state we cannot name would be worse than not rendering it. */
export function normalizeProjectStateItem(value: unknown): ProjectStateItem | null {
  const o = obj(value);
  const id = str(o.id);
  const state = str(o.state) as SubjectState;
  if (!id || !SUBJECT_STATES.includes(state)) return null;
  const confidence = obj(o.confidence);
  return {
    id,
    subject: str(o.subject),
    entity_type: str(o.entity_type),
    state,
    confidence: { score: num(confidence.score), level: str(confidence.level) },
    sources: arr(o.sources).map((x) => str(x)).filter(Boolean),
    evidence_count: num(o.evidence_count) ?? 0,
    member_count: num(o.member_count) ?? 0,
    corroborated: o.corroborated === true,
    supporting: normalizeEvidence(o.supporting),
    contradicting: normalizeEvidence(o.contradicting),
    context: normalizeEvidence(o.context),
    first_seen: str(o.first_seen),
    last_seen: str(o.last_seen),
    understanding: normalizeUnderstanding(o.understanding),
    grounding: normalizeGrounding(o.grounding),
  };
}

function normalizeSubjectRef(value: unknown): SubjectRef | null {
  const o = obj(value);
  const id = str(o.id);
  if (!id) return null;
  const state = str(o.state) as SubjectState;
  return {
    id,
    subject: str(o.subject),
    state: SUBJECT_STATES.includes(state) ? state : 'observed',
    entity_type: str(o.entity_type),
    confidence: str(o.confidence),
    areas: arr(o.areas).map((a) => str(a)).filter(Boolean),
    change_kind: str(o.change_kind),
    sources: arr(o.sources).map((x) => str(x)).filter(Boolean),
    last_seen: str(o.last_seen),
    last_change_at: str(o.last_change_at),
  };
}

/**
 * The project-level reading, or null when the backend sent none.
 *
 * An unrecognised project state degrades to `no_evidence` — the WEAKEST claim
 * — for the same reason the change block defaults to "recent": if the payload
 * cannot prove a reading, the page must not print a stronger one.
 */
export function normalizeProjectUnderstanding(value: unknown): ProjectUnderstanding | null {
  const o = obj(value);
  if (!Object.keys(o).length) return null;
  const rawState = str(o.state) as ProjectState;
  const coverage = obj(o.coverage);
  const refs = (key: unknown) => arr(key).map(normalizeSubjectRef)
    .filter((r): r is SubjectRef => r !== null);
  return {
    generated_at: str(o.generated_at),
    window_days: num(o.window_days) ?? 0,
    state: ([...SUBJECT_STATES, 'no_evidence'] as string[]).includes(rawState)
      ? rawState : 'no_evidence',
    coverage: {
      observations: num(coverage.observations) ?? 0,
      sources: arr(coverage.sources).map((x) => str(x)).filter(Boolean),
      source_count: num(coverage.source_count) ?? 0,
      subjects: num(coverage.subjects) ?? 0,
      single_source: coverage.single_source === true,
      oldest_observed_at: str(coverage.oldest_observed_at),
      newest_observed_at: str(coverage.newest_observed_at),
      recent: coverage.recent === true,
      window_days: num(coverage.window_days) ?? 0,
    },
    open: refs(o.open),
    resolved_recently: refs(o.resolved_recently),
    uncertain: refs(o.uncertain),
    blockers: arr(o.blockers).map(normalizeBlocker)
      .filter((b): b is SubjectBlocker => b !== null),
    meaningful_changes: arr(o.meaningful_changes).map(normalizeChange)
      .filter((c): c is MeaningfulChange => c !== null),
    gaps: normalizeCodes(o.gaps),
    relationships: arr(o.relationships).map((raw) => {
      const r = obj(raw);
      return {
        kind: str(r.kind),
        a_id: str(r.a_id),
        a_subject: str(r.a_subject),
        b_id: str(r.b_id),
        b_subject: str(r.b_subject),
        shared_evidence: num(r.shared_evidence) ?? 0,
      };
    }).filter((r) => !!r.a_id && !!r.b_id),
    counts: counts(o.counts),
  };
}

const RESOLUTIONS: FocusResolution[] = ['korvix', 'human_external', 'unknown'];

function normalizeFocusItem(value: unknown): FocusItem | null {
  const o = obj(value);
  const subjectId = str(o.subject_id);
  if (!subjectId) return null;
  const actionability = obj(o.actionability);
  const resolution = str(actionability.resolution);
  return {
    subject_id: subjectId,
    subject: str(o.subject),
    project_state: str(o.project_state),
    unresolved: o.unresolved === true,
    areas: arr(o.areas).map((a) => str(a)).filter(Boolean),
    priority_basis: str(o.priority_basis),
    why_now: arr(o.why_now).map((c) => str(c)).filter(Boolean),
    caveats: arr(o.caveats).map((c) => str(c)).filter(Boolean),
    actionability: {
      korvix: str(actionability.korvix),
      capability: str(actionability.capability),
      autonomy: str(actionability.autonomy),
      resolution: (RESOLUTIONS.includes(resolution as FocusResolution)
        ? resolution : '') as FocusResolution,
      external_providers: arr(actionability.external_providers)
        .map((p) => str(p)).filter(Boolean),
    },
    deadline_pressure: str(o.deadline_pressure),
    production_impact: str(o.production_impact),
    customer_impact: str(o.customer_impact),
    evidence_strength: str(o.evidence_strength),
    blocker_state: str(o.blocker_state),
    confidence_level: str(o.confidence_level),
  };
}

function normalizeCommitment(value: unknown): FocusCommitment | null {
  const o = obj(value);
  if (!Object.keys(o).length) return null;
  const at = str(o.at);
  if (!at) return null;   // an undated commitment exerts no pressure anywhere
  return {
    event_key: str(o.event_key),
    title: str(o.title),
    at,
    hours_until: num(o.hours_until),
    pressure: str(o.pressure, 'none'),
    kind: str(o.kind),
    kind_basis: str(o.kind_basis),
  };
}

/**
 * The focus block, or null.
 *
 * Null when the backend degraded the slice OR when nothing rose above
 * `routine` — the page then simply says nothing extra, which is the truthful
 * result for a project with no pressing concern rather than a promotion of its
 * calmest subject.
 */
export function normalizeFocus(value: unknown): ProjectFocus | null {
  const o = obj(value);
  if (!Object.keys(o).length) return null;
  const top = normalizeFocusItem(o.top);
  const next = arr(o.next).map(normalizeFocusItem)
    .filter((f): f is FocusItem => f !== null);
  const commitment = normalizeCommitment(o.commitment);
  if (!top && !next.length && !commitment) return null;
  const waiting = str(o.waiting_on);
  return {
    top,
    next,
    commitment,
    blocked: o.blocked === true,
    waiting_on: (RESOLUTIONS.includes(waiting as FocusResolution)
      ? waiting : '') as FocusResolution,
    counts: counts(o.counts),
  };
}

/**
 * Turn an untyped API payload into a fully-populated `ProjectWorkspace`, or
 * null when it is not a workspace at all. Every list defaults to empty and
 * every string to "", so the page never has to null-check a field the backend
 * degraded — a missing section renders as its truthful empty state.
 */
/** Explicit preferences only, and only ones we understand. A source we do not
 *  recognise, or a value from a newer backend, is dropped rather than rendered
 *  as a control nobody can operate. */
export function normalizeFeedPreferences(value: unknown): FeedPreferences {
  const out: FeedPreferences = {};
  for (const [source, pref] of Object.entries(obj(value))) {
    if (!source) continue;
    if (pref !== 'highlight' && pref !== 'hidden') continue;
    out[source] = pref;
  }
  return out;
}

/** Coordination metadata, defaulted to "nothing is happening". A backend that
 *  does not send the block (an older deployment, or the kill switch) therefore
 *  produces a page that simply never re-reads — the previous behaviour. */
export function normalizeRefresh(value: unknown): WorkspaceRefresh {
  const o = obj(value);
  const list = (v: unknown) => arr(v).map((x) => str(x)).filter(Boolean);
  const recheck = num(o.recheck_in_ms) ?? 0;
  return {
    started:  list(o.started),
    inFlight: list(o.in_flight),
    stale:    list(o.stale),
    // Clamped so a malformed or hostile value can never turn one re-read into a
    // tight loop or a wait measured in hours.
    recheckInMs: recheck > 0 ? Math.min(Math.max(recheck, 1000), 60_000) : 0,
  };
}

export function normalizeWorkspace(raw: unknown): ProjectWorkspace | null {
  const root = obj(raw);
  const project = obj(root.project);
  const id = str(project.id);
  if (!id) return null;

  const summary = obj(root.summary);
  const freshness = obj(root.freshness);
  const tasks = obj(root.tasks);
  const knowledge = obj(root.knowledge);

  return {
    project: {
      id,
      name: str(project.name),
      description: str(project.description),
      created_at: str(project.created_at),
      updated_at: str(project.updated_at),
    },
    summary: { text: str(summary.text), source: str(summary.source) },
    today: normalizeToday(root.today),
    goals: arr(root.goals).map((g) => {
      const o = obj(g);
      return {
        id: str(o.id),
        title: str(o.title),
        priority: num(o.priority),
        source: str(o.source, 'goals'),
      };
    }).filter((g) => !!g.title),
    attention: arr(root.attention)
      .map(normalizeAttentionItem)
      .filter((a): a is AttentionItem => a !== null),
    projectState: arr(root.project_state)
      .map(normalizeProjectStateItem)
      .filter((p): p is ProjectStateItem => p !== null),
    understanding: normalizeProjectUnderstanding(root.project_understanding),
    focus: normalizeFocus(root.focus),
    activity: arr(root.activity).map((a) => {
      const o = obj(a);
      return {
        id: str(o.id),
        source: str(o.source),
        kind: str(o.kind),
        title: str(o.title),
        occurred_at: str(o.occurred_at),
        ref: str(o.ref),
      };
    }),
    changes: normalizeChanges(root.changes),
    tasks: {
      items: arr(tasks.items).map(normalizeTask)
        .filter((t): t is ProjectTask => t !== null),
      counts: counts(tasks.counts),
    },
    knowledge: {
      items: arr(knowledge.items).map(normalizeKnowledgeItem)
        .filter((k): k is KnowledgeItem => k !== null),
      counts: counts(knowledge.counts),
    },
    products: arr(root.products).map((p) => obj(p) as WorkspaceProduct),
    chats: arr(root.chats).map((c) => {
      const o = obj(c);
      return {
        thread_id: str(o.thread_id),
        title: str(o.title),
        mode: str(o.mode),
        updated_at: str(o.updated_at),
      };
    }).filter((c) => !!c.thread_id),
    connectors: arr(root.connectors).map((c) => {
      const o = obj(c);
      return {
        provider: str(o.provider),
        label: str(o.label),
        resource_kind: str(o.resource_kind),
        resource_noun: str(o.resource_noun),
        resources: arr(o.resources).map((r) => str(r)).filter(Boolean),
        resource_count: num(o.resource_count) ?? 0,
        status: str(o.status),
        last_sync_at: str(o.last_sync_at),
      };
    }).filter((c) => !!c.provider),
    feedPreferences: normalizeFeedPreferences(root.feed_preferences),
    refresh: normalizeRefresh(root.refresh),
    freshness: {
      generated_at: str(freshness.generated_at),
      last_activity_at: str(freshness.last_activity_at),
      last_connector_sync_at: str(freshness.last_connector_sync_at),
      last_observation_at: str(freshness.last_observation_at),
      last_chat_at: str(freshness.last_chat_at),
      last_product_at: str(freshness.last_product_at),
    },
    counts: counts(root.counts),
  };
}

/* ── Relative time (translatable, never fabricated) ───────────────────────── */

/**
 * A relative-time token for a timestamp, or null when there is no usable
 * timestamp. The caller renders `unit`+`value` through the locale dictionary,
 * so "12m ago" is never hardcoded English.
 *
 * A FUTURE timestamp resolves to `now` rather than a negative age — clock skew
 * between a provider and the browser must not print "-3m ago".
 */
export type RelativeTime =
  | { unit: 'now' }
  | { unit: 'minutes' | 'hours' | 'days'; value: number };

export function relativeTime(iso: string | null | undefined, at: number = Date.now()): RelativeTime | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const seconds = Math.max(0, Math.floor((at - ms) / 1000));
  if (seconds < 60) return { unit: 'now' };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: 'minutes', value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', value: hours };
  return { unit: 'days', value: Math.floor(hours / 24) };
}

/**
 * The header freshness line. Reports the most recent REAL activity timestamp
 * the backend could derive, and nothing at all when there is none — the page
 * must never claim a "Live" state it cannot prove.
 */
export function freshnessRelative(
  freshness: WorkspaceFreshness | null | undefined,
  at: number = Date.now(),
): RelativeTime | null {
  return relativeTime(freshness?.last_activity_at || '', at);
}

/* ── Presentation mappings ────────────────────────────────────────────────── */

/** Tone for an attention severity. Purely visual; no severity is invented. */
export function severityTone(severity: AttentionSeverity): 'critical' | 'warning' | 'info' {
  if (severity === 'blocking') return 'critical';
  if (severity === 'time_sensitive') return 'warning';
  return 'info';
}

/**
 * The i18n key for an attention reason code. Unknown codes (a backend that
 * shipped a new reason before this bundle) fall back to a neutral key rather
 * than rendering a raw identifier at the user.
 */
const REASON_KEYS: Record<string, string> = {
  ci_failed: 'projectAttentionReasonCiFailed',
  deploy_failed: 'projectAttentionReasonDeployFailed',
  preview_deploy_failed: 'projectAttentionReasonPreviewDeployFailed',
  pr_awaiting: 'projectAttentionReasonPrAwaiting',
  meeting_soon: 'projectAttentionReasonMeetingSoon',
  meeting_cancelled: 'projectAttentionReasonMeetingCancelled',
  build_failed: 'projectAttentionReasonBuildFailed',
};

export function attentionReasonKey(reason: string): string {
  return REASON_KEYS[reason] || 'projectAttentionReasonGeneric';
}

/**
 * Display name for an activity/attention SOURCE.
 *
 * Provider names are product nouns and are NEVER translated (`Slack` is `Slack`
 * in every locale), so they are returned verbatim. Korvix's own internal
 * sources resolve to an i18n key instead.
 */
const PROVIDER_NAMES: Record<string, string> = {
  github: 'GitHub',
  gmail: 'Gmail',
  vercel: 'Vercel',
  slack: 'Slack',
  calendar: 'Google Calendar',
};

export type SourceLabel =
  | { kind: 'provider'; name: string }
  | { kind: 'i18n'; key: string };

export function sourceLabel(source: string): SourceLabel {
  const provider = PROVIDER_NAMES[source];
  if (provider) return { kind: 'provider', name: provider };
  if (source === 'chat') return { kind: 'i18n', key: 'projectSourceChat' };
  if (source === 'build') return { kind: 'i18n', key: 'projectSourceBuild' };
  if (source === 'task') return { kind: 'i18n', key: 'projectSourceTask' };
  if (source === 'knowledge') return { kind: 'i18n', key: 'projectSourceKnowledge' };
  return { kind: 'i18n', key: 'projectSourceActivity' };
}

/** `web` unless the backend says `app`. Never guessed from a title. */
export function productBuildType(product: WorkspaceProduct): 'web' | 'app' {
  return String(product.build_type || 'web').toLowerCase() === 'app' ? 'app' : 'web';
}

/**
 * i18n key for a product/build status, or null when the status is one this
 * bundle does not know. A null means the caller renders the backend's own word
 * verbatim — showing the real (if untranslated) status beats inventing one or
 * hiding it.
 */
const PRODUCT_STATUS_KEYS: Record<string, string> = {
  queued: 'projectStatusQueued',
  running: 'projectStatusRunning',
  completed: 'projectStatusCompleted',
  saved: 'projectStatusSaved',
  failed: 'projectStatusFailed',
  error: 'projectStatusFailed',
  errored: 'projectStatusFailed',
  cancelled: 'projectStatusCancelled',
  handoff: 'projectStatusHandoff',
};

export function productStatusKey(status?: string | null): string | null {
  const key = String(status || '').trim().toLowerCase();
  return key ? (PRODUCT_STATUS_KEYS[key] || null) : null;
}

/** i18n key for a relative-time token, shared by every timestamp on the page. */
export function relativeTimeKey(rel: RelativeTime): string {
  switch (rel.unit) {
    case 'now': return 'projectTimeNow';
    case 'minutes': return 'projectTimeMinutes';
    case 'hours': return 'projectTimeHours';
    default: return 'projectTimeDays';
  }
}

/** i18n key for the header's freshness line. */
export function freshnessKey(rel: RelativeTime): string {
  switch (rel.unit) {
    case 'now': return 'projectFreshnessNow';
    case 'minutes': return 'projectFreshnessMinutes';
    case 'hours': return 'projectFreshnessHours';
    default: return 'projectFreshnessDays';
  }
}

/**
 * Connected-tools summary line for one provider, as translatable parts.
 *
 * ACCOUNT-cardinality providers (Gmail) bind the whole authorized account and
 * have no resource to name, so they render as "enabled" rather than an invented
 * resource count. Providers that DO name resources list the first few and count
 * the rest. Opaque provider ids are never part of this — the backend only ever
 * sends human labels.
 */
export type ConnectorSummary =
  | { kind: 'pending' }
  | { kind: 'revoked' }
  | { kind: 'enabled' }
  | { kind: 'resources'; named: string[]; extra: number };

export function connectorSummary(connector: WorkspaceConnector): ConnectorSummary {
  if (connector.status === 'pending_selection') return { kind: 'pending' };
  if (connector.status === 'revoked') return { kind: 'revoked' };
  if (connector.resources.length === 0) return { kind: 'enabled' };
  const named = connector.resources.slice(0, 2);
  return { kind: 'resources', named, extra: Math.max(0, connector.resource_count - named.length) };
}

/* ── Today: recommendation + actions ──────────────────────────────────────── */

/**
 * i18n key for a next-best-action reason code.
 *
 * Unknown codes (a backend that shipped a new reason before this bundle) fall
 * back to a neutral key rather than rendering a raw identifier — the same rule
 * `attentionReasonKey` follows.
 */
const RECOMMENDATION_KEYS: Record<string, string> = {
  investigate_failed_deploy: 'projectTodayRecoInvestigateDeploy',
  investigate_failed_preview_deploy: 'projectTodayRecoInvestigatePreviewDeploy',
  fix_failing_checks: 'projectTodayRecoFixChecks',
  fix_failed_build: 'projectTodayRecoFixBuild',
  review_open_pull_request: 'projectTodayRecoReviewPr',
  prepare_for_meeting: 'projectTodayRecoPrepareMeeting',
  review_calendar_change: 'projectTodayRecoReviewCalendar',
  review_signal: 'projectTodayRecoReviewSignal',
  continue_task: 'projectTodayRecoContinueTask',
  start_task: 'projectTodayRecoStartTask',
  unblock_task: 'projectTodayRecoUnblockTask',
  continue_goal: 'projectTodayRecoContinueGoal',
};

export function recommendationReasonKey(reason: string): string {
  return RECOMMENDATION_KEYS[reason] || 'projectTodayRecoGeneric';
}

/** The action codes this bundle can actually render. An action the backend
 *  sends that is not in this list is DROPPED rather than rendered as a button
 *  with an unknown label — a dead button is worse than a missing one. */
const ACTION_KEYS: Record<string, string> = {
  ask_korvix: 'projectActionAsk',
  create_task: 'projectTodayActionCreateTask',
  open_tasks: 'projectTodayActionOpenTasks',
};

export function recommendationActionKey(action: string): string | null {
  return ACTION_KEYS[action] || null;
}

export function renderableActions(recommendation: TodayRecommendation | null): string[] {
  if (!recommendation) return [];
  return recommendation.actions.filter((a) => ACTION_KEYS[a] !== undefined);
}

/**
 * The prompt to seed "Ask Korvix" with from a recommendation, as an i18n key,
 * or null when there is no recommendation. The question is always about the
 * SAME thing the recommendation names, so the two can never disagree.
 */
export function recommendationAskKey(recommendation: TodayRecommendation | null): string | null {
  if (!recommendation) return null;
  if (recommendation.source === 'task') return 'projectTodayAskTaskPrompt';
  if (recommendation.source === 'goal') return 'projectTodayAskGoalPrompt';
  return 'projectTodayAskSignalPrompt';
}

/* ── Tasks ────────────────────────────────────────────────────────────────── */

/** Display order of the four states — the same order the backend sorts by. */
export const TASK_STATUS_ORDER: TaskStatus[] = ['todo', 'doing', 'waiting', 'done'];

const TASK_STATUS_KEYS: Record<TaskStatus, string> = {
  todo: 'projectTaskStatusTodo',
  doing: 'projectTaskStatusDoing',
  waiting: 'projectTaskStatusWaiting',
  done: 'projectTaskStatusDone',
};

export function taskStatusKey(status: TaskStatus): string {
  return TASK_STATUS_KEYS[status] || TASK_STATUS_KEYS.todo;
}

/**
 * The state a one-tap toggle moves a task to.
 *
 * Deliberately only the completion axis: `done` ⇄ the state it came back to.
 * A finished task returns to `todo` rather than guessing which of the three
 * open states it used to be in — the full move lives in the explicit status
 * control, and a checkbox should never make a choice the user did not.
 */
export function toggledTaskStatus(status: TaskStatus): TaskStatus {
  return status === 'done' ? 'todo' : 'done';
}

/** Open (unfinished) tasks, in the order the backend already sorted them. */
export function openTasks(tasks: readonly ProjectTask[]): ProjectTask[] {
  return tasks.filter((t) => t.status !== 'done');
}

/** The open-task count, from the backend's own totals — NOT from the bounded
 *  slice on the page, which would under-report a project with many tasks. */
export function openTaskCount(workspace: ProjectWorkspace | null): number {
  return workspace?.tasks.counts.open ?? 0;
}

/* ── Knowledge ────────────────────────────────────────────────────────────── */

export const KNOWLEDGE_KIND_ORDER: KnowledgeKind[] =
  ['decision', 'requirement', 'constraint', 'fact', 'note'];

const KNOWLEDGE_KIND_KEYS: Record<KnowledgeKind, string> = {
  decision: 'projectKnowledgeKindDecision',
  requirement: 'projectKnowledgeKindRequirement',
  constraint: 'projectKnowledgeKindConstraint',
  fact: 'projectKnowledgeKindFact',
  note: 'projectKnowledgeKindNote',
};

export function knowledgeKindKey(kind: KnowledgeKind): string {
  return KNOWLEDGE_KIND_KEYS[kind] || KNOWLEDGE_KIND_KEYS.note;
}

/** Total knowledge items the project holds, from the backend's own totals. */
export function knowledgeCount(workspace: ProjectWorkspace | null): number {
  return workspace?.knowledge.counts.total ?? 0;
}

/* ── Changes ──────────────────────────────────────────────────────────────── */

/**
 * The section title — and it is NOT cosmetic. `since_last_visit` is the only
 * mode allowed to say "Since your last visit"; anything else says "Recent
 * changes", because we cannot prove a visit we never recorded.
 */
export function changesTitleKey(changes: WorkspaceChanges | null | undefined): string {
  return changes?.mode === 'since_last_visit'
    ? 'projectChangesSinceTitle'
    : 'projectChangesRecentTitle';
}

/** i18n key for the "N changes" line, singular-aware. */
export function changesCountKey(count: number): string {
  return count === 1 ? 'projectChangesCountOne' : 'projectChangesCountMany';
}

const CHANGE_KIND_KEYS: Record<string, string> = {
  connector: 'projectChangeKindConnector',
  chat: 'projectChangeKindChat',
  build: 'projectChangeKindBuild',
  task: 'projectChangeKindTask',
  knowledge: 'projectChangeKindKnowledge',
};

export function changeKindKey(change: string): string | null {
  return CHANGE_KIND_KEYS[change] || null;
}

/**
 * Should the page acknowledge this visit?
 *
 * Only once the workspace has actually rendered, and only when the snapshot
 * carries the instant it was generated at — that timestamp IS the marker, so
 * without it the acknowledgement would land on "now" and swallow anything that
 * arrived while the read was in flight.
 */
export function seenThrough(workspace: ProjectWorkspace | null): string | null {
  const generated = workspace?.freshness.generated_at || '';
  return generated ? generated : null;
}

/* ── Project understanding: presentation ──────────────────────────────────── */

/**
 * i18n key for a subject/project state code.
 *
 * The vocabulary is the backend's, and it is closed — an unrecognised code
 * (a backend ahead of this bundle) falls back to a neutral key rather than
 * printing `likely_resolved` at a person.
 */
const STATE_KEYS: Record<string, string> = {
  unresolved: 'projectStateUnresolved',
  conflicting: 'projectStateConflicting',
  in_progress: 'projectStateInProgress',
  likely_resolved: 'projectStateLikelyResolved',
  observed: 'projectStateObserved',
  no_evidence: 'projectStateNoEvidence',
};

export function stateKey(state: string): string {
  return STATE_KEYS[state] || 'projectStateGeneric';
}

/** Tone for a state. Purely visual — no state is invented, and this is NOT a
 *  severity: `attention` owns severity and this block never reorders it. */
export function stateTone(state: string): 'critical' | 'warning' | 'positive' | 'info' {
  if (state === 'unresolved' || state === 'conflicting') return 'critical';
  if (state === 'in_progress') return 'warning';
  if (state === 'likely_resolved') return 'positive';
  return 'info';
}

const AREA_KEYS: Record<string, string> = {
  frontend: 'projectAreaFrontend',
  backend: 'projectAreaBackend',
  deployment: 'projectAreaDeployment',
  auth: 'projectAreaAuth',
  billing: 'projectAreaBilling',
  database: 'projectAreaDatabase',
  connector: 'projectAreaConnector',
  product: 'projectAreaProduct',
  infrastructure: 'projectAreaInfrastructure',
  content: 'projectAreaContent',
  unknown: 'projectAreaUnknown',
};

export function areaKey(area: string): string | null {
  return AREA_KEYS[area] || null;
}

const SUBJECT_CHANGE_KIND_KEYS: Record<string, string> = {
  feature: 'projectChangeKindFeature',
  bug: 'projectChangeKindBug',
  regression: 'projectChangeKindRegression',
  deployment: 'projectChangeKindDeployment',
  configuration: 'projectChangeKindConfiguration',
  dependency: 'projectChangeKindDependency',
  security: 'projectChangeKindSecurity',
  operational: 'projectChangeKindOperational',
  communication: 'projectChangeKindCommunication',
};

/** `null` for `unknown` (and for anything unrecognised): the page shows no
 *  kind rather than a chip that says "unknown", which tells a user nothing. */
export function changeKindKeyOf(kind: string): string | null {
  return SUBJECT_CHANGE_KIND_KEYS[kind] || null;
}

const IMPLICATION_KEYS: Record<string, string> = {
  production_broken: 'projectImplicationProductionBroken',
  recurrence: 'projectImplicationRecurrence',
  fix_not_proven_live: 'projectImplicationFixNotProvenLive',
  blocked_by_ci: 'projectImplicationBlockedByCi',
  issue_open: 'projectImplicationIssueOpen',
  preview_only_verified: 'projectImplicationPreviewOnly',
  work_in_flight: 'projectImplicationWorkInFlight',
  reported_but_unconfirmed: 'projectImplicationReportedOnly',
  verified_live: 'projectImplicationVerifiedLive',
};

export function implicationKey(code: string): string | null {
  return IMPLICATION_KEYS[code] || null;
}

const UNCERTAINTY_KEYS: Record<string, string> = {
  conflicting_evidence: 'projectUncertaintyConflicting',
  production_unverified: 'projectUncertaintyProductionUnverified',
  deploy_outcome_unknown: 'projectUncertaintyDeployUnknown',
  stale_evidence: 'projectUncertaintyStale',
  single_source: 'projectUncertaintySingleSource',
  topical_link_only: 'projectUncertaintyTopicalLink',
  thin_evidence: 'projectUncertaintyThin',
  no_decisive_evidence: 'projectUncertaintyNoDecisive',
  undated_evidence: 'projectUncertaintyUndated',
  unknown_affected_scope: 'projectUncertaintyUnknownScope',
};

export function uncertaintyKey(code: string): string | null {
  return UNCERTAINTY_KEYS[code] || null;
}

const GAP_KEYS: Record<string, string> = {
  no_evidence: 'projectGapNoEvidence',
  no_recent_evidence: 'projectGapNoRecentEvidence',
  single_source_project: 'projectGapSingleSource',
  no_deployment_evidence: 'projectGapNoDeployEvidence',
  production_unverified: 'projectGapProductionUnverified',
  unknown_affected_scope: 'projectGapUnknownScope',
};

export function gapKey(code: string): string | null {
  return GAP_KEYS[code] || null;
}

/**
 * The codes a subject can actually render, in backend order, already filtered
 * to what this bundle has a translation for. A code we cannot name is dropped
 * — a bullet reading `deploy_outcome_unknown` is worse than one less bullet.
 */
export function renderableCodes(
  codes: readonly UnderstandingCode[] | null | undefined,
  resolve: (code: string) => string | null,
  limit = 3,
): { code: string; key: string }[] {
  const out: { code: string; key: string }[] = [];
  for (const entry of codes || []) {
    const key = resolve(entry.code);
    if (key) out.push({ code: entry.code, key });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * "Why Korvix thinks this" — the grouping rationale, as translatable parts.
 *
 * This is the honesty surface: it names how many separate pieces of evidence
 * from how many tools were joined, and whether they were joined by a SHARED
 * RESOURCE (a commit, a PR, a deployment) or merely by wording. A user who
 * disagrees with a grouping should be able to see, in one line, why it
 * happened. Returns null when the subject carries nothing to justify.
 */
export interface GroupingRationale {
  evidenceCount: number;
  sourceCount: number;
  sources: string[];
  /** True when the backend flagged the join as topical rather than structural. */
  wordingOnly: boolean;
}

export function groupingRationale(item: ProjectStateItem): GroupingRationale | null {
  if (!item.evidence_count && !item.sources.length) return null;
  const wordingOnly = (item.understanding?.uncertainty || [])
    .some((u) => u.code === 'topical_link_only');
  return {
    evidenceCount: item.evidence_count,
    sourceCount: item.sources.length,
    sources: item.sources,
    wordingOnly,
  };
}

/**
 * Should the "Current state" section be rendered at all?
 *
 * Only when there is a real reading to show. A project with no observations
 * gets NOTHING here rather than an empty panel captioned with a state code —
 * the page already says "connect a tool" in the places that own that message,
 * and a second empty box is clutter, not information.
 */
export function hasUnderstanding(workspace: ProjectWorkspace | null): boolean {
  if (!workspace) return false;
  if (workspace.projectState.length > 0) return true;
  const coverage = workspace.understanding?.coverage;
  return !!coverage && coverage.observations > 0;
}

/**
 * The honest caveat line for the whole section, as an i18n key, or null.
 *
 * At most ONE is shown, strongest first: a page that lists four caveats reads
 * as noise and gets ignored, which defeats the point of being honest.
 */
export function coverageCaveatKey(understanding: ProjectUnderstanding | null): string | null {
  if (!understanding) return null;
  const codes = new Set(understanding.gaps.map((g) => g.code));
  if (codes.has('no_recent_evidence')) return 'projectUnderstandingCaveatStale';
  if (codes.has('single_source_project')) return 'projectUnderstandingCaveatSingleSource';
  if (codes.has('no_deployment_evidence')) return 'projectUnderstandingCaveatNoDeploy';
  return null;
}

/* ── Focus: presentation ──────────────────────────────────────────────────── */

/**
 * i18n key for a tier basis — the ONE line that answers "why is this #1?".
 *
 * The backend's tier INTEGER is deliberately never rendered. A person reading
 * "production is broken" learns something; a person reading "tier 2" learns
 * that a machine has opinions.
 */
const FOCUS_BASIS_KEYS: Record<string, string> = {
  deadline_risk: 'projectFocusBasisDeadlineRisk',
  production_broken: 'projectFocusBasisProductionBroken',
  customer_impact: 'projectFocusBasisCustomerImpact',
  blocked: 'projectFocusBasisBlocked',
  unverified: 'projectFocusBasisUnverified',
  time_sensitive: 'projectFocusBasisTimeSensitive',
  routine: 'projectFocusBasisRoutine',
};

export function focusBasisKey(basis: string): string | null {
  return FOCUS_BASIS_KEYS[basis] || null;
}

/** Tone for a basis. Purely visual, and deliberately coarser than the ladder:
 *  the page shows "this is bad" / "this is timing" / "this is open", never a
 *  seven-step colour scale a reader would have to decode. */
export function focusTone(basis: string): 'critical' | 'warning' | 'info' {
  if (basis === 'deadline_risk' || basis === 'production_broken'
      || basis === 'customer_impact') return 'critical';
  if (basis === 'blocked' || basis === 'time_sensitive') return 'warning';
  return 'info';
}

/**
 * i18n keys for the "why now" codes.
 *
 * The vocabulary spans two backend authorities on purpose: the implication
 * codes are `project_intelligence`'s and already have translated strings, so
 * they are REUSED rather than duplicated under a second set of keys — one
 * concept, one sentence, in every language.
 */
const FOCUS_WHY_KEYS: Record<string, string> = {
  deadline_imminent: 'projectFocusWhyDeadlineImminent',
  deadline_approaching: 'projectFocusWhyDeadlineApproaching',
  customer_impact_corroborated: 'projectFocusWhyCustomerCorroborated',
  customer_impact_reported: 'projectFocusWhyCustomerReported',
  goal_aligned: 'projectFocusWhyGoalAligned',
  recurring_failure: 'projectFocusWhyRecurring',
  production_broken: 'projectImplicationProductionBroken',
  recurrence: 'projectImplicationRecurrence',
  fix_not_proven_live: 'projectImplicationFixNotProvenLive',
  blocked_by_ci: 'projectImplicationBlockedByCi',
  issue_open: 'projectImplicationIssueOpen',
};

export function focusWhyKey(code: string): string | null {
  return FOCUS_WHY_KEYS[code] || null;
}

/** i18n keys for the caveats. The uncertainty vocabulary is reused verbatim;
 *  only what the decision layer adds needs its own string. */
const FOCUS_CAVEAT_KEYS: Record<string, string> = {
  decision_recorded_after_evidence: 'projectFocusCaveatDecided',
  part_of_related_story: 'projectFocusCaveatRelated',
};

export function focusCaveatKey(code: string): string | null {
  return FOCUS_CAVEAT_KEYS[code] || uncertaintyKey(code);
}

/**
 * The "who has to act" line, as an i18n key, or null.
 *
 * This is the distinction the surface exists to make honest: an alarm that
 * implies Korvix will handle a production deployment is worse than no alarm.
 */
export function focusOwnerKey(item: FocusItem | null): string | null {
  if (!item) return null;
  if (item.actionability.resolution === 'human_external') {
    return 'projectFocusOwnerHuman';
  }
  if (item.actionability.resolution === 'korvix') return 'projectFocusOwnerKorvix';
  return null;
}

/** The bounded reasons a row should print. At most two: a list of four reads
 *  as noise and gets skipped, which defeats the point of explaining. */
export function focusReasonKeys(item: FocusItem | null, limit = 2): string[] {
  if (!item) return [];
  const out: string[] = [];
  for (const code of item.why_now) {
    const key = focusWhyKey(code);
    if (key && !out.includes(key)) out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

/* ── "Ask Korvix" suggestions ─────────────────────────────────────────────── */

/**
 * The suggested questions to offer, as i18n keys.
 *
 * Every suggestion is STATIC text gated on a concept that actually exists in
 * this project's state — no model is called to invent a question, and a
 * suggestion is never shown for something the project has nothing to say about.
 * A project with no signals at all still gets the one question that is always
 * answerable ("what is this project about"), so the row is never empty.
 */
export interface AskSuggestion {
  /** Stable id (used as a React key and for the analytics-free ordering). */
  id: string;
  /** i18n key for the button label AND the prompt text seeded into chat. */
  labelKey: string;
  promptKey: string;
}

export function askSuggestions(workspace: ProjectWorkspace | null): AskSuggestion[] {
  const out: AskSuggestion[] = [];
  if (!workspace) return out;
  if (workspace.attention.length > 0) {
    out.push({
      id: 'attention',
      labelKey: 'projectAskAttentionLabel',
      promptKey: 'projectAskAttentionPrompt',
    });
  }
  if (workspace.activity.length > 0) {
    out.push({
      id: 'changed',
      labelKey: 'projectAskChangedLabel',
      promptKey: 'projectAskChangedPrompt',
    });
  }
  if (workspace.projectState.length > 0) {
    out.push({
      id: 'state',
      labelKey: 'projectAskStateLabel',
      promptKey: 'projectAskStatePrompt',
    });
  }
  if ((workspace.understanding?.uncertain.length || 0) > 0
      || (workspace.understanding?.gaps.length || 0) > 0) {
    out.push({
      id: 'uncertain',
      labelKey: 'projectAskUncertainLabel',
      promptKey: 'projectAskUncertainPrompt',
    });
  }
  if (workspace.goals.length > 0) {
    out.push({
      id: 'goals',
      labelKey: 'projectAskGoalsLabel',
      promptKey: 'projectAskGoalsPrompt',
    });
  }
  out.push({
    id: 'about',
    labelKey: 'projectAskAboutLabel',
    promptKey: 'projectAskAboutPrompt',
  });
  return out;
}

/**
 * The chat URL for a project-bound conversation, optionally seeded with a
 * question.
 *
 * This deliberately reuses the EXISTING chat entry points
 * (`?newChatForProject=` / `?openSession=`) rather than introducing a second
 * chat surface: the chat authority still creates the session, still owns the
 * serverThreadId, and still performs the deferred project binding once the
 * server thread exists. The optional `prefill` only seeds the composer — it
 * never sends a turn.
 */
export function newProjectChatUrl(projectId: string, prefill?: string): string {
  const base = `/chat?newChatForProject=${encodeURIComponent(projectId)}`;
  const text = (prefill || '').trim();
  return text ? `${base}&prefill=${encodeURIComponent(text)}` : base;
}

export function openProjectChatUrl(threadId: string): string {
  return `/chat?openSession=${encodeURIComponent(threadId)}`;
}

/**
 * Where "open" on a product row goes, or null when there is nowhere truthful to
 * send the user.
 *
 * A saved Web/App build is reopened through the conversation it was generated
 * in — that is the surface the chat authority already restores an embedded
 * build into. A product with no recorded thread (an orchestrator-produced
 * deliverable, or a save from before the thread was recorded) therefore shows
 * NO open affordance rather than a link that would resolve to nothing.
 */
export function productOpenTarget(product: WorkspaceProduct): string | null {
  const threadId = String(product.thread_id || '').trim();
  return threadId ? openProjectChatUrl(threadId) : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   PROVIDER TEXT — the one door connector-authored strings come through
   ══════════════════════════════════════════════════════════════════════════

   A Slack message, a mail subject, a PR title, a commit message and a calendar
   title are DATA. They are written by whoever can post into a connected tool,
   which on a shared repository or a public channel is not necessarily someone
   the reader trusts. React already escapes them as text, so HTML injection is
   not the risk here. The risks that remain are typographic:

     * a newline, so the text renders as two lines and the second one can be
       styled by its neighbours into looking like a section heading;
     * a bidi override (U+202E and friends), which visually REVERSES the text
       that follows it and can make one sentence read as another — including
       past the element's own bounds;
     * zero-width and control characters, used to break a word up so a reader
       (or a filter) does not see what is actually there;
     * unbounded length, which pushes real UI off the screen.

   So every provider-authored string is normalized HERE, once, and rendered as
   a single line of plain text in a deliberately quieter style than Korvix's
   own words. It is never passed to the markdown renderer (which is reserved
   for Korvix's own answer), never used as a heading, and never given the
   typography that signals product authority.

   This is presentation safety, not truth: nothing here changes what the
   evidence says, only how much a provider can borrow the product's voice.
*/

/** Characters that can move, hide or reverse text. U+200D (ZWJ) is kept on
 *  purpose — stripping it would break ordinary emoji sequences. */
// The control characters ARE the subject of this rule: stripping them is
// exactly what this expression is for, so the lint rule that forbids them
// inside a pattern is disabled here and nowhere else in the file.
const UNSAFE_TEXT_RE =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export const PROVIDER_TEXT_MAX = 240;

/**
 * One line of safe, bounded, plain provider text — or "" when there is nothing
 * to show. Pure, so the rule is testable rather than trusted.
 */
export function providerText(raw: unknown, limit: number = PROVIDER_TEXT_MAX): string {
  if (typeof raw !== 'string' || !raw) return '';
  const flat = raw
    .replace(/[\r\n\t\v\f\u0085\u2028\u2029]+/g, ' ')   // never more than one line
    .replace(UNSAFE_TEXT_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const bound = Math.max(1, limit);
  return flat.length > bound ? `${flat.slice(0, bound - 1)}…` : flat;
}

/* ── Evidence: outcome, tone and the story timeline ───────────────────────── */

/** i18n key for a semantic type — the backend's closed event vocabulary. An
 *  unrecognised type renders NO outcome word rather than a raw code. */
const SEMANTIC_KEYS: Record<string, string> = {
  change_proposed: 'projectEvidenceChangeProposed',
  change_landed: 'projectEvidenceChangeLanded',
  change_abandoned: 'projectEvidenceChangeAbandoned',
  change_pushed: 'projectEvidenceChangePushed',
  ci_failed: 'projectEvidenceCiFailed',
  ci_passed: 'projectEvidenceCiPassed',
  deploy_failed: 'projectEvidenceDeployFailed',
  deploy_succeeded: 'projectEvidenceDeploySucceeded',
  deploy_cancelled: 'projectEvidenceDeployCancelled',
  deploy_started: 'projectEvidenceDeployStarted',
  issue_opened: 'projectEvidenceIssueOpened',
  issue_closed: 'projectEvidenceIssueClosed',
  discussion: 'projectEvidenceDiscussion',
  mail: 'projectEvidenceMail',
  meeting: 'projectEvidenceMeeting',
  activity: 'projectEvidenceActivity',
};

export function evidenceOutcomeKey(semanticType: string): string | null {
  return SEMANTIC_KEYS[semanticType] || null;
}

/** Tone for an evidence row. Presentation of the backend's OWN polarity — the
 *  page never reads an outcome out of a title. */
export function evidenceTone(
  polarity: EvidencePolarity,
): 'positive' | 'negative' | 'pending' | 'neutral' {
  if (polarity === 'positive') return 'positive';
  if (polarity === 'negative') return 'negative';
  if (polarity === 'pending') return 'pending';
  return 'neutral';
}

/**
 * One story's evidence as a CHRONOLOGY — the thing a person actually wants
 * when they ask "what happened here?".
 *
 * Supporting, contradicting and context rows are the backend's three display
 * projections of the same events, so they are merged, deduplicated by
 * observation id, and ordered oldest-first: a story reads forwards.
 *
 * DELIBERATELY NOT COLLAPSED BY SOURCE. A preview check that passed and a
 * production deployment that failed are two facts; merging them into one
 * "Vercel" row would be exactly the "conflicting evidence quietly averaged
 * away" failure this surface exists to prevent.
 */
export function storyTimeline(
  item: ProjectStateItem | null | undefined,
  limit = 8,
): EvidenceRef[] {
  if (!item) return [];
  const seen = new Set<string>();
  const rows: EvidenceRef[] = [];
  for (const row of [...item.supporting, ...item.contradicting, ...item.context]) {
    const id = row.observation_id
      || `${row.source}:${row.semantic_type}:${row.observed_at}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(row);
  }
  rows.sort((a, b) => {
    const at = Date.parse(a.observed_at || '');
    const bt = Date.parse(b.observed_at || '');
    // An undatable row sorts LAST rather than pretending to be the oldest.
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return at - bt;
  });
  return rows.slice(0, Math.max(1, limit));
}

/**
 * The number the "N evidence" affordance prints.
 *
 * The backend's deduplicated `evidence_count`, but never smaller than the rows
 * about to be rendered — the same rule `normalizeChanges` follows for the
 * change count. Understating what is visibly on screen reads as a bug.
 */
export function evidenceCount(item: ProjectStateItem | null | undefined): number {
  if (!item) return 0;
  return Math.max(item.evidence_count, storyTimeline(item, 99).length);
}

/**
 * The compact per-source outcome strip — "GitHub ✓ merged · Vercel ✕ production".
 *
 * One row per (source, environment, polarity) triple, newest first, so a
 * failed production deploy and a passing preview check both survive. Purely a
 * projection of `storyTimeline`; nothing is re-decided here.
 */
export interface StoryOutcome {
  source: string;
  semantic_type: string;
  polarity: EvidencePolarity;
  environment: string;
  observed_at: string;
}

export function storyOutcomes(
  item: ProjectStateItem | null | undefined,
  limit = 4,
): StoryOutcome[] {
  const seen = new Map<string, StoryOutcome>();
  for (const row of storyTimeline(item, 99)) {
    if (!row.source) continue;
    const key = `${row.source}|${row.environment}|${row.polarity}`;
    const current = seen.get(key);
    const at = Date.parse(row.observed_at || '') || 0;
    if (!current || at >= (Date.parse(current.observed_at || '') || 0)) {
      seen.set(key, {
        source: row.source,
        semantic_type: row.semantic_type,
        polarity: row.polarity,
        environment: row.environment,
        observed_at: row.observed_at,
      });
    }
  }
  return [...seen.values()]
    .sort((a, b) => (Date.parse(b.observed_at || '') || 0)
      - (Date.parse(a.observed_at || '') || 0))
    .slice(0, Math.max(1, limit));
}

/* ── Grounding: presentation of "why Korvix thinks this" ──────────────────── */

/** i18n key for a claim class. Unknown codes are DROPPED — a bullet reading
 *  `business_outcome` tells a person nothing. */
const CLAIM_KEYS: Record<string, string> = {
  deployment: 'projectClaimDeployment',
  code_change: 'projectClaimCodeChange',
  tests: 'projectClaimTests',
  coordination: 'projectClaimCoordination',
  functionality: 'projectClaimFunctionality',
  users: 'projectClaimUsers',
  feedback: 'projectClaimFeedback',
  goal_progress: 'projectClaimGoalProgress',
  business_outcome: 'projectClaimBusinessOutcome',
};

export function claimKey(claim: string): string | null {
  return CLAIM_KEYS[claim] || null;
}

/** i18n key for an evidence class — what WOULD establish a claim. */
const EVIDENCE_CLASS_KEYS: Record<string, string> = {
  deployment_event: 'projectEvidenceNeedDeployment',
  code_change_event: 'projectEvidenceNeedCodeChange',
  ci_or_test_report: 'projectEvidenceNeedCheck',
  meeting_or_message: 'projectEvidenceNeedMessage',
  person_stating_it: 'projectEvidenceNeedPerson',
  recorded_customer_fact: 'projectEvidenceNeedCustomerFact',
  recorded_metric_or_business_fact: 'projectEvidenceNeedMetricFact',
  recorded_project_goal: 'projectEvidenceNeedGoal',
};

export function evidenceClassKey(code: string): string | null {
  return EVIDENCE_CLASS_KEYS[code] || null;
}

export interface RenderableClaim {
  claim: string;
  key: string;
  support: ClaimSupport;
  basis: ClaimBasis;
  singleSource: boolean;
  /** i18n keys for the evidence that would establish it. Bounded. */
  missingKeys: string[];
}

function toRenderableClaim(row: GroundedClaim): RenderableClaim | null {
  const key = claimKey(row.claim);
  if (!key) return null;
  return {
    claim: row.claim,
    key,
    support: row.support,
    basis: row.basis,
    singleSource: row.single_source,
    missingKeys: row.missing.map(evidenceClassKey)
      .filter((k): k is string => !!k).slice(0, 2),
  };
}

/**
 * What this story's evidence ESTABLISHES — `direct` support only.
 *
 * The line is drawn exactly where the grounding authority draws it. `indirect`
 * is adjacent evidence, and adjacent evidence is never reported as the claim.
 */
export function establishedClaims(
  grounding: StoryGrounding | null | undefined,
  limit = 4,
): RenderableClaim[] {
  return (grounding?.claims || [])
    .filter((c) => c.support === 'direct')
    .map(toRenderableClaim)
    .filter((c): c is RenderableClaim => c !== null)
    .slice(0, Math.max(1, limit));
}

/** Claims with ADJACENT evidence only. Shown as such, never as findings. */
export function adjacentClaims(
  grounding: StoryGrounding | null | undefined,
  limit = 3,
): RenderableClaim[] {
  return (grounding?.claims || [])
    .filter((c) => c.support === 'indirect')
    .map(toRenderableClaim)
    .filter((c): c is RenderableClaim => c !== null)
    .slice(0, Math.max(1, limit));
}

/**
 * What this evidence does NOT establish.
 *
 * `none` only. A claim with adjacent evidence is reported in its own band, so
 * it is never listed twice — the two lists are disjoint, and together they
 * cover everything short of `direct`, which is the grounding authority's own
 * definition of "may not be asserted".
 */
export function notEstablishedClaims(
  grounding: StoryGrounding | null | undefined,
  limit = 5,
): RenderableClaim[] {
  return (grounding?.claims || [])
    .filter((c) => c.support === 'none')
    .map(toRenderableClaim)
    .filter((c): c is RenderableClaim => c !== null)
    .slice(0, Math.max(1, limit));
}

/** Is there anything worth opening an evidence disclosure for? */
export function hasGrounding(item: ProjectStateItem | null | undefined): boolean {
  if (!item) return false;
  return storyTimeline(item, 1).length > 0
    || establishedClaims(item.grounding, 1).length > 0;
}

/* ── The FOCUS story: a join, never a re-ranking ──────────────────────────── */

/** The correlated subject with this id, or null. */
export function findProjectState(
  workspace: ProjectWorkspace | null | undefined,
  subjectId: string,
): ProjectStateItem | null {
  if (!workspace || !subjectId) return null;
  return workspace.projectState.find((s) => s.id === subjectId) || null;
}

/**
 * The ONE thing the page leads with, assembled from three authorities that
 * already agree:
 *
 *   `focus.top`        the Business Brain's decision reading — WHICH subject
 *                      leads and why. Computed by the identical function that
 *                      orders the Brain's candidates.
 *   `projectState`     that subject's correlated evidence — the story.
 *   `today.attention`  the top-ranked open signal — the alarm.
 *
 * THIS FUNCTION RANKS NOTHING. It resolves the focus subject by id and carries
 * the alarm the backend already chose. `null` everywhere is the truthful answer
 * for a quiet project, and the page then renders a quiet line rather than an
 * empty card.
 */
export interface WorkspaceFocus {
  item: FocusItem | null;
  story: ProjectStateItem | null;
  attention: AttentionItem | null;
  commitment: FocusCommitment | null;
}

export function workspaceFocus(workspace: ProjectWorkspace | null): WorkspaceFocus {
  const empty: WorkspaceFocus = {
    item: null, story: null, attention: null, commitment: null,
  };
  if (!workspace) return empty;
  const top = workspace.focus?.top || null;
  return {
    item: top,
    story: top ? findProjectState(workspace, top.subject_id) : null,
    attention: workspace.today.attention,
    commitment: workspace.focus?.commitment || null,
  };
}

/** Does the page have a real Focus to lead with? */
export function hasFocus(focus: WorkspaceFocus): boolean {
  return !!(focus.item || focus.attention);
}

/* ── Changes as STORIES ───────────────────────────────────────────────────── */

/**
 * The change rows, with the correlated ones resolved to their full story.
 *
 * The GROUPING is the backend's: a connector change already carries the subject
 * the correlation authority put it in, and `recent_changes` already kept one
 * row per subject. All this does is attach that subject's evidence so the row
 * can be opened without a second request.
 */
export interface ChangeStory {
  change: ChangeItem;
  story: ProjectStateItem | null;
}

export function changeStories(
  workspace: ProjectWorkspace | null,
  changes: WorkspaceChanges | null | undefined,
  limit = 6,
): ChangeStory[] {
  const items = changes?.items || [];
  return items.slice(0, Math.max(1, limit)).map((change) => ({
    change,
    story: change.subject_id ? findProjectState(workspace, change.subject_id) : null,
  }));
}

/**
 * May the page print the strong "while you were away" claim?
 *
 * Only with a real marker AND something inside the window. Same rule
 * `changesTitleKey` encodes, stated as one question so the headline and the
 * list can never be rendered from two different answers.
 */
export function hasVisitChanges(changes: WorkspaceChanges | null | undefined): boolean {
  return changes?.mode === 'since_last_visit' && (changes?.count ?? 0) > 0;
}

/* ── Project memory: presentation grouping over the SAME authorities ──────── */

export interface KnowledgeGroup {
  kind: KnowledgeKind;
  labelKey: string;
  items: KnowledgeItem[];
  /** The authority's own total for this kind — never `items.length`, which is
   *  a bounded slice. 0 when the backend sent no count for it. */
  total: number;
}

/**
 * The knowledge rows grouped by kind, in the vocabulary's binding order.
 *
 * PRESENTATION ONLY. Decisions still live in the decision authority and the
 * rest in the project-memory authority; this groups what the backend already
 * projected and creates no third store. A kind with nothing in it is omitted
 * rather than rendered as an empty heading.
 */
export function knowledgeGroups(
  knowledge: WorkspaceKnowledge | null | undefined,
): KnowledgeGroup[] {
  const items = knowledge?.items || [];
  const counts = knowledge?.counts || {};
  const out: KnowledgeGroup[] = [];
  for (const kind of KNOWLEDGE_KIND_ORDER) {
    const rows = items.filter((i) => i.kind === kind);
    if (!rows.length) continue;
    out.push({
      kind,
      labelKey: knowledgeKindKey(kind),
      items: rows,
      total: counts[kind] ?? 0,
    });
  }
  return out;
}

/**
 * The project's OPEN KNOWLEDGE GAPS, as i18n keys.
 *
 * The synthesis authority's own `gaps` codes — what Korvix knows it cannot
 * see. That is memory too: "we have no production evidence" is a fact about
 * the project worth carrying beside the facts we do have.
 */
export function knowledgeGapKeys(
  understanding: ProjectUnderstanding | null | undefined,
  limit = 3,
): { code: string; key: string }[] {
  return renderableCodes(understanding?.gaps, gapKey, limit);
}

/**
 * Does the project have any real memory to show?
 *
 * A summary, a recorded item, or a named gap. When none of those exist the page
 * says the honest empty thing once, in a quiet line — not a large empty card
 * captioned "Korvix has not generated a summary yet".
 */
export function hasProjectMemory(workspace: ProjectWorkspace | null): boolean {
  if (!workspace) return false;
  return !!workspace.summary.text
    || workspace.knowledge.items.length > 0
    || knowledgeCount(workspace) > 0
    || (workspace.understanding?.gaps.length || 0) > 0;
}
