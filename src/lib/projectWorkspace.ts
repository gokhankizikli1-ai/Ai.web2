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
  title: string;
  detail: string;
  occurred_at: string;
  ref: string;
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

export interface ProjectWorkspace {
  project: WorkspaceProject;
  summary: { text: string; source: string };
  today: WorkspaceToday;
  goals: WorkspaceGoal[];
  attention: AttentionItem[];
  activity: ActivityItem[];
  changes: WorkspaceChanges;
  tasks: WorkspaceTasks;
  knowledge: WorkspaceKnowledge;
  products: WorkspaceProduct[];
  chats: WorkspaceChat[];
  connectors: WorkspaceConnector[];
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

/**
 * Turn an untyped API payload into a fully-populated `ProjectWorkspace`, or
 * null when it is not a workspace at all. Every list defaults to empty and
 * every string to "", so the page never has to null-check a field the backend
 * degraded — a missing section renders as its truthful empty state.
 */
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
