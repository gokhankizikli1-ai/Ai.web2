/**
 * ProjectOverview — the Project WORKSPACE, the default surface for
 * /projects/:id.
 *
 * WHAT THIS PAGE IS
 * -----------------
 * "The place I open to understand and move this project forward." It answers,
 * in scanning order: what needs attention, what this project is about, what to
 * ask Korvix, what the goals are, what changed, and what the project owns
 * (products, chats, connected tools).
 *
 * ONE READ, BACKEND-AUTHORITATIVE
 * -------------------------------
 * Everything on this page comes from a SINGLE bounded read model —
 * `GET /v2/projects/{id}/workspace` (see
 * `backend/services/project_brain/workspace.py`). That read performs no
 * provider API call, no model call and no write; it projects authorities that
 * already exist (observations, goals, deliverables, project↔thread bindings,
 * connector bindings). The page therefore never fans out to Gmail/GitHub/Vercel
 * on mount, never polls, and never becomes a second source of truth. The
 * previous three-call fan-out (chats + products + brain) is now one call.
 *
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------
 * Not a second chat app (every chat action routes into the existing chat
 * authority, which still owns session identity and the project binding), not a
 * second build studio (products are references with an open action), not an
 * analytics dashboard (no invented metrics, percentages or progress bars), and
 * not a connector manager (Manage connections routes to the existing connector
 * authority at /settings/integrations).
 *
 * FOUR VIEWS, ONE READ
 * --------------------
 * Overview / Tasks / Knowledge / Activity are VIEWS over the same page, selected
 * by `?view=` so a view is linkable and the browser Back button works. Overview
 * and Activity render entirely from the mount snapshot — switching to them costs
 * ZERO requests. Tasks and Knowledge load their FULL list on first open (the
 * snapshot carries only a bounded slice for the Overview), which is a request
 * the user asked for by opening that view, not mount fan-out.
 *
 * WHAT THE WRITES ARE
 * -------------------
 * The mutating actions here are: add/remove a chat (unchanged, the same
 * server-authoritative binding endpoints as before), create/edit/move/delete a
 * project TASK, add/remove a KNOWLEDGE item, and the one-per-visit
 * acknowledgement that moves this user's last-visit marker. Every one is an
 * explicit user action, every one is server-authoritative, and NONE of them
 * starts a run, proposes a candidate action or calls a model. A task is a note
 * to yourself; Korvix never executes it for you.
 *
 * WHY THE ARRIVAL SNAPSHOT IS PINNED
 * ----------------------------------
 * "Since your last visit" describes the moment you ARRIVED. If it re-derived on
 * every refresh, adding a task would silently empty the list the user was still
 * reading. The first successful load's `changes` block is therefore held for the
 * lifetime of the mount while everything else refreshes normally.
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft, MessageSquare, Plus, FolderInput, Blocks, Sparkles,
  Github, Mail, Target, Loader2, Check, X, Search, AlertTriangle,
  MoreHorizontal, FolderMinus, CalendarDays, Triangle, Activity, Hash,
  Clock, Plug, ArrowUpRight, RefreshCw, ChevronRight, CheckCircle2, Circle,
  CirclePause, CircleDot, BookMarked, ListTodo, Trash2, History,
} from 'lucide-react';
import { getProject } from '@/stores/projectStore';
import { useLanguageStore } from '@/stores/languageStore';
import {
  listAddableChats, bindThreadToProject, removeThreadFromProject,
  getProjectWorkspace, listProjectTasks, createProjectTask, updateProjectTask,
  deleteProjectTask, listProjectKnowledge, addProjectKnowledge,
  removeProjectKnowledge, markProjectWorkspaceSeen, type AddableChat,
} from '@/lib/projectApi';
import {
  areaKey, askSuggestions, attentionReasonKey, changeKindKey, changeKindKeyOf,
  changesCountKey, changesTitleKey, connectorSummary, coverageCaveatKey,
  freshnessKey, freshnessRelative, gapKey, groupingRationale, hasUnderstanding,
  implicationKey, knowledgeKindKey, newProjectChatUrl, openProjectChatUrl,
  openTasks, productBuildType, productOpenTarget, productStatusKey,
  recommendationActionKey, recommendationAskKey, recommendationReasonKey,
  relativeTime, relativeTimeKey, renderableActions, renderableCodes,
  seenThrough, severityTone, sourceLabel, stateKey, stateTone, taskStatusKey,
  toggledTaskStatus, uncertaintyKey,
  KNOWLEDGE_KIND_ORDER, TASK_STATUS_ORDER,
  type AttentionItem, type KnowledgeItem, type KnowledgeKind,
  type ProjectStateItem, type ProjectTask, type ProjectUnderstanding,
  type ProjectWorkspace, type TaskStatus,
  type TodayRecommendation, type WorkspaceChanges, type WorkspaceChat,
  type WorkspaceConnector, type WorkspaceProduct,
} from '@/lib/projectWorkspace';

type T = (key: string, params?: Record<string, string | number>) => string;

/* ── Shared surface tokens — the authenticated dark workspace language ────── */
const PANEL = 'rounded-2xl border border-white/[0.06] bg-white/[0.02]';
const SECTION_TITLE = 'flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-white/45';
const HEADER_BTN = 'inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12px] text-white/65 hover:text-white hover:bg-white/[0.06] border border-white/[0.07] transition-all';
const PRIMARY_BTN = 'inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-[12px] font-medium text-[#BFDBFE] bg-[#3B82F6]/[0.14] border border-[#3B82F6]/30 hover:bg-[#3B82F6]/[0.22] transition-all';
const EMPTY_TEXT = 'text-[12.5px] leading-relaxed text-white/35';

/** Relative time rendered through the locale dictionary (never hardcoded). */
function useTimeAgo(t: T) {
  return useCallback((iso?: string | null): string => {
    const rel = relativeTime(iso);
    if (!rel) return '';
    return rel.unit === 'now'
      ? t(relativeTimeKey(rel))
      : t(relativeTimeKey(rel), { value: rel.value });
  }, [t]);
}

/* Icon for an activity/attention SOURCE, keyed by the observation `source` the
 * backend registry emits (observations_store.CONNECTOR_SOURCES) plus Korvix's
 * own chat/build sources. An unknown source falls back to a neutral glyph
 * rather than being mislabelled as one of the known providers. */
function SourceIcon({ source, className }: { source?: string | null; className?: string }) {
  const cls = className || 'h-3.5 w-3.5 shrink-0 text-white/35';
  switch (source) {
    case 'gmail': return <Mail className={cls} />;
    case 'calendar': return <CalendarDays className={cls} />;
    case 'github': return <Github className={cls} />;
    case 'vercel': return <Triangle className={cls} />;
    case 'slack': return <Hash className={cls} />;
    case 'chat': return <MessageSquare className={cls} />;
    case 'build': return <Blocks className={cls} />;
    case 'task': return <ListTodo className={cls} />;
    case 'knowledge': return <BookMarked className={cls} />;
    default: return <Activity className={cls} />;
  }
}

function SourceName({ source, t }: { source: string; t: T }) {
  const label = sourceLabel(source);
  return <>{label.kind === 'provider' ? label.name : t(label.key)}</>;
}

/* ══════════════════════════════════════════════════════════════════════════
   "Add existing chat" picker — unchanged behaviour, translated copy.
   ══════════════════════════════════════════════════════════════════════════ */
function AddExistingChatModal({
  projectId, currentThreadIds, onClose, onChanged, t,
}: {
  projectId: string;
  /** Server truth for "already in THIS project", from the workspace read. */
  currentThreadIds: readonly string[];
  onClose: () => void;
  onChanged: () => void;
  t: T;
}) {
  const [items, setItems] = useState<AddableChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const timeAgo = useTimeAgo(t);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const list = await listAddableChats(projectId, currentThreadIds);
      if (!cancelled) { setItems(list); setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [projectId, currentThreadIds]);

  const act = useCallback(async (c: AddableChat) => {
    if (c.inCurrentProject) return;
    setBusyId(c.id);
    const res = await bindThreadToProject(c.id, projectId);
    setBusyId(null);
    if (res.ok) {
      // Reflect backend truth locally, then refresh the workspace.
      setItems((prev) => prev.map((x) => x.id === c.id
        ? { ...x, inCurrentProject: true, otherProjectId: null, otherProjectName: null } : x));
      onChanged();
    }
  }, [projectId, onChanged]);

  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((c) => c.title.toLowerCase().includes(q)) : items;
  const showSearch = items.length > 8;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className={`${PANEL} w-full max-w-md max-h-[80vh] flex flex-col`}
        style={{ background: 'rgba(17,23,34,0.98)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-white/85">
            <FolderInput className="h-4 w-4 text-[#60A5FA]" /> {t('projectAddExistingTitle')}
          </div>
          <button onClick={onClose} aria-label={t('projectClose')}
            className="text-white/40 hover:text-white/80 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {showSearch && (
          <div className="px-4 pt-3">
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 h-8">
              <Search className="h-3.5 w-3.5 text-white/30" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={t('projectAddExistingSearch')}
                className="flex-1 min-w-0 bg-transparent text-[12px] text-white/80 placeholder:text-white/25 outline-none" />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
          {loading ? (
            <div className="flex items-center gap-2 text-[12px] text-white/40 px-2 py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('projectAddExistingLoading')}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-[12px] text-white/40 px-2 py-4">
              {items.length === 0 ? t('projectAddExistingNone') : t('projectAddExistingNoMatch')}
            </p>
          ) : filtered.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-white/30" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-[12.5px] text-white/80">{c.title}</div>
                <div className="truncate text-[10px] text-white/30">
                  {timeAgo(c.updated_at)}
                  {c.otherProjectName ? ` · ${t('projectAddExistingIn', { project: c.otherProjectName })}` : ''}
                </div>
              </div>
              {c.inCurrentProject ? (
                <span className="shrink-0 flex items-center gap-1 text-[11px] text-[#34D399]">
                  <Check className="h-3.5 w-3.5" /> {t('projectAddExistingInProject')}
                </span>
              ) : (
                <button onClick={() => act(c)} disabled={busyId === c.id}
                  className="shrink-0 flex items-center gap-1 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.12] px-2.5 h-7 text-[11px] font-medium text-[#93C5FD] hover:bg-[#3B82F6]/[0.2] transition-all disabled:opacity-50">
                  {busyId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {c.otherProjectId ? t('projectAddExistingMove') : t('projectAddExistingAdd')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Needs attention — the strongest section on the page.
   ══════════════════════════════════════════════════════════════════════════ */
const TONE_STYLE: Record<'critical' | 'warning' | 'info' | 'positive', { dot: string; text: string }> = {
  critical: { dot: '#F87171', text: '#FCA5A5' },
  warning: { dot: '#FBBF24', text: '#FCD34D' },
  info: { dot: '#60A5FA', text: '#93C5FD' },
  positive: { dot: '#4ADE80', text: '#86EFAC' },
};

function AttentionRow({ item, t }: { item: AttentionItem; t: T }) {
  const tone = TONE_STYLE[severityTone(item.severity)];
  const timeAgo = useTimeAgo(t);
  const when = timeAgo(item.observed_at);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-snug text-white/85 break-words">
          {t(attentionReasonKey(item.reason))}
        </div>
        {item.title && (
          <div className="mt-0.5 text-[12px] leading-snug text-white/50 break-words line-clamp-2">
            {item.title}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-white/30">
          <span className="inline-flex items-center gap-1">
            <SourceIcon source={item.source} className="h-3 w-3 shrink-0 text-white/30" />
            <SourceName source={item.source} t={t} />
          </span>
          {item.context && <span className="truncate max-w-[220px]">· {item.context}</span>}
          {when && <span>· {when}</span>}
        </div>
      </div>
    </li>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CURRENT STATE — "what is actually going on in this project?"

   The one place the page answers the question a person actually arrives with.
   It renders the backend's correlated + interpreted reading
   (`project_intelligence`) and derives NOTHING of its own.

   WHAT A NORMAL USER MUST NEVER SEE HERE
   --------------------------------------
   No agents, no DAGs, no correlation jargon, no confidence arithmetic, no
   internal state-machine names, no raw observation flood. A subject shows what
   happened, what it means, and — on demand — why Korvix grouped the evidence
   and what it still does not know. The words are human ("Needs attention",
   "Not yet known"), and every one of them is a translation of a stable backend
   code, never English composed by the API.

   THIS IS NOT A RANKING
   ---------------------
   Order is the backend's presentation order, unchanged. "What deserves your
   attention" is still answered by Needs Attention directly above, and "what
   should we do" is still the Business Brain's answer — this section never
   proposes work, and there is deliberately no action button on a subject
   beyond asking Korvix about it.
   ══════════════════════════════════════════════════════════════════════════ */
function StateChip({ state, t }: { state: string; t: T }) {
  const tone = TONE_STYLE[stateTone(state)];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10.5px] font-medium"
      style={{ color: tone.text, borderColor: `${tone.dot}40`, background: `${tone.dot}14` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
      {t(stateKey(state))}
    </span>
  );
}

function SubjectRow({ item, onAsk, t }: {
  item: ProjectStateItem;
  onAsk: (prompt: string) => void;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  const timeAgo = useTimeAgo(t);
  const understanding = item.understanding;

  // What it MEANS — at most two, so the collapsed row stays one glance.
  const implications = renderableCodes(understanding?.implications, implicationKey, 2);
  const uncertainty = renderableCodes(understanding?.uncertainty, uncertaintyKey, 3);
  const areas = (understanding?.areas || [])
    .map((a) => ({ ...a, key: areaKey(a.area) }))
    .filter((a) => a.key && a.area !== 'unknown');
  const kindKey = changeKindKeyOf(understanding?.change_kind.kind || '');
  const rationale = groupingRationale(item);
  const change = understanding?.last_meaningful_change || null;

  return (
    <li className="py-3 first:pt-1 last:pb-1">
      <div className="flex flex-wrap items-center gap-2">
        <StateChip state={item.state} t={t} />
        <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-white/90 break-words">
          {item.subject}
        </span>
      </div>

      {implications.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {implications.map((imp) => (
            <li key={imp.code} className="text-[12.5px] leading-snug text-white/60 break-words">
              {t(imp.key)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-white/30">
        {areas.map((a) => (
          <span key={a.area} className="rounded-md bg-white/[0.05] px-1.5 py-[2px] text-white/45">
            {t(a.key as string)}
          </span>
        ))}
        {kindKey && (
          <span className="rounded-md bg-white/[0.05] px-1.5 py-[2px] text-white/45">
            {t(kindKey)}
          </span>
        )}
        {item.sources.map((src) => (
          <span key={src} className="inline-flex items-center gap-1">
            <SourceIcon source={src} className="h-3 w-3 shrink-0 text-white/30" />
          </span>
        ))}
        {change?.at && <span>· {timeAgo(change.at)}</span>}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-white/40 hover:text-white/70 transition-colors"
        >
          {t(open ? 'projectStateWhyHide' : 'projectStateWhy')}
          <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="mt-2.5 space-y-2.5 rounded-xl border border-white/[0.05] bg-white/[0.015] p-3">
          {/* WHY these were grouped. The honesty surface: a user who disagrees
              with a grouping can see exactly what joined it. */}
          {rationale && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
                {t('projectStateWhyTitle')}
              </div>
              <div className="text-[12px] leading-relaxed text-white/55">
                {t(rationale.wordingOnly
                  ? 'projectStateGroupedByWording'
                  : 'projectStateGroupedByResource', {
                  evidence: rationale.evidenceCount,
                  sources: rationale.sourceCount,
                })}
              </div>
            </div>
          )}

          {/* WHAT CHANGED — the last thing that actually moved this subject. */}
          {change?.title && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
                {t('projectStateChangedTitle')}
              </div>
              <div className="flex items-start gap-2 text-[12px] leading-snug text-white/55">
                <SourceIcon source={change.source} className="mt-[3px] h-3 w-3 shrink-0 text-white/30" />
                <span className="min-w-0 break-words">{change.title}</span>
              </div>
            </div>
          )}

          {/* WHAT IS KNOWN — the evidence, by its own titles. Bounded. */}
          {(item.supporting.length > 0 || item.contradicting.length > 0) && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
                {t('projectStateEvidenceTitle')}
              </div>
              <ul className="space-y-1">
                {[...item.supporting, ...item.contradicting].slice(0, 4).map((e) => (
                  <li key={`${e.observation_id}-${e.semantic_type}`}
                      className="flex items-start gap-2 text-[12px] leading-snug text-white/50">
                    <SourceIcon source={e.source} className="mt-[3px] h-3 w-3 shrink-0 text-white/30" />
                    <span className="min-w-0 break-words">{e.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* WHAT IS UNCERTAIN — never omitted to make the reading look neat. */}
          {uncertainty.length > 0 && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
                {t('projectStateUncertainTitle')}
              </div>
              <ul className="space-y-1">
                {uncertainty.map((u) => (
                  <li key={u.code} className="text-[12px] leading-snug text-white/50 break-words">
                    {t(u.key)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => onAsk(t('projectStateAskPrompt', { subject: item.subject }))}
            className={HEADER_BTN}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('projectActionAsk')}
          </button>
        </div>
      )}
    </li>
  );
}

function CurrentStateSection({ items, understanding, onAsk, t }: {
  items: ProjectStateItem[];
  understanding: ProjectUnderstanding | null;
  onAsk: (prompt: string) => void;
  t: T;
}) {
  // AT MOST ONE caveat, and only a real one. A wall of hedges reads as noise
  // and gets skipped, which defeats the point of being honest.
  const caveat = coverageCaveatKey(understanding);
  const gaps = renderableCodes(understanding?.gaps, gapKey, 2)
    .filter((g) => g.code !== 'no_recent_evidence'
      && g.code !== 'single_source_project'
      && g.code !== 'no_deployment_evidence');

  return (
    <section className={`${PANEL} p-4 sm:p-5`}>
      <div className={`${SECTION_TITLE} mb-2`}>
        <CircleDot className="h-3.5 w-3.5 text-[#93C5FD]" />
        {t('projectSectionState')}
      </div>
      {caveat && (
        <div className="mb-2 text-[11.5px] leading-relaxed text-white/35">{t(caveat)}</div>
      )}
      {items.length === 0 ? (
        <p className={EMPTY_TEXT}>{t('projectStateEmpty')}</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {items.map((item) => (
            <SubjectRow key={item.id} item={item} onAsk={onAsk} t={t} />
          ))}
        </ul>
      )}
      {gaps.length > 0 && (
        <div className="mt-3 border-t border-white/[0.05] pt-2.5">
          <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
            {t('projectStateGapsTitle')}
          </div>
          <ul className="space-y-1">
            {gaps.map((g) => (
              <li key={g.code} className="text-[12px] leading-snug text-white/45 break-words">
                {t(g.key)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TODAY — "what should I care about right now?"

   Renders exactly two facts and nothing else: the top-ranked open signal, and
   the deterministic next best action the backend chose. There is no score, no
   percentage and no "everything looks great" — when both are null the section
   says so plainly. Every button here corresponds to an affordance that exists;
   an action code this bundle does not know is dropped rather than rendered.
   ══════════════════════════════════════════════════════════════════════════ */
function TodaySection({
  attention, recommendation, changes, onAsk, onCreateTask, onOpenTasks,
  onOpenActivity, t,
}: {
  attention: AttentionItem | null;
  recommendation: TodayRecommendation | null;
  changes: WorkspaceChanges | null;
  onAsk: (prompt: string) => void;
  onCreateTask: (prefill: string) => void;
  onOpenTasks: () => void;
  onOpenActivity: () => void;
  t: T;
}) {
  const timeAgo = useTimeAgo(t);
  const actions = renderableActions(recommendation);
  const askKey = recommendationAskKey(recommendation);
  const changeCount = changes?.count ?? 0;

  const run = (action: string) => {
    if (action === 'ask_korvix') onAsk(askKey ? t(askKey) : '');
    else if (action === 'create_task') onCreateTask(recommendation?.title || '');
    else if (action === 'open_tasks') onOpenTasks();
  };

  return (
    <section className={`${PANEL} p-4 sm:p-5`}
      style={attention
        ? { borderColor: 'rgba(248,113,113,0.16)', background: 'rgba(248,113,113,0.025)' }
        : undefined}>
      <div className={`${SECTION_TITLE} mb-3`}>
        <Sparkles className="h-3.5 w-3.5 text-[#FBBF24]" />
        {t('projectSectionToday')}
      </div>

      {!attention && !recommendation ? (
        <p className={EMPTY_TEXT}>{t('projectTodayEmpty')}</p>
      ) : (
        <div className="space-y-3.5">
          {attention && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
                {t('projectTodayAttentionLabel')}
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: TONE_STYLE[severityTone(attention.severity)].dot }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium leading-snug text-white/90 break-words">
                    {t(attentionReasonKey(attention.reason))}
                  </div>
                  {attention.title && (
                    <div className="mt-0.5 text-[12px] leading-snug text-white/55 break-words line-clamp-2">
                      {attention.title}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10.5px] text-white/30">
                    <span className="inline-flex items-center gap-1">
                      <SourceIcon source={attention.source} className="h-3 w-3 shrink-0 text-white/30" />
                      <SourceName source={attention.source} t={t} />
                    </span>
                    {attention.context && <span className="truncate max-w-[220px]">· {attention.context}</span>}
                    {timeAgo(attention.observed_at) && <span>· {timeAgo(attention.observed_at)}</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {recommendation && (
            <div className={attention ? 'pt-3.5 border-t border-white/[0.05]' : undefined}>
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
                {t('projectTodayRecommendLabel')}
              </div>
              <div className="text-[13.5px] font-medium leading-snug text-white/90 break-words">
                {t(recommendationReasonKey(recommendation.reason))}
              </div>
              {recommendation.title && (
                <div className="mt-0.5 text-[12px] leading-snug text-white/55 break-words line-clamp-2">
                  {recommendation.title}
                </div>
              )}
              {actions.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {actions.map((action, i) => {
                    const key = recommendationActionKey(action);
                    if (!key) return null;
                    return (
                      <button key={action} onClick={() => run(action)}
                        className={i === 0 ? PRIMARY_BTN : HEADER_BTN}>
                        {t(key)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Shown ONLY when a real last-visit marker exists.
          "Since your last visit" is information the Activity tab does not
          already carry. "Recent changes" IS the Activity tab — printing it here
          too would be a second card saying the same thing, with a deduplicated
          count that disagrees with the timeline's row count for no reason. So
          on a first visit this line is simply absent, which is also the truth:
          you have not been away. */}
      {changes?.mode === 'since_last_visit' && changeCount > 0 && (
        <button onClick={onOpenActivity}
          className="mt-3.5 pt-3 w-full border-t border-white/[0.05] flex items-center gap-1.5 text-[11.5px] text-white/45 hover:text-white transition-colors">
          <History className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {t(changesTitleKey(changes))} · {t(changesCountKey(changeCount), { count: changeCount })}
          </span>
          <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Changes — the "since your last visit" / "recent changes" list.

   The TITLE is not cosmetic: only a payload carrying a real per-user marker is
   allowed to claim a visit, and `changesTitleKey` enforces that. `count` comes
   from the backend and may exceed the rendered rows, so a bound is stated
   ("+N more") rather than quietly swallowing the rest.
   ══════════════════════════════════════════════════════════════════════════ */
function ChangesList({ changes, t }: { changes: WorkspaceChanges | null; t: T }) {
  const timeAgo = useTimeAgo(t);
  if (!changes) return null;
  const hidden = Math.max(0, changes.count - changes.items.length);
  return (
    <section className={`${PANEL} p-4 sm:p-5`}>
      <div className={`${SECTION_TITLE} mb-2`}>
        <History className="h-3.5 w-3.5 text-white/40" />
        {t(changesTitleKey(changes))}
      </div>
      {changes.items.length === 0 ? (
        <p className={EMPTY_TEXT}>
          {changes.mode === 'since_last_visit'
            ? t('projectChangesEmpty')
            : t('projectChangesEmptyRecent')}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.04] -my-1">
            {changes.items.map((c) => {
              const kindKey = changeKindKey(c.change);
              return (
                <li key={c.key} className="flex items-start gap-2.5 py-2">
                  <SourceIcon source={c.source} className="mt-[3px] h-3.5 w-3.5 shrink-0 text-white/30" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] leading-snug text-white/70 break-words line-clamp-2">
                      {c.title || (kindKey ? t(kindKey) : c.change)}
                    </div>
                    {/* The SOURCE, exactly as the timeline names it — "Vercel",
                        not the generic "Connected tool". Same row, same words. */}
                    <div className="text-[10.5px] text-white/28">
                      <SourceName source={c.source} t={t} />
                      {c.occurred_at ? ` · ${timeAgo(c.occurred_at)}` : ''}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {hidden > 0 && (
            <p className="mt-2.5 text-[10.5px] text-white/25">
              {t('projectChangesMore', { count: hidden })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Tasks

   Four states, one line each, and a composer. Every mutation goes to the
   backend and the caller re-reads — the browser never holds task truth, and
   localStorage is not involved. Creating or completing a task changes nothing
   except the task: no run starts, no action is proposed.
   ══════════════════════════════════════════════════════════════════════════ */
const STATUS_ICON: Record<TaskStatus, typeof Circle> = {
  todo: Circle,
  doing: CircleDot,
  waiting: CirclePause,
  done: CheckCircle2,
};

function TaskComposer({
  value, onChange, onSubmit, onCancel, busy, t,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  t: T;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5">
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={t('projectTaskAddPlaceholder')}
        className="flex-1 min-w-[140px] bg-transparent text-[12.5px] text-white/85 placeholder:text-white/25 outline-none" />
      <button onClick={onSubmit} disabled={busy || !value.trim()}
        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[#3B82F6]/30 bg-[#3B82F6]/[0.12] px-2.5 h-7 text-[11px] font-medium text-[#93C5FD] hover:bg-[#3B82F6]/[0.2] transition-all disabled:opacity-40">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {t('projectTaskSave')}
      </button>
      <button onClick={onCancel}
        className="shrink-0 rounded-md px-2 h-7 text-[11px] text-white/45 hover:text-white hover:bg-white/[0.06] transition-all">
        {t('projectTaskCancel')}
      </button>
    </div>
  );
}

function TaskRow({
  task, onToggle, onMove, onDelete, showStatus = true, t,
}: {
  task: ProjectTask;
  onToggle: (task: ProjectTask) => void;
  onMove: (task: ProjectTask, status: TaskStatus) => void;
  onDelete: (task: ProjectTask) => void;
  /** False inside a status-GROUPED list, where the group heading already says
   *  it and repeating it on every row is pure noise. */
  showStatus?: boolean;
  t: T;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const Icon = STATUS_ICON[task.status];
  const done = task.status === 'done';

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  return (
    <div ref={ref} className="group relative flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-all">
      <button onClick={() => onToggle(task)}
        aria-label={done ? t('projectTaskReopen') : t('projectTaskMarkDone')}
        className="shrink-0 text-white/30 hover:text-[#34D399] transition-colors">
        <Icon className={`h-4 w-4 ${done ? 'text-[#34D399]' : ''}`} />
      </button>
      <div className="min-w-0 flex-1">
        <div className={`text-[12.5px] leading-snug break-words ${done ? 'text-white/35 line-through' : 'text-white/80'}`}>
          {task.title}
        </div>
        {showStatus && task.status !== 'todo' && !done && (
          <div className="text-[10px] text-white/30">{t(taskStatusKey(task.status))}</div>
        )}
      </div>
      <button onClick={() => setMenuOpen((o) => !o)} aria-label={t('projectTaskActions')}
        className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-all">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <div role="menu"
          className="absolute right-1 top-full mt-1 w-52 rounded-xl border shadow-2xl overflow-hidden z-50 py-1"
          style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(17,23,34,0.98)', backdropFilter: 'blur(24px)' }}>
          {TASK_STATUS_ORDER.filter((s) => s !== task.status).map((status) => {
            const StatusIcon = STATUS_ICON[status];
            return (
              <button key={status} role="menuitem"
                onClick={() => { setMenuOpen(false); onMove(task, status); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-white/70 hover:bg-white/[0.05] transition-all">
                <StatusIcon className="h-3.5 w-3.5 shrink-0 text-white/40" />
                <span className="min-w-0 truncate">
                  {t('projectTaskMoveTo', { status: t(taskStatusKey(status)) })}
                </span>
              </button>
            );
          })}
          <button role="menuitem" onClick={() => { setMenuOpen(false); onDelete(task); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-[#FCA5A5] hover:bg-white/[0.05] transition-all border-t border-white/[0.05] mt-1 pt-2">
            <Trash2 className="h-3.5 w-3.5 shrink-0" /> {t('projectTaskDelete')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Knowledge

   Durable statements that must outlive the conversation. An item Korvix
   derived (a decision a build recorded) is shown with NO remove affordance
   rather than a button that would 404 — `removable` is server truth.
   ══════════════════════════════════════════════════════════════════════════ */
const KIND_TONE: Record<KnowledgeKind, string> = {
  decision: '#C4B5FD',
  requirement: '#93C5FD',
  constraint: '#FCD34D',
  fact: '#6EE7B7',
  note: 'rgba(255,255,255,0.45)',
};

function KnowledgeRow({
  item, onRemove, alignLabels = false, t,
}: {
  item: KnowledgeItem;
  onRemove: ((item: KnowledgeItem) => void) | null;
  /** Fixed-width kind badges so statements align into a column. Only in the
   *  wide Knowledge view — in the narrow rail a fixed width either clips the
   *  longest label or eats the space the statement needs. */
  alignLabels?: boolean;
  t: T;
}) {
  return (
    <div className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-all">
      <span className={`mt-[3px] shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide${
        alignLabels ? ' w-[84px] text-center' : ''}`}
        style={{ background: 'rgba(255,255,255,0.05)', color: KIND_TONE[item.kind] }}>
        {t(knowledgeKindKey(item.kind))}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] leading-snug text-white/75 break-words">{item.text}</div>
        {item.label && (
          <div className="text-[10px] text-white/28 truncate">{item.label}</div>
        )}
      </div>
      {onRemove && item.removable && (
        <button onClick={() => onRemove(item)} aria-label={t('projectKnowledgeDelete')}
          className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-6 w-6 flex items-center justify-center rounded-md text-white/25 hover:text-[#FCA5A5] hover:bg-white/[0.06] transition-all">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Chats — one row with the Open / Remove kebab (server-authoritative unbind).
   ══════════════════════════════════════════════════════════════════════════ */
function ProjectChatRow({
  chat, onOpen, onRemoved, t,
}: {
  chat: WorkspaceChat;
  onOpen: (threadId: string) => void;
  onRemoved: () => void;
  t: T;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timeAgo = useTimeAgo(t);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const remove = useCallback(async () => {
    setBusy(true);
    // Non-destructive unbind: the conversation + messages stay; only the project
    // binding is dropped (server-authoritative). Refresh from backend truth.
    const res = await removeThreadFromProject(chat.thread_id);
    setBusy(false);
    setMenuOpen(false);
    if (res.ok) onRemoved();
  }, [chat.thread_id, onRemoved]);

  return (
    <div ref={ref} className="group relative flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-all">
      <button onClick={() => onOpen(chat.thread_id)} className="flex flex-1 min-w-0 items-center gap-2 text-left">
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-white/25 group-hover:text-white/55" />
        <span className="flex-1 min-w-0 truncate text-[12.5px] text-white/75">{chat.title}</span>
        <span className="shrink-0 text-[10px] text-white/25">{timeAgo(chat.updated_at)}</span>
      </button>
      <button onClick={() => setMenuOpen((o) => !o)} aria-label={t('projectChatActions')}
        className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-white/25 hover:text-white/70 hover:bg-white/[0.06] transition-all">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <div role="menu"
          className="absolute right-1 top-full mt-1 w-48 rounded-xl border shadow-2xl overflow-hidden z-50 py-1"
          style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(17,23,34,0.98)', backdropFilter: 'blur(24px)' }}>
          <button role="menuitem" onClick={() => { setMenuOpen(false); onOpen(chat.thread_id); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-white/70 hover:bg-white/[0.05] transition-all">
            <MessageSquare className="h-3.5 w-3.5 text-white/40" /> {t('projectChatOpen')}
          </button>
          <button role="menuitem" onClick={() => { void remove(); }} disabled={busy}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-[#FCA5A5] hover:bg-white/[0.05] transition-all disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderMinus className="h-3.5 w-3.5" />}
            {t('projectChatRemove')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Products & builds — project artifacts, references only.
   ══════════════════════════════════════════════════════════════════════════ */
function ProductRow({
  product, onOpen, t,
}: {
  product: WorkspaceProduct;
  onOpen: (product: WorkspaceProduct) => void;
  t: T;
}) {
  const type = productBuildType(product);
  const statusKey = productStatusKey(product.status);
  const timeAgo = useTimeAgo(t);
  const when = timeAgo(product.updated_at);
  // Open/continue is offered ONLY when there is a real destination (the chat the
  // build was generated in, which the chat authority restores the embedded
  // build into) — never a dead link.
  const openable = productOpenTarget(product) !== null;
  return (
    <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-all">
      <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
        style={type === 'app'
          ? { background: 'rgba(192,132,252,0.12)', color: '#D8B4FE' }
          : { background: 'rgba(52,211,153,0.12)', color: '#6EE7B7' }}>
        {type === 'app' ? t('projectBuildApp') : t('projectBuildWeb')}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-white/75">{product.title || '—'}</div>
        <div className="truncate text-[10px] text-white/30">
          {statusKey ? t(statusKey) : (product.status || '')}
          {when ? ` · ${when}` : ''}
        </div>
      </div>
      {openable && (
        <button onClick={() => onOpen(product)}
          className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[11px] text-white/55 hover:text-white hover:bg-white/[0.06] transition-all">
          {t('projectActionOpen')} <ArrowUpRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Connected tools — a compact summary of what this project reads.
   ══════════════════════════════════════════════════════════════════════════ */
function ConnectorRow({ connector, t }: { connector: WorkspaceConnector; t: T }) {
  const summary = connectorSummary(connector);
  const timeAgo = useTimeAgo(t);
  const synced = timeAgo(connector.last_sync_at);
  let detail: React.ReactNode = null;
  if (summary.kind === 'pending') detail = <span className="text-[#FCD34D]">{t('projectToolsPending')}</span>;
  else if (summary.kind === 'revoked') detail = <span className="text-[#FCA5A5]">{t('projectToolsRevoked')}</span>;
  else if (summary.kind === 'enabled') detail = t('projectToolsEnabled');
  else {
    detail = (
      <>
        {summary.named.join(', ')}
        {summary.extra > 0 ? ` ${t('projectToolsMore', { count: summary.extra })}` : ''}
      </>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
      <SourceIcon source={connector.provider} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-white/75">{connector.label}</div>
        {/* The resource list truncates; the sync time never does — a clipped
            "Synced 1h …" reads as broken rather than compact. */}
        <div className="flex items-baseline gap-1.5 text-[10px] text-white/30">
          <span className="min-w-0 flex-1 truncate">{detail}</span>
          {synced && (
            <span className="shrink-0 whitespace-nowrap">
              {t('projectToolsSyncedLabel')} {synced}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Page
   ══════════════════════════════════════════════════════════════════════════ */
type LoadState =
  | { state: 'loading' }
  /** The server answered 404 — not this account's project (existence-hidden). */
  | { state: 'missing' }
  /** Transport / server failure — worth retrying. */
  | { state: 'error' }
  | { state: 'ready'; workspace: ProjectWorkspace };

function toLoadState(res: { workspace: ProjectWorkspace | null; notFound: boolean }): LoadState {
  if (res.workspace) return { state: 'ready', workspace: res.workspace };
  return res.notFound ? { state: 'missing' } : { state: 'error' };
}
/* ══════════════════════════════════════════════════════════════════════════
   Views

   Four views over ONE page, selected by `?view=` so a view is linkable and
   Back works. Overview and Activity render entirely from the mount snapshot;
   Tasks and Knowledge fetch their full list on first open — a request the user
   asked for by opening that view, never mount fan-out.
   ══════════════════════════════════════════════════════════════════════════ */
const VIEWS = ['overview', 'tasks', 'knowledge', 'activity'] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABEL: Record<View, string> = {
  overview: 'projectTabOverview',
  tasks: 'projectTabTasks',
  knowledge: 'projectTabKnowledge',
  activity: 'projectTabActivity',
};

const VIEW_ICON: Record<View, typeof Blocks> = {
  overview: Sparkles,
  tasks: ListTodo,
  knowledge: BookMarked,
  activity: Activity,
};

function toView(raw: string | null): View {
  return (VIEWS as readonly string[]).includes(raw || '') ? (raw as View) : 'overview';
}

/** The "project not available" answer. Deliberately IDENTICAL for a project
 *  that is someone else's and one that does not exist — the page must never
 *  reveal which, because the server does not either. */
function ProjectUnavailable({ t }: { t: T }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 px-6 text-center"
      style={{ background: '#07090D', color: '#F8FAFC' }}>
      <p className="text-[13px] text-white/60">{t('projectNotFound')}</p>
      <button onClick={() => navigate('/projects')} className="text-[12px] text-[#60A5FA] hover:underline">
        ← {t('projectBack')}
      </button>
    </div>
  );
}

/**
 * The page, mounted under a `key={projectId}`.
 *
 * That key is load-bearing, not decoration: switching project must reset EVERY
 * per-project piece of local state — the pinned arrival snapshot, the loaded
 * task and knowledge lists, the open composer, the visit acknowledgement. A
 * remount does that by construction, which is both safer and simpler than an
 * effect that has to remember to clear each one (and forgetting a single line
 * there would leak one project's tasks into another's screen for a frame).
 */
function ProjectWorkspaceView({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguageStore();
  // The locally-cached project record is used ONLY to render a name while the
  // authoritative workspace loads; the workspace's own project block replaces
  // it the moment it arrives, and it is never used to decide what the user may
  // see. Read once per project id rather than on every render.
  const localProject = useMemo(() => getProject(projectId || ''), [projectId]);

  const [load, setLoad] = useState<LoadState>({ state: 'loading' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const timeAgo = useTimeAgo(t);
  const view = toView(searchParams.get('view'));

  /* The ARRIVAL snapshot's change list, pinned for the lifetime of the mount.
     "Since your last visit" describes the moment you arrived; if it re-derived
     on every refresh, adding a task would empty the list the user is reading. */
  const [arrival, setArrival] = useState<WorkspaceChanges | null>(null);
  /* One acknowledgement per mount (and the mount is per project — see the
     component docstring). Held in a ref, not state, so it can never schedule a
     re-render or fire twice under React's development double-invoke. */
  const acknowledged = useRef(false);

  /* Full lists for the Tasks / Knowledge views — loaded on first open only. */
  const [tasks, setTasks] = useState<ProjectTask[] | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftTask, setDraftTask] = useState('');
  const [draftKind, setDraftKind] = useState<KnowledgeKind>('decision');
  const [draftKnowledge, setDraftKnowledge] = useState('');
  const [writeError, setWriteError] = useState<string>('');

  /**
   * The ONE place a workspace response becomes page state.
   *
   * Both the mount read and every later refresh go through it, so the arrival
   * snapshot and the visit acknowledgement behave identically whether the first
   * successful read was the mount or a retry after a transport failure. Pinning
   * `arrival` with a functional update means a refresh triggered by a task write
   * cannot empty the change list the user is still reading.
   */
  const applySnapshot = useCallback((res: { workspace: ProjectWorkspace | null; notFound: boolean }) => {
    setLoad(toLoadState(res));
    const ws = res.workspace;
    if (!ws) return;
    setArrival((prev) => prev ?? ws.changes);
    // Acknowledge the visit only once, and stamp the marker with the snapshot's
    // OWN instant — so a change that landed while the read was in flight is
    // still new next time instead of being silently swallowed. Best-effort: a
    // failure costs one visit's precision and nothing else.
    const stamp = seenThrough(ws);
    if (stamp && !acknowledged.current) {
      acknowledged.current = true;
      void markProjectWorkspaceSeen(projectId, stamp);
    }
  }, [projectId]);

  const refresh = useCallback(async (): Promise<void> => {
    applySnapshot(await getProjectWorkspace(projectId));
  }, [projectId, applySnapshot]);

  // ONE bounded read on mount (and on project switch). No polling, no provider
  // fan-out, no model call. Switching project resets every per-project piece of
  // local view state so nothing from the previous project can bleed through.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getProjectWorkspace(projectId);
      if (!cancelled) applySnapshot(res);
    })();
    return () => { cancelled = true; };
  }, [projectId, applySnapshot]);

  const workspace = load.state === 'ready' ? load.workspace : null;

  const setView = useCallback((next: View) => {
    setSearchParams(next === 'overview' ? {} : { view: next }, { replace: false });
  }, [setSearchParams]);

  /* Full task list — fetched the first time the Tasks view is opened. */
  useEffect(() => {
    if (view !== 'tasks' || tasks !== null) return;
    let cancelled = false;
    void (async () => {
      const res = await listProjectTasks(projectId);
      if (!cancelled) setTasks(res.tasks);
    })();
    return () => { cancelled = true; };
  }, [view, projectId, tasks]);

  /* Full knowledge list — same rule. */
  useEffect(() => {
    if (view !== 'knowledge' || knowledge !== null) return;
    let cancelled = false;
    void (async () => {
      const res = await listProjectKnowledge(projectId);
      if (!cancelled) setKnowledge(res.items);
    })();
    return () => { cancelled = true; };
  }, [view, projectId, knowledge]);

  const suggestions = useMemo(() => askSuggestions(workspace), [workspace]);
  /** Server truth for which chats are already filed here — handed to the "Add
   *  existing" picker so it never offers to add a chat this project already has
   *  (the local project cache can be empty on a fresh device). */
  const currentThreadIds = useMemo(
    () => (workspace?.chats || []).map((c) => c.thread_id),
    [workspace],
  );
  /** The header's Ask Korvix seed — the highest-priority honest suggestion, or
   *  nothing at all before the workspace read lands. */
  const headlineAsk = suggestions.length > 0 ? t(suggestions[0].promptKey) : undefined;

  const name = workspace?.project.name || localProject?.name || '';
  const description = workspace?.project.description || localProject?.description || '';
  const freshness = useMemo(() => {
    const rel = freshnessRelative(workspace?.freshness);
    if (!rel) return '';
    return rel.unit === 'now' ? t(freshnessKey(rel)) : t(freshnessKey(rel), { value: rel.value });
  }, [workspace, t]);

  const openChat = useCallback((threadId: string) => {
    navigate(openProjectChatUrl(threadId));
  }, [navigate]);
  const newProjectChat = useCallback((prefill?: string) => {
    navigate(newProjectChatUrl(projectId, prefill));
  }, [navigate, projectId]);
  // A product opens in the conversation it was generated in — the existing chat
  // surface already restores the embedded build there. This page never renders
  // or re-runs a build itself.
  const openProduct = useCallback((product: WorkspaceProduct) => {
    const target = productOpenTarget(product);
    if (target) navigate(target);
  }, [navigate]);

  /* ── Task writes ────────────────────────────────────────────────────────
     Every one is server-authoritative: the mutation returns the stored row and
     we re-read rather than patching a local copy, so the browser can never
     become a second source of truth. None of them starts a run. */
  const reloadTasks = useCallback(async () => {
    // The snapshot refresh is always needed (it carries the Overview's bounded
    // slice and the authoritative counts). The FULL list is re-read only when
    // the Tasks view has already loaded it — writing from the Overview must not
    // fetch a list nothing is rendering.
    if (tasks !== null) {
      const res = await listProjectTasks(projectId);
      setTasks(res.tasks);
    }
    await refresh();
  }, [projectId, refresh, tasks]);

  const addTask = useCallback(async (title: string, source = 'user') => {
    const text = title.trim();
    if (!text) return;
    setBusy(true);
    setWriteError('');
    const res = await createProjectTask(projectId, { title: text, source });
    setBusy(false);
    if (!res.ok) { setWriteError(t('projectTaskError')); return; }
    setDraftTask('');
    setComposerOpen(false);
    await reloadTasks();
  }, [projectId, reloadTasks, t]);

  const moveTask = useCallback(async (task: ProjectTask, status: TaskStatus) => {
    setWriteError('');
    const res = await updateProjectTask(projectId, task.id, { status });
    if (!res.ok) { setWriteError(t('projectTaskError')); return; }
    await reloadTasks();
  }, [projectId, reloadTasks, t]);

  const toggleTask = useCallback((task: ProjectTask) => {
    void moveTask(task, toggledTaskStatus(task.status));
  }, [moveTask]);

  const removeTask = useCallback(async (task: ProjectTask) => {
    setWriteError('');
    const res = await deleteProjectTask(projectId, task.id);
    if (!res.ok) { setWriteError(t('projectTaskError')); return; }
    await reloadTasks();
  }, [projectId, reloadTasks, t]);

  /* ── Knowledge writes ─────────────────────────────────────────────────── */
  const reloadKnowledge = useCallback(async () => {
    if (knowledge !== null) {
      const res = await listProjectKnowledge(projectId);
      setKnowledge(res.items);
    }
    await refresh();
  }, [projectId, refresh, knowledge]);

  const addKnowledge = useCallback(async () => {
    const text = draftKnowledge.trim();
    if (!text) return;
    setBusy(true);
    setWriteError('');
    const res = await addProjectKnowledge(projectId, draftKind, text);
    setBusy(false);
    if (!res.ok) { setWriteError(t('projectKnowledgeError')); return; }
    setDraftKnowledge('');
    await reloadKnowledge();
  }, [projectId, draftKind, draftKnowledge, reloadKnowledge, t]);

  const removeKnowledge = useCallback(async (item: KnowledgeItem) => {
    setWriteError('');
    const res = await removeProjectKnowledge(projectId, item.id);
    if (!res.ok) { setWriteError(t('projectKnowledgeError')); return; }
    await reloadKnowledge();
  }, [projectId, reloadKnowledge, t]);

  /* Today's "Create task" — opens the composer prefilled with the signal's own
     words, on the Tasks view. It NEVER writes on its own: the user still has to
     press Add, which is the whole point of "a recommendation authorizes
     nothing". */
  const startTaskFromRecommendation = useCallback((prefill: string) => {
    setDraftTask(prefill);
    setComposerOpen(true);
    setView('tasks');
  }, [setView]);

  // The server says this project is not available to this account.
  if (load.state === 'missing') return <ProjectUnavailable t={t} />;

  const overviewTasks = workspace ? openTasks(workspace.tasks.items) : [];
  const openCount = workspace?.tasks.counts.open ?? 0;
  const knowledgeTotal = workspace?.knowledge.counts.total ?? 0;
  const listedTasks = tasks ?? [];
  const listedKnowledge = knowledge ?? [];

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden"
      style={{ background: 'radial-gradient(1200px 680px at 50% -14%, rgba(59,130,246,0.06), transparent 60%), #07090D', color: '#F8FAFC' }}>
      <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6 lg:px-8 py-5 sm:py-7">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-start gap-3">
          <button onClick={() => navigate('/projects')} aria-label={t('projectBack')}
            className="mt-0.5 h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-white/[0.07] text-white/50 hover:text-white/85 hover:bg-white/[0.05] transition-all">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] sm:text-[22px] font-semibold leading-tight break-words">
              {name || ' '}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-white/40">
              {description && <span className="min-w-0 truncate max-w-full sm:max-w-[520px]">{description}</span>}
              {description && freshness && <span className="text-white/20">·</span>}
              {freshness && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {freshness}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            {/* Ask Korvix ≠ New chat: it opens a project chat SEEDED with the
                most relevant of the honest suggestions below (attention first,
                then recent change, then goals, else "what is this about") —
                whereas New chat opens an empty one. Neither sends a turn. */}
            <button onClick={() => newProjectChat(headlineAsk)} className={PRIMARY_BTN}>
              <Sparkles className="h-3.5 w-3.5" /> {t('projectActionAsk')}
            </button>
            <button onClick={() => newProjectChat()} className={HEADER_BTN}>
              <Plus className="h-3.5 w-3.5" /> {t('projectActionNewChat')}
            </button>
            <button onClick={() => navigate('/settings/integrations')} className={HEADER_BTN}>
              <Plug className="h-3.5 w-3.5" /> {t('projectActionManageTools')}
            </button>
          </div>
        </header>

        {/* ── View switcher. Horizontally scrollable on narrow screens so four
               labels in a long-word locale never force the page to scroll. ── */}
        {workspace && (
          /* Wraps rather than scrolls: a horizontally-scrolling strip left the
             fourth tab visibly cut at 390 and 360, which reads as broken. Two
             short rows are honest; a sliced label is not. */
          <nav className="mt-5 flex flex-wrap items-center gap-1"
            aria-label={t('projectTabOverview')}>
            {VIEWS.map((v) => {
              const Icon = VIEW_ICON[v];
              const active = v === view;
              const badge = v === 'tasks' && openCount > 0 ? openCount
                : v === 'knowledge' && knowledgeTotal > 0 ? knowledgeTotal : 0;
              return (
                <button key={v} onClick={() => setView(v)} aria-current={active ? 'page' : undefined}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12px] transition-all border ${
                    active
                      ? 'text-white bg-white/[0.07] border-white/[0.12]'
                      : 'text-white/50 hover:text-white/85 bg-transparent border-transparent hover:bg-white/[0.04]'
                  }`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {t(VIEW_LABEL[v])}
                  {badge > 0 && (
                    <span className="shrink-0 rounded-full bg-white/[0.08] px-1.5 text-[10px] text-white/55">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        {load.state === 'loading' && (
          <div className="flex items-center gap-2 text-[12px] text-white/40 mt-8">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('projectWorkspaceLoading')}
          </div>
        )}

        {load.state === 'error' && (
          <div className={`${PANEL} mt-6 p-4 flex flex-wrap items-center justify-between gap-3`}>
            <span className="text-[12.5px] text-white/55">{t('projectWorkspaceError')}</span>
            <button onClick={() => { setLoad({ state: 'loading' }); void refresh(); }} className={HEADER_BTN}>
              <RefreshCw className="h-3.5 w-3.5" /> {t('projectWorkspaceRetry')}
            </button>
          </div>
        )}

        {writeError && (
          <p className="mt-4 text-[12px] text-[#FCA5A5]">{writeError}</p>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            OVERVIEW
            ══════════════════════════════════════════════════════════════════ */}
        {workspace && view === 'overview' && (
          /* DOM order IS the mobile priority order: today → changes → tasks →
             brief + ask → goals → activity → knowledge → products → chats →
             tools. On desktop the last four move into the right rail. */
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 lg:gap-6 items-start">
            <div className="min-w-0 space-y-4">

              {/* ── A. TODAY ───────────────────────────────────────────── */}
              <TodaySection
                attention={workspace.today.attention}
                recommendation={workspace.today.recommendation}
                changes={arrival}
                onAsk={(prompt) => newProjectChat(prompt)}
                onCreateTask={startTaskFromRecommendation}
                onOpenTasks={() => setView('tasks')}
                onOpenActivity={() => setView('activity')}
                t={t}
              />

              {/* ── B. NEEDS ATTENTION (the full ranked list) ───────────── */}
              {workspace.attention.length > 1 && (
                <section className={`${PANEL} p-4 sm:p-5`}>
                  <div className={`${SECTION_TITLE} mb-2`}>
                    <AlertTriangle className="h-3.5 w-3.5 text-[#F87171]" />
                    {/* The strongest signal is already the headline of Today —
                        this block is what ELSE is open, and says so. */}
                    {t('projectSectionAttentionMore')}
                  </div>
                  <ul className="divide-y divide-white/[0.05] -my-0.5">
                    {workspace.attention.slice(1).map((item) => (
                      <AttentionRow key={item.id} item={item} t={t} />
                    ))}
                  </ul>
                </section>
              )}

              {/* ── B.5 CURRENT STATE ──────────────────────────────────────
                  What the connected tools ADD UP TO, one level below "what is
                  on fire". Rendered only when there is a real reading — an
                  empty panel captioned with a state code is clutter. */}
              {hasUnderstanding(workspace) && (
                <CurrentStateSection
                  items={workspace.projectState}
                  understanding={workspace.understanding}
                  onAsk={(prompt) => newProjectChat(prompt)}
                  t={t}
                />
              )}

              {/* ── C. TASKS (compact) ─────────────────────────────────── */}
              <section className={`${PANEL} p-4 sm:p-5`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className={SECTION_TITLE}>
                    <ListTodo className="h-3.5 w-3.5 text-[#60A5FA]" />
                    {t('projectSectionTasks')}
                    {openCount > 0 && (
                      <span className="font-normal normal-case tracking-normal text-white/30">
                        · {t('projectTaskOpenCount', { count: openCount })}
                      </span>
                    )}
                  </div>
                  <button onClick={() => { setComposerOpen(true); setDraftTask(''); }}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[11px] text-white/45 hover:text-white hover:bg-white/[0.06] transition-all">
                    <Plus className="h-3 w-3" /> {t('projectTaskAdd')}
                  </button>
                </div>

                {composerOpen && (
                  <div className="mb-2">
                    <TaskComposer value={draftTask} onChange={setDraftTask}
                      onSubmit={() => { void addTask(draftTask); }}
                      onCancel={() => { setComposerOpen(false); setDraftTask(''); }}
                      busy={busy} t={t} />
                  </div>
                )}

                {overviewTasks.length === 0 ? (
                  <p className={EMPTY_TEXT}>
                    {openCount === 0 && workspace.tasks.counts.done
                      ? t('projectTaskAllDone')
                      : t('projectTasksEmptyHint')}
                  </p>
                ) : (
                  <>
                    <div className="-mx-1">
                      {overviewTasks.map((task) => (
                        <TaskRow key={task.id} task={task} onToggle={toggleTask}
                          onMove={moveTask} onDelete={removeTask} t={t} />
                      ))}
                    </div>
                    {(workspace.counts.tasks ?? 0) > overviewTasks.length && (
                      <button onClick={() => setView('tasks')}
                        className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-white/45 hover:text-white transition-colors">
                        {t('projectTasksViewAll')} <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}
              </section>

              {/* ── D. WHAT KORVIX KNOWS + ASK ─────────────────────────── */}
              <section className={`${PANEL} p-4 sm:p-5`}>
                <div className={`${SECTION_TITLE} mb-2`}>
                  <Sparkles className="h-3.5 w-3.5 text-[#C084FC]" />
                  {t('projectSectionBrief')}
                </div>
                {workspace.summary.text ? (
                  <p className="text-[13px] leading-relaxed text-white/65 break-words">
                    {workspace.summary.text}
                  </p>
                ) : (
                  <p className={EMPTY_TEXT}>{t('projectBriefEmpty')}</p>
                )}

                <div className="mt-4 pt-3.5 border-t border-white/[0.05]">
                  <div className="text-[11px] text-white/35 mb-2">{t('projectSectionAsk')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <button key={s.id} onClick={() => newProjectChat(t(s.promptKey))}
                        className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 h-7 text-[11.5px] text-white/60 hover:text-white hover:border-white/[0.16] hover:bg-white/[0.05] transition-all max-w-full">
                        <span className="truncate">{t(s.labelKey)}</span>
                        <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[10.5px] text-white/25">{t('projectAskHint')}</p>
                </div>
              </section>

              {/* ── E. CURRENT GOALS ───────────────────────────────────── */}
              <section className={`${PANEL} p-4 sm:p-5`}>
                <div className={`${SECTION_TITLE} mb-2`}>
                  <Target className="h-3.5 w-3.5 text-[#60A5FA]" />
                  {t('projectSectionGoals')}
                </div>
                {workspace.goals.length === 0 ? (
                  <p className={EMPTY_TEXT}>{t('projectGoalsEmpty')}</p>
                ) : (
                  <>
                    <ul className="space-y-1.5">
                      {workspace.goals.map((g, i) => (
                        <li key={g.id || `goal-${i}`} className="flex items-start gap-2 text-[12.5px] text-white/70">
                          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-white/25" />
                          <span className="min-w-0 break-words">{g.title}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2.5 text-[10.5px] text-white/25">{t('projectGoalsReadOnlyNote')}</p>
                  </>
                )}
              </section>
            </div>

            {/* ── Right rail. Sticky on desktop so a long left column never
                   leaves a dead column beside it; a plain stacked block below
                   `lg` (where DOM order is the mobile priority order). ─────── */}
            <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto scrollbar-thin">

              {/* ── F. KEY KNOWLEDGE ───────────────────────────────────── */}
              <section className={`${PANEL} p-4`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className={SECTION_TITLE}>
                    <BookMarked className="h-3.5 w-3.5 text-[#C4B5FD]" />
                    {t('projectSectionKnowledge')}
                  </div>
                  <button onClick={() => setView('knowledge')}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[11px] text-white/45 hover:text-white hover:bg-white/[0.06] transition-all">
                    <Plus className="h-3 w-3" /> {t('projectKnowledgeAdd')}
                  </button>
                </div>
                {workspace.knowledge.items.length === 0 ? (
                  <p className={EMPTY_TEXT}>{t('projectKnowledgeEmpty')}</p>
                ) : (
                  <>
                    <div className="-mx-1">
                      {workspace.knowledge.items.map((item) => (
                        <KnowledgeRow key={item.id} item={item} onRemove={null} t={t} />
                      ))}
                    </div>
                    {knowledgeTotal > workspace.knowledge.items.length && (
                      <button onClick={() => setView('knowledge')}
                        className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-white/45 hover:text-white transition-colors">
                        {t('projectKnowledgeViewAll')} <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}
              </section>

              {/* ── G. PRODUCTS & BUILDS ───────────────────────────────── */}
              <section className={`${PANEL} p-4`}>
                <div className={`${SECTION_TITLE} mb-2`}>
                  <Blocks className="h-3.5 w-3.5 text-[#34D399]" />
                  {t('projectSectionProducts')}
                </div>
                {workspace.products.length === 0 ? (
                  <p className={EMPTY_TEXT}>{t('projectProductsEmpty')}</p>
                ) : (
                  <div className="-mx-1">
                    {workspace.products.map((p, i) => (
                      <ProductRow key={p.deliverable_id || `${p.run_id}-${i}`}
                        product={p} onOpen={openProduct} t={t} />
                    ))}
                  </div>
                )}
              </section>

              {/* ── H. CHATS ───────────────────────────────────────────── */}
              <section className={`${PANEL} p-4`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className={SECTION_TITLE}>
                    <MessageSquare className="h-3.5 w-3.5 text-[#60A5FA]" />
                    {t('projectSectionChats')}
                  </div>
                  <button onClick={() => setPickerOpen(true)}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[11px] text-white/45 hover:text-white hover:bg-white/[0.06] transition-all">
                    <FolderInput className="h-3 w-3" /> {t('projectActionAddExisting')}
                  </button>
                </div>
                {workspace.chats.length === 0 ? (
                  <p className={EMPTY_TEXT}>{t('projectChatsEmpty')}</p>
                ) : (
                  <div className="-mx-1">
                    {workspace.chats.map((c) => (
                      <ProjectChatRow key={c.thread_id} chat={c} onOpen={openChat}
                        onRemoved={() => { void refresh(); }} t={t} />
                    ))}
                  </div>
                )}
              </section>

              {/* ── I. CONNECTED TOOLS ─────────────────────────────────── */}
              <section className={`${PANEL} p-4`}>
                <div className={`${SECTION_TITLE} mb-2`}>
                  <Plug className="h-3.5 w-3.5 text-white/40" />
                  {t('projectSectionTools')}
                </div>
                {workspace.connectors.length === 0 ? (
                  <p className={EMPTY_TEXT}>{t('projectToolsEmpty')}</p>
                ) : (
                  <div className="-mx-1">
                    {workspace.connectors.map((c) => (
                      <ConnectorRow key={c.provider} connector={c} t={t} />
                    ))}
                  </div>
                )}
                {/* The CTA sits under the list, not beside the heading — a long
                    label there wrapped the section title onto two lines. */}
                <button onClick={() => navigate('/settings/integrations')}
                  className="mt-2.5 pt-2.5 w-full border-t border-white/[0.05] inline-flex items-center gap-1 text-[11.5px] text-white/45 hover:text-white transition-colors">
                  {t('projectActionManageTools')} <ArrowUpRight className="h-3 w-3" />
                </button>
              </section>
            </aside>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TASKS — the full lightweight list, grouped by state.
            ══════════════════════════════════════════════════════════════════ */}
        {workspace && view === 'tasks' && (
          <div className="mt-5 max-w-[960px] space-y-4">
            <section className={`${PANEL} p-4 sm:p-5`}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className={SECTION_TITLE}>
                  <ListTodo className="h-3.5 w-3.5 text-[#60A5FA]" />
                  {t('projectSectionTasks')}
                </div>
                {!composerOpen && (
                  <button onClick={() => setComposerOpen(true)} className={HEADER_BTN}>
                    <Plus className="h-3.5 w-3.5" /> {t('projectTaskAdd')}
                  </button>
                )}
              </div>

              {composerOpen && (
                <div className="mb-3">
                  <TaskComposer value={draftTask} onChange={setDraftTask}
                    onSubmit={() => { void addTask(draftTask); }}
                    onCancel={() => { setComposerOpen(false); setDraftTask(''); }}
                    busy={busy} t={t} />
                </div>
              )}

              {tasks === null ? (
                <div className="flex items-center gap-2 text-[12px] text-white/40">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('projectWorkspaceLoading')}
                </div>
              ) : listedTasks.length === 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[12.5px] text-white/45">{t('projectTasksEmpty')}</p>
                  <p className={EMPTY_TEXT}>{t('projectTasksEmptyHint')}</p>
                </div>
              ) : (
                /* Two columns of GROUPS on a wide screen — the four states side
                   by side use the width a single 760px column wasted. It is a
                   layout, not a board: no drag, no drop, no columns to manage. */
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4 items-start">
                  {TASK_STATUS_ORDER.map((status) => {
                    const group = listedTasks.filter((task) => task.status === status);
                    if (group.length === 0) return null;
                    return (
                      <div key={status} className="min-w-0">
                        <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
                          {t(taskStatusKey(status))} · {group.length}
                        </div>
                        <div className="-mx-1">
                          {group.map((task) => (
                            <TaskRow key={task.id} task={task} onToggle={toggleTask}
                              onMove={moveTask} onDelete={removeTask}
                              showStatus={false} t={t} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            KNOWLEDGE — durable decisions, requirements, constraints, facts.
            ══════════════════════════════════════════════════════════════════ */}
        {workspace && view === 'knowledge' && (
          <div className="mt-5 max-w-[960px] space-y-4">
            <section className={`${PANEL} p-4 sm:p-5`}>
              <div className={`${SECTION_TITLE} mb-3`}>
                <BookMarked className="h-3.5 w-3.5 text-[#C4B5FD]" />
                {t('projectKnowledgeAdd')}
              </div>
              {/* Kind first, then the statement — the kind decides which
                  authority the backend routes it to, so it is never guessed
                  from the words. */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {KNOWLEDGE_KIND_ORDER.map((kind) => (
                  <button key={kind} onClick={() => setDraftKind(kind)}
                    aria-pressed={draftKind === kind}
                    className={`rounded-full px-3 h-7 text-[11.5px] border transition-all ${
                      draftKind === kind
                        ? 'text-white bg-white/[0.08] border-white/[0.16]'
                        : 'text-white/50 bg-white/[0.02] border-white/[0.07] hover:text-white/80'
                    }`}>
                    {t(knowledgeKindKey(kind))}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5">
                <input value={draftKnowledge}
                  onChange={(e) => setDraftKnowledge(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addKnowledge(); }}
                  placeholder={t('projectKnowledgeAddPlaceholder')}
                  className="flex-1 min-w-[160px] bg-transparent text-[12.5px] text-white/85 placeholder:text-white/25 outline-none" />
                <button onClick={() => { void addKnowledge(); }}
                  disabled={busy || !draftKnowledge.trim()}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[#3B82F6]/30 bg-[#3B82F6]/[0.12] px-2.5 h-7 text-[11px] font-medium text-[#93C5FD] hover:bg-[#3B82F6]/[0.2] transition-all disabled:opacity-40">
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {t('projectKnowledgeSave')}
                </button>
              </div>
              <p className="mt-2 text-[10.5px] text-white/25">{t('projectKnowledgeEmptyHint')}</p>
            </section>

            <section className={`${PANEL} p-4 sm:p-5`}>
              <div className={`${SECTION_TITLE} mb-2`}>
                <BookMarked className="h-3.5 w-3.5 text-white/40" />
                {t('projectTabKnowledge')}
                {knowledgeTotal > 0 && (
                  <span className="font-normal normal-case tracking-normal text-white/30">
                    · {t('projectKnowledgeCount', { count: knowledgeTotal })}
                  </span>
                )}
              </div>
              {knowledge === null ? (
                <div className="flex items-center gap-2 text-[12px] text-white/40">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('projectWorkspaceLoading')}
                </div>
              ) : listedKnowledge.length === 0 ? (
                <p className={EMPTY_TEXT}>{t('projectKnowledgeEmpty')}</p>
              ) : (
                <div className="-mx-1">
                  {listedKnowledge.map((item) => (
                    <KnowledgeRow key={item.id} item={item} alignLabels
                      onRemove={(k) => { void removeKnowledge(k); }} t={t} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            ACTIVITY — what changed on arrival, then the project's timeline.
            Both come from the mount snapshot; this view costs no request.
            ══════════════════════════════════════════════════════════════════ */}
        {workspace && view === 'activity' && (
          <div className="mt-5 max-w-[960px] space-y-4">
            {/* Only when a real marker makes it a DIFFERENT list from the
                timeline below. Without one, "recent changes" and "recent
                activity" are the same answer twice. */}
            {arrival?.mode === 'since_last_visit' && (
              <ChangesList changes={arrival} t={t} />
            )}

            <section className={`${PANEL} p-4 sm:p-5`}>
              <div className={`${SECTION_TITLE} mb-2`}>
                <Activity className="h-3.5 w-3.5 text-white/40" />
                {t('projectSectionActivity')}
              </div>
              {workspace.activity.length === 0 ? (
                <p className={EMPTY_TEXT}>
                  {workspace.connectors.length === 0
                    ? t('projectActivityEmptyNoTools')
                    : t('projectActivityEmpty')}
                </p>
              ) : (
                <ul className="divide-y divide-white/[0.04] -my-1">
                  {workspace.activity.map((a, i) => (
                    <li key={`${a.source}-${a.id}-${i}`} className="flex items-start gap-2.5 py-2">
                      <SourceIcon source={a.source} className="mt-[3px] h-3.5 w-3.5 shrink-0 text-white/30" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] leading-snug text-white/70 break-words line-clamp-2">
                          {a.title || a.kind}
                        </div>
                        <div className="text-[10.5px] text-white/28">
                          <SourceName source={a.source} t={t} />
                          {a.occurred_at ? ` · ${timeAgo(a.occurred_at)}` : ''}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>

      {pickerOpen && (
        <AddExistingChatModal
          projectId={projectId}
          currentThreadIds={currentThreadIds}
          onClose={() => setPickerOpen(false)}
          onChanged={() => { void refresh(); }}
          t={t}
        />
      )}
    </div>
  );
}

/**
 * Route entry for `/projects/:projectId`.
 *
 * Thin on purpose: it resolves the id, answers the no-id case, and mounts the
 * page under `key={projectId}` so a project switch is a remount rather than a
 * hand-written state reset.
 */
export default function ProjectOverview() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useLanguageStore();
  if (!projectId) return <ProjectUnavailable t={t} />;
  return <ProjectWorkspaceView key={projectId} projectId={projectId} />;
}
