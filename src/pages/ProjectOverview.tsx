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
  Loader2, Check, X, Search, AlertTriangle,
  MoreHorizontal, FolderMinus, Activity, Clock, Plug, RefreshCw,
  ChevronRight, CheckCircle2, Circle, CircleDot, CirclePause, ArrowUpRight,
  BookMarked, ListTodo,
  Trash2, History, SlidersHorizontal, Star, EyeOff, RotateCcw,
} from 'lucide-react';
import { getProject } from '@/stores/projectStore';
import { useLanguageStore } from '@/stores/languageStore';
import {
  listAddableChats, bindThreadToProject, removeThreadFromProject,
  getProjectWorkspace, listProjectTasks, createProjectTask, updateProjectTask,
  deleteProjectTask, listProjectKnowledge, addProjectKnowledge,
  removeProjectKnowledge, markProjectWorkspaceSeen,
  getProjectFeedPreferences, setProjectFeedPreferences, type AddableChat,
} from '@/lib/projectApi';
import { askInWorkspace, type AskErrorCode, type AskHandle } from '@/lib/inlineAsk';
import MarkdownMessage from '@/components/MarkdownMessage';
import {
  askSuggestions, attentionReasonKey, changeKindKey, changeStories,
  connectorSummary, coverageCaveatKey,
  focusBasisKey, focusCaveatKey, focusOwnerKey, focusReasonKeys, focusTone,
  freshnessKey, freshnessRelative, hasFocus, hasProjectMemory,
  hasUnderstanding, hasVisitChanges, knowledgeGapKeys, knowledgeGroups,
  knowledgeKindKey, newProjectChatUrl, openProjectChatUrl,
  openTasks, productBuildType, productOpenTarget, productStatusKey,
  providerText, recommendationActionKey, recommendationAskKey,
  recommendationReasonKey, refreshPending, renderableActions,
  customizableSources, feedPreferenceKey, feedPreferenceOf,
  seenThrough, severityTone, taskStatusKey, toggledTaskStatus, workspaceFocus,
  FEED_PREFERENCES, KNOWLEDGE_KIND_ORDER, TASK_STATUS_ORDER,
  type AttentionItem, type FeedPreference, type FeedPreferences,
  type KnowledgeItem, type KnowledgeKind,
  type FocusItem, type ProjectStateItem, type ProjectTask,
  type ProjectUnderstanding,
  type ProjectWorkspace, type TaskStatus,
  type TodayRecommendation, type WorkspaceChanges, type WorkspaceChat,
  type WorkspaceConnector, type WorkspaceFocus, type WorkspaceProduct,
} from '@/lib/projectWorkspace';
import {
  EvidenceDisclosure, MoreLink, OutcomeStrip, ProviderText, SourceIcon,
  SourceName, StateChip, StoryRow,
} from '@/components/project/WorkspaceSurface';
import {
  EMPTY_TEXT, HEADER_BTN, PANEL, PRIMARY_BTN, RULE, SECTION_TITLE, SMALL_BTN,
  TONE_STYLE, useTimeAgo, type T,
} from '@/components/project/workspaceTokens';

/** How many times ONE visit may re-read to pick up a background refresh. Three
 *  is enough for a bounded provider read to land and small enough that a
 *  connector stuck "in flight" can never become a request loop. */
const MAX_REFRESH_RECHECKS = 3;
/** A shared empty map, so "no preferences" is one stable reference rather than
 *  a new object per render. */
const EMPTY_PREFS: FeedPreferences = {};
/** How many of the newest events the OVERVIEW shows. The Project page is not a
 *  log viewer: the full chronology lives one tab away, and three rows is enough
 *  to say "the tools are alive and this is the shape of it". */
const HOME_ACTIVITY = 3;
/** Correlated stories the "while you were away" block renders before it starts
 *  counting the rest. */
const HOME_CHANGES = 4;

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
   NOW — the one thing that matters, and why

   THE HIGHEST INFORMATION WEIGHT ON THE PAGE, and the only block that still
   gets panel chrome. Everything below it is headings, rows and rules, because
   nine equally-boxed sections is how a product with real intelligence ends up
   reading like a dashboard generator.

   WHAT DECIDES WHAT GOES HERE. Nothing on this page. `focus.top` is the
   Business Brain's decision reading — the identical function, with the
   identical tier ladder, that orders the Brain's candidate actions — and
   `today.attention` is `attention.py`'s top-ranked open signal. This component
   renders whichever of those the backend produced and JOINS the focus subject
   to its correlated story by id. It cannot promote, demote, re-rank or score:
   it is handed one item and a story to go with it.

   WHEN THERE IS NOTHING. One quiet line. A large empty card captioned
   "everything looks great" is a claim, and it is one nothing here can support.
   ══════════════════════════════════════════════════════════════════════════ */
function AttentionRow({ item, t }: { item: AttentionItem; t: T }) {
  const tone = TONE_STYLE[severityTone(item.severity)];
  const timeAgo = useTimeAgo(t);
  const when = timeAgo(item.observed_at);
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone.dot }} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-snug text-white/85 break-words">
          {t(attentionReasonKey(item.reason))}
        </div>
        <ProviderText value={item.title} className="mt-0.5 block text-[12px] leading-snug text-white/50 break-words" />
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-white/30">
          <span className="inline-flex items-center gap-1">
            <SourceIcon source={item.source} className="h-3 w-3 shrink-0 text-white/30" />
            <SourceName source={item.source} t={t} />
          </span>
          {item.context && <span className="truncate max-w-[220px]">· {providerText(item.context, 60)}</span>}
          {when && <span>· {when}</span>}
        </div>
      </div>
    </li>
  );
}

/**
 * The Focus headline: the decision layer's reason, or — when the backend
 * produced no focus item — the alarm itself.
 *
 * Both are backend codes. There is no third case where the page composes a
 * sentence of its own.
 */
function FocusHeadline({ focus, t }: { focus: WorkspaceFocus; t: T }) {
  const basisKey = focus.item ? focusBasisKey(focus.item.priority_basis) : null;
  if (basisKey) {
    const tone = TONE_STYLE[focusTone(focus.item!.priority_basis)];
    return (
      <div className="flex items-start gap-2.5">
        <span className="mt-[9px] h-2 w-2 shrink-0 rounded-full" style={{ background: tone.dot }} />
        <div className="min-w-0">
          <h2 className="text-[16px] sm:text-[17px] font-semibold leading-snug break-words"
            style={{ color: tone.text }}>
            {t(basisKey)}
          </h2>
          {focus.item!.subject && (
            <div className="mt-0.5 text-[13px] leading-snug text-white/70 break-words">
              {providerText(focus.item!.subject, 160)}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (!focus.attention) return null;
  const tone = TONE_STYLE[severityTone(focus.attention.severity)];
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-[9px] h-2 w-2 shrink-0 rounded-full" style={{ background: tone.dot }} />
      <div className="min-w-0">
        <h2 className="text-[16px] sm:text-[17px] font-semibold leading-snug break-words"
          style={{ color: tone.text }}>
          {t(attentionReasonKey(focus.attention.reason))}
        </h2>
        <ProviderText value={focus.attention.title}
          className="mt-0.5 block text-[13px] leading-snug text-white/70 break-words" />
      </div>
    </div>
  );
}

function FocusSection({
  focus, recommendation, attentionRest, nextItems, onAsk, onCreateTask,
  onOpenTasks, t,
}: {
  focus: WorkspaceFocus;
  recommendation: TodayRecommendation | null;
  attentionRest: AttentionItem[];
  nextItems: FocusItem[];
  onAsk: (prompt: string) => void;
  onCreateTask: (prefill: string) => void;
  onOpenTasks: () => void;
  t: T;
}) {
  const [alsoOpen, setAlsoOpen] = useState(false);
  const timeAgo = useTimeAgo(t);
  const item = focus.item;
  const reasons = focusReasonKeys(item);
  const ownerKey = focusOwnerKey(item);
  const caveatKey = item?.caveats.length ? focusCaveatKey(item.caveats[0]) : null;
  const providers = item?.actionability.external_providers.join(', ') || '';
  const next = (nextItems || [])
    .map((row) => providerText(row.subject, 80)).filter(Boolean);
  const actions = renderableActions(recommendation);
  const askKey = recommendationAskKey(recommendation);
  const alarm = focus.attention;
  const tone = item
    ? TONE_STYLE[focusTone(item.priority_basis)]
    : alarm ? TONE_STYLE[severityTone(alarm.severity)] : TONE_STYLE.info;

  const run = (action: string) => {
    if (action === 'ask_korvix') onAsk(askKey ? t(askKey) : '');
    else if (action === 'create_task') onCreateTask(recommendation?.title || '');
    else if (action === 'open_tasks') onOpenTasks();
  };

  if (!hasFocus(focus)) {
    // The quiet state. One line, no container — a project with nothing pressing
    // should LOOK like a project with nothing pressing.
    return (
      <section className="pb-1">
        <p className={EMPTY_TEXT}>{t('projectFocusQuiet')}</p>
        {recommendation && (
          <div className="mt-3">
            <div className="text-[13.5px] font-medium leading-snug text-white/85 break-words">
              {t(recommendationReasonKey(recommendation.reason))}
            </div>
            <ProviderText value={recommendation.title}
              className="mt-0.5 block text-[12px] leading-snug text-white/50 break-words" />
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
      </section>
    );
  }

  return (
    <section className={`${PANEL} p-4 sm:p-5`}
      style={{ borderColor: `${tone.dot}26`, background: `${tone.dot}0A` }}>
      <FocusHeadline focus={focus} t={t} />

      {/* The correlated evidence, as ONE line. This is the difference between
          "a Vercel card and a GitHub card" and "a story". */}
      {focus.story && <OutcomeStrip item={focus.story} t={t} />}

      {reasons.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {reasons.map((key) => (
            <li key={key} className="text-[12.5px] leading-snug text-white/65 break-words">
              {t(key)}
            </li>
          ))}
        </ul>
      )}

      {/* WHICH commitment — only when one is actually driving the tier. The
          date is printed as the backend's own YYYY-MM-DD, so no locale-
          dependent parsing happens on the page. */}
      {focus.commitment && item?.deadline_pressure !== 'none' && (
        <div className="mt-2 text-[12px] leading-snug text-white/50 break-words">
          {t('projectFocusCommitment', {
            title: providerText(focus.commitment.title, 80),
            when: focus.commitment.at.slice(0, 10),
          })}
        </div>
      )}

      {/* WHO HAS TO ACT. The line this block exists for: an alarm that implies
          Korvix will redeploy production is worse than no alarm. */}
      {ownerKey && (
        <div className="mt-2 text-[12.5px] leading-snug text-white/80 break-words">
          {t(ownerKey, { providers })}
        </div>
      )}
      {caveatKey && (
        <div className="mt-1.5 text-[11.5px] leading-snug text-white/40 break-words">
          {t(caveatKey)}
        </div>
      )}

      {/* The alarm's own provenance, when the focus subject is not the alarm's
          own words — small, because the story above is the headline. */}
      {alarm && item && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[10.5px] text-white/30">
          <span className="inline-flex items-center gap-1">
            <SourceIcon source={alarm.source} className="h-3 w-3 shrink-0 text-white/30" />
            <SourceName source={alarm.source} t={t} />
          </span>
          {alarm.context && <span className="truncate max-w-[220px]">· {providerText(alarm.context, 60)}</span>}
          {timeAgo(alarm.observed_at) && <span>· {timeAgo(alarm.observed_at)}</span>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => onAsk(
          item?.subject
            ? t('projectStateAskPrompt', { subject: item.subject })
            : (askKey ? t(askKey) : ''))}
          className={PRIMARY_BTN}>
          <Sparkles className="h-3.5 w-3.5" /> {t('projectActionAsk')}
        </button>
        {recommendation && actions.includes('create_task') && (
          <button onClick={() => run('create_task')} className={HEADER_BTN}>
            {t('projectTodayActionCreateTask')}
          </button>
        )}
        {/* INSPECT — the evidence, in place. Low chrome on purpose: the count
            IS the affordance, and it is also the most useful single fact about
            how well-supported the headline is. */}
        {focus.story && (
          <span className="ml-auto">
            <EvidenceDisclosure item={focus.story} onAsk={onAsk} t={t} />
          </span>
        )}
      </div>

      {/* Korvix's next best action, when it is not simply the alarm restated. */}
      {recommendation && !actions.includes('create_task') && (
        <div className={`mt-3 pt-3 ${RULE}`}>
          <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
            {t('projectTodayRecommendLabel')}
          </div>
          <div className="text-[13px] font-medium leading-snug text-white/85 break-words">
            {t(recommendationReasonKey(recommendation.reason))}
          </div>
          {actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {actions.map((action) => {
                const key = recommendationActionKey(action);
                if (!key) return null;
                return (
                  <button key={action} onClick={() => run(action)} className={SMALL_BTN}>
                    {t(key)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* WHAT ELSE IS OPEN — a disclosure, not a second alarm panel. The
          strongest signal is the headline above; this is the tail, and a tail
          rendered as loudly as the head is how a page stops having a head. */}
      {attentionRest.length > 0 && (
        <div className={`mt-3 pt-3 ${RULE}`}>
          <button type="button" onClick={() => setAlsoOpen((v) => !v)}
            aria-expanded={alsoOpen}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-white/45 hover:text-white transition-colors">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {t('projectSectionAttentionMore')}
            <span className="rounded-full bg-white/[0.08] px-1.5 text-[10px] text-white/55">
              {attentionRest.length}
            </span>
            <ChevronRight className={`h-3 w-3 transition-transform ${alsoOpen ? 'rotate-90' : ''}`} />
          </button>
          {alsoOpen && (
            <ul className="mt-1 divide-y divide-white/[0.05]">
              {attentionRest.map((row) => (
                <AttentionRow key={row.id} item={row} t={t} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The rest of the ranked tail, BY NAME. The backend's order, no score
          and no tier number — a person reading "then: the checkout webhook"
          learns something; a person reading "tier 4" learns that a machine has
          opinions. */}
      {next.length > 0 && (
        <div className={`mt-3 pt-3 ${RULE} text-[11.5px] text-white/40 break-words`}>
          {t('projectFocusNextLabel')}: {next.join(' · ')}
        </div>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CHANGE — "what happened while I was away"

   Rendered ONLY when a real per-user marker exists and something landed after
   it. Without a marker this section is absent, which is also the truth: you
   have not been away. "Recent changes" is what the Activity surface already
   is, and printing it here too would be a second block saying the same thing
   with a deduplicated count that disagrees with the timeline's row count.

   Each row is a CORRELATED STORY where the backend resolved one, so four
   provider events about one subject are one line with one evidence disclosure
   — never four cards a reader has to join up themselves.
   ══════════════════════════════════════════════════════════════════════════ */
function ChangesSection({ workspace, changes, onAsk, onOpenActivity, t }: {
  workspace: ProjectWorkspace;
  changes: WorkspaceChanges;
  onAsk: (prompt: string) => void;
  onOpenActivity: () => void;
  t: T;
}) {
  const timeAgo = useTimeAgo(t);
  const stories = changeStories(workspace, changes, HOME_CHANGES);
  const count = changes.count;
  const hidden = Math.max(0, count - stories.length);

  return (
    <section>
      <h2 className="text-[14.5px] font-semibold leading-snug text-white/85 break-words">
        {t(count === 1
          ? 'projectChangesSinceHeadlineOne'
          : 'projectChangesSinceHeadlineMany', { count })}
      </h2>
      <ul className="mt-1 divide-y divide-white/[0.05]">
        {stories.map(({ change, story }) => (
          story
            ? (
              <StoryRow key={change.key} item={story} when={change.occurred_at}
                onAsk={onAsk} t={t} />
            )
            : (
              <li key={change.key} className="flex items-start gap-2.5 py-2.5">
                <SourceIcon source={change.source} className="mt-[3px] h-3.5 w-3.5 shrink-0 text-white/30" />
                <div className="min-w-0 flex-1">
                  <ProviderText value={change.title || (changeKindKey(change.change) ? t(changeKindKey(change.change)!) : change.change)}
                    className="block text-[12.5px] leading-snug text-white/70 break-words" />
                  <div className="text-[10.5px] text-white/28">
                    <SourceName source={change.source} t={t} />
                    {change.occurred_at ? ` · ${timeAgo(change.occurred_at)}` : ''}
                  </div>
                </div>
              </li>
            )
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <MoreLink label={t('projectChangesViewAll')} onClick={onOpenActivity} />
        {hidden > 0 && (
          <span className="text-[10.5px] text-white/25">
            {t('projectChangesMore', { count: hidden })}
          </span>
        )}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CURRENT STATE — what the connected tools ADD UP TO

   The correlated subjects, in the backend's own presentation order, each as
   one story with its evidence one disclosure away. It is NOT a ranking: "what
   deserves your attention" is answered above by Focus, and this section has
   deliberately no action on a row beyond asking Korvix about it.
   ══════════════════════════════════════════════════════════════════════════ */
function CurrentStateSection({ items, understanding, focusSubjectId, onAsk, t }: {
  items: ProjectStateItem[];
  understanding: ProjectUnderstanding | null;
  focusSubjectId: string;
  onAsk: (prompt: string) => void;
  t: T;
}) {
  // AT MOST ONE caveat, and only a real one. A wall of hedges reads as noise
  // and gets skipped, which defeats the point of being honest.
  const caveat = coverageCaveatKey(understanding);
  const gaps = knowledgeGapKeys(understanding, 2)
    .filter((g) => g.code !== 'no_recent_evidence'
      && g.code !== 'single_source_project'
      && g.code !== 'no_deployment_evidence');
  // The focus story is the headline directly above. Repeating it verbatim here
  // is the "same card twice" problem this redesign exists to remove — so it is
  // dropped from the list, not from the page.
  const rows = items.filter((i) => i.id !== focusSubjectId);
  // Nothing left to say here — the focus story above already IS the state, and
  // there is no caveat or gap to carry. Render nothing rather than a heading
  // over an empty list.
  if (!rows.length && !caveat && !gaps.length && items.length > 0) return null;

  return (
    <section>
      <div className={`${SECTION_TITLE} mb-1.5`}>{t('projectSectionState')}</div>
      {caveat && (
        <div className="mb-1 text-[11.5px] leading-relaxed text-white/35">{t(caveat)}</div>
      )}
      {rows.length === 0 ? (
        items.length === 0 && <p className={EMPTY_TEXT}>{t('projectStateEmpty')}</p>
      ) : (
        <ul className="divide-y divide-white/[0.05] -my-1">
          {rows.map((item) => (
            <StoryRow key={item.id} item={item} onAsk={onAsk} t={t} />
          ))}
        </ul>
      )}
      {gaps.length > 0 && (
        <ul className="mt-2 space-y-1">
          {gaps.map((g) => (
            <li key={g.code} className="text-[11.5px] leading-snug text-white/35 break-words">
              {t(g.key)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   The full change list — the Activity surface's own "since your last visit".

   The TITLE is not cosmetic: only a payload carrying a real per-user marker is
   allowed to claim a visit, and `hasVisitChanges` enforces that. `count` comes
   from the backend and may exceed the rendered rows, so a bound is stated
   ("+N more") rather than quietly swallowing the rest.
   ══════════════════════════════════════════════════════════════════════════ */
function ChangesList({ workspace, changes, onAsk, t }: {
  workspace: ProjectWorkspace;
  changes: WorkspaceChanges | null;
  onAsk: (prompt: string) => void;
  t: T;
}) {
  const timeAgo = useTimeAgo(t);
  if (!changes) return null;
  const stories = changeStories(workspace, changes, changes.items.length || 1);
  const hidden = Math.max(0, changes.count - changes.items.length);
  return (
    <section className={`${PANEL} p-4 sm:p-5`}>
      <div className={`${SECTION_TITLE} mb-2`}>
        <History className="h-3.5 w-3.5 text-white/40" />
        {t('projectChangesSinceTitle')}
      </div>
      {changes.items.length === 0 ? (
        <p className={EMPTY_TEXT}>{t('projectChangesEmpty')}</p>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.04] -my-1">
            {stories.map(({ change, story }) => (
              story
                ? <StoryRow key={change.key} item={story} when={change.occurred_at}
                    onAsk={onAsk} t={t} />
                : (
                  <li key={change.key} className="flex items-start gap-2.5 py-2">
                    <SourceIcon source={change.source} className="mt-[3px] h-3.5 w-3.5 shrink-0 text-white/30" />
                    <div className="min-w-0 flex-1">
                      <ProviderText
                        value={change.title || (changeKindKey(change.change) ? t(changeKindKey(change.change)!) : change.change)}
                        className="block text-[12.5px] leading-snug text-white/70 break-words" />
                      <div className="text-[10.5px] text-white/28">
                        <SourceName source={change.source} t={t} />
                        {change.occurred_at ? ` · ${timeAgo(change.occurred_at)}` : ''}
                      </div>
                    </div>
                  </li>
                )
            ))}
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
    // Repository full names and channel names are written by whoever owns the
    // remote resource — provider text, normalized like any other.
    detail = (
      <>
        {summary.named.map((r) => providerText(r, 60)).filter(Boolean).join(', ')}
        {summary.extra > 0 ? ` ${t('projectToolsMore', { count: summary.extra })}` : ''}
      </>
    );
  }
  // The row's STATUS, as one scannable dot. It is the binding status the
  // connector authority already decided — this adds no state of its own and no
  // second connector settings surface: acting on it still means going to
  // /settings/integrations, which the section links to once, below the list.
  const dot = summary.kind === 'pending' ? TONE_STYLE.warning.dot
    : summary.kind === 'revoked' ? TONE_STYLE.critical.dot
      : TONE_STYLE.positive.dot;
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
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

/* ══════════════════════════════════════════════════════════════════════════
   INLINE "ASK KORVIX"

   The compact answer surface. It renders the question the user clicked and the
   answer streaming back — and that is ALL it is: a renderer over the state the
   `inlineAsk` client produces.

   It is deliberately not a chat application. There is no composer, no history
   list, no message actions, no scrollback. The exchange it shows IS a real turn
   of a real project-bound conversation (`inlineAsk` persists both halves
   through the sessions authority), so "Open in chat" hands the user the whole
   thing in the surface that is built for conversations.
   ══════════════════════════════════════════════════════════════════════════ */

type AskPhase =
  | { phase: 'streaming'; answer: string }
  | { phase: 'done'; answer: string }
  | { phase: 'error'; code: AskErrorCode };

interface InlineAsk {
  question: string;
  threadId: string | null;
  state: AskPhase;
}

function askErrorKey(code: AskErrorCode): string {
  switch (code) {
    case 'unavailable': return 'projectAskErrorUnavailable';
    case 'thread':      return 'projectAskErrorThread';
    case 'network':     return 'projectAskErrorNetwork';
    case 'empty':       return 'projectAskErrorEmpty';
    default:            return 'projectAskErrorStream';
  }
}

function InlineAnswer({ ask, surfaceRef, onRetry, onStop, onDismiss, onOpenChat, t }: {
  ask: InlineAsk;
  surfaceRef: React.Ref<HTMLDivElement>;
  onRetry: () => void;
  onStop: () => void;
  onDismiss: () => void;
  onOpenChat: (threadId: string) => void;
  t: T;
}) {
  const streaming = ask.state.phase === 'streaming';
  const answer = ask.state.phase === 'error' ? '' : ask.state.answer;
  return (
    <div ref={surfaceRef}
      className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 sm:p-3.5">
      {/* The question, echoed so the answer is never floating without its ask. */}
      <div className="flex items-start gap-2">
        <div className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#60A5FA]" />
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-white/80 break-words">
          {ask.question}
        </p>
        <button onClick={onDismiss} aria-label={t('projectAskDismiss')}
          className="shrink-0 -mt-0.5 h-6 w-6 flex items-center justify-center rounded-md text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-white/[0.05]">
        <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1.5">
          <Sparkles className="h-3 w-3 text-[#C084FC]" />
          {t('projectAskAnswerLabel')}
          {streaming && <Loader2 className="h-3 w-3 animate-spin text-white/30" />}
        </div>

        {ask.state.phase === 'error' ? (
          <p className="text-[12.5px] leading-relaxed text-[#FCA5A5] break-words">
            {t(askErrorKey(ask.state.code))}
          </p>
        ) : answer ? (
          /* The SAME markdown renderer chat answers use — an inline answer must
             not read as a lesser, plain-text version of the same reply. */
          <div className="text-[13px] leading-relaxed text-white/75 break-words [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5">
            <MarkdownMessage content={answer} />
          </div>
        ) : (
          <p className={EMPTY_TEXT}>{t('projectAskThinking')}</p>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {streaming && (
          <button onClick={onStop} className={SMALL_BTN}>
            <X className="h-3 w-3" /> {t('projectAskCancel')}
          </button>
        )}
        {ask.state.phase === 'error' && (
          <button onClick={onRetry} className={SMALL_BTN}>
            <RotateCcw className="h-3 w-3" /> {t('projectAskRetry')}
          </button>
        )}
        {ask.threadId && !streaming && (
          <button onClick={() => onOpenChat(ask.threadId!)} className={SMALL_BTN}>
            <MessageSquare className="h-3 w-3" /> {t('projectAskOpenInChat')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CUSTOMIZE VIEW

   Three states per source, and a sentence saying exactly what they do and do
   not do. The honesty line is not decoration: a control that looked like it
   silenced alerts would be a genuinely dangerous control.
   ══════════════════════════════════════════════════════════════════════════ */

const PREF_ICON: Record<FeedPreference, typeof Star> = {
  highlight: Star,
  normal: CircleDot,
  hidden: EyeOff,
};

/* ══════════════════════════════════════════════════════════════════════════
   MEMORY — what Korvix actually knows about this project

   NOT a chat card with a summary in it. This is the project's durable memory,
   grouped the way the knowledge vocabulary itself is graded: what was DECIDED,
   what is REQUIRED, what is FORBIDDEN, then the facts and notes — plus, as
   part of the same picture, what Korvix knows it cannot see.

   AUTHORITY IS UNCHANGED. Decisions live in the decision authority and the
   rest in the project-memory authority; `projects.knowledge` already projects
   both, and `knowledgeGroups` only groups what that projection returned. There
   is no third store, no promotion, and nothing here writes: adding an item
   goes to the Knowledge view, which posts to the existing route and re-reads.

   THE SUMMARY IS THE PROJECT'S OWN. `summary.text` comes from the Project
   Brain's stashed summary, falling back to the project's own description —
   which is why the weak "Korvix has not generated a summary yet" copy appears
   only when both are genuinely absent, rather than as a default.

   ASK SITS BESIDE MEMORY, NOT INSTEAD OF IT. The suggestion chips and the
   inline answer are an interaction surface on top of what the project knows;
   they are deliberately below the memory, not in place of it.
   ══════════════════════════════════════════════════════════════════════════ */
function ProjectMemorySection({
  workspace, suggestions, ask, askSurface, onAsk, onRetry, onStop, onDismiss,
  onOpenChat, onOpenKnowledge, t,
}: {
  workspace: ProjectWorkspace;
  suggestions: { id: string; labelKey: string; promptKey: string }[];
  ask: InlineAsk | null;
  askSurface: React.Ref<HTMLDivElement>;
  onAsk: (prompt: string) => void;
  onRetry: () => void;
  onStop: () => void;
  onDismiss: () => void;
  onOpenChat: (threadId: string) => void;
  onOpenKnowledge: () => void;
  t: T;
}) {
  const groups = knowledgeGroups(workspace.knowledge);
  const gaps = knowledgeGapKeys(workspace.understanding, 3);
  const total = workspace.knowledge.counts.total ?? 0;
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const anything = hasProjectMemory(workspace);

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className={SECTION_TITLE}>{t('projectMemoryHeading')}</div>
        <button onClick={onOpenKnowledge}
          className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[11px] text-white/45 hover:text-white hover:bg-white/[0.06] transition-all">
          <Plus className="h-3 w-3" /> {t('projectKnowledgeAdd')}
        </button>
      </div>

      {workspace.summary.text ? (
        <p className="text-[13.5px] leading-relaxed text-white/70 break-words">
          {workspace.summary.text}
        </p>
      ) : !anything ? (
        <p className={EMPTY_TEXT}>{t('projectBriefEmpty')}</p>
      ) : null}

      {groups.length > 0 && (
        <div className="mt-3 space-y-3">
          {groups.map((group) => (
            <div key={group.kind}>
              <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
                {t(group.labelKey)}
                {group.total > group.items.length && (
                  <span className="text-white/25"> · {group.total}</span>
                )}
              </div>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.id}
                    className="flex items-start gap-2 text-[12.5px] leading-snug text-white/70">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-white/25" />
                    <span className="min-w-0 break-words">{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* WHAT KORVIX KNOWS IT CANNOT SEE. Part of the memory, not a footnote:
          "no production evidence exists" is a durable fact about the project
          and belongs beside the facts that do. */}
      {gaps.length > 0 && (
        <div className="mt-3">
          <div className="text-[10.5px] uppercase tracking-[0.06em] text-white/30 mb-1">
            {t('projectMemoryGapsTitle')}
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

      {anything && groups.length === 0 && !workspace.summary.text && (
        <p className={EMPTY_TEXT}>{t('projectMemoryEmpty')}</p>
      )}

      {total > shown && (
        <div className="mt-2.5">
          <MoreLink label={t('projectKnowledgeViewAll')} onClick={onOpenKnowledge} />
        </div>
      )}

      {/* ── Ask Korvix — an interaction surface ON project memory ─────────
          Every suggestion is STATIC text gated on a concept this project
          actually has state about; no model is called to invent a question. */}
      <div className={`mt-4 pt-3.5 ${RULE}`}>
        <div className="text-[11px] text-white/35 mb-2">{t('projectSectionAsk')}</div>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s.id} onClick={() => onAsk(t(s.promptKey))}
              disabled={ask?.state.phase === 'streaming'}
              className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 h-7 text-[11.5px] text-white/60 hover:text-white hover:border-white/[0.16] hover:bg-white/[0.05] transition-all max-w-full disabled:opacity-40 disabled:hover:text-white/60">
              <span className="truncate">{t(s.labelKey)}</span>
              <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
            </button>
          ))}
        </div>
        {ask ? (
          <InlineAnswer ask={ask} surfaceRef={askSurface}
            onRetry={onRetry} onStop={onStop}
            onDismiss={onDismiss} onOpenChat={onOpenChat} t={t} />
        ) : (
          <p className="mt-2 text-[10.5px] text-white/25">{t('projectAskHint')}</p>
        )}
      </div>
    </section>
  );
}

function CustomizeFeedPanel({
  sources, draft, busy, error, onChange, onSave, onReset, onClose, t,
}: {
  sources: string[];
  draft: FeedPreferences;
  busy: boolean;
  error: boolean;
  onChange: (source: string, preference: FeedPreference) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
  t: T;
}) {
  return (
    <div className={`${PANEL} mt-3 p-3 sm:p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={SECTION_TITLE}>
            <SlidersHorizontal className="h-3.5 w-3.5 text-white/40" />
            {t('projectFeedCustomizeTitle')}
          </div>
          {/* The semantic boundary, stated to the person operating the control. */}
          <p className="mt-1 text-[11px] leading-relaxed text-white/35 max-w-[42rem]">
            {t('projectFeedCustomizeHint')}
          </p>
        </div>
        <button onClick={onClose} aria-label={t('projectFeedClose')}
          className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {sources.length === 0 ? (
        <p className={`${EMPTY_TEXT} mt-3`}>{t('projectFeedNoSources')}</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {sources.map((source) => {
            const current = feedPreferenceOf(draft, source);
            return (
              <li key={source}
                className="flex flex-wrap items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.02]">
                <SourceIcon source={source} className="h-3.5 w-3.5 shrink-0 text-white/35" />
                <span className="min-w-0 flex-1 basis-24 text-[12.5px] text-white/70 truncate">
                  <SourceName source={source} t={t} />
                </span>
                <div role="radiogroup" aria-label={source}
                  className="flex shrink-0 items-center gap-0.5 rounded-lg border border-white/[0.07] p-0.5">
                  {FEED_PREFERENCES.map((pref) => {
                    const Icon = PREF_ICON[pref];
                    const active = current === pref;
                    const label = t(feedPreferenceKey(pref));
                    return (
                      /* The label is ALWAYS rendered. Hiding it on narrow
                         screens left three near-identical glyphs — a star, a
                         dot and a crossed-out eye — as the only control this
                         whole feature has, on the viewport most people use it
                         from. The row wraps instead: two short lines beat one
                         unreadable one. `aria-label` carries the name
                         regardless, for screen readers and for tests. */
                      <button key={pref} role="radio" aria-checked={active}
                        aria-label={label} title={label}
                        onClick={() => onChange(source, pref)}
                        className={`inline-flex items-center gap-1 rounded-md px-2 h-7 text-[11px] transition-all ${
                          active
                            ? 'text-white bg-white/[0.09]'
                            : 'text-white/40 hover:text-white/80 hover:bg-white/[0.05]'
                        }`}>
                        <Icon className="h-3 w-3 shrink-0" />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="mt-2 text-[11.5px] text-[#FCA5A5]">{t('projectFeedSaveFailed')}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button onClick={onSave} disabled={busy} className={`${PRIMARY_BTN} disabled:opacity-50`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t('projectFeedSave')}
        </button>
        <button onClick={onReset} disabled={busy} className={`${HEADER_BTN} disabled:opacity-50`}>
          <RotateCcw className="h-3.5 w-3.5" /> {t('projectFeedReset')}
        </button>
      </div>
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

  /* ── Inline "Ask Korvix" ───────────────────────────────────────────────
     ONE exchange at a time, and it lives here rather than in a child so a
     question asked from Today, from Current State, or from the suggestion row
     all render into the same surface instead of three competing ones.

     `askThreadId` is remembered for the mount so a follow-up continues the SAME
     project conversation. `askHandle` is the in-flight exchange, held in a ref
     so unmount and project-switch can cancel it without a re-render, and so a
     second click cannot start a second stream. */
  const [ask, setAsk] = useState<InlineAsk | null>(null);
  const askStreaming = useRef(false);
  const askThreadId = useRef<string | null>(null);
  const askSurface = useRef<HTMLDivElement | null>(null);
  const askScrollPending = useRef(false);
  const askHandle = useRef<AskHandle | null>(null);
  const askQuestionId = useRef<string>('');

  /* ── Customize view ───────────────────────────────────────────────────
     `savedPrefs` is server truth (seeded from the snapshot, replaced by every
     successful write); `draftPrefs` is what the open panel is editing. Keeping
     them apart is what lets Cancel mean cancel and lets a failed save leave the
     page showing what is actually stored. */
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draftPrefs, setDraftPrefs] = useState<FeedPreferences>({});
  const [prefBusy, setPrefBusy] = useState(false);
  const [prefError, setPrefError] = useState(false);
  const [prefSources, setPrefSources] = useState<string[]>([]);
  const [savedPrefs, setSavedPrefs] = useState<FeedPreferences | null>(null);

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

  /* ── Stale-while-revalidate ────────────────────────────────────────────
     THIS IS NOT POLLING, and the difference is load-bearing.

     The backend decides, per read, whether any of the project's bound
     connectors were stale enough to refresh in the background. Only when it
     says a refresh is actually RUNNING does this schedule ONE re-read, after
     the interval the backend named. If nothing is running, `recheckInMs` is 0
     and nothing is ever scheduled — a project whose connectors are fresh (the
     common case) costs exactly one request per visit, as it always did.

     `attempts` is a hard ceiling on top of that, so even a connector that
     somehow stays "in flight" cannot turn one visit into an unbounded sequence
     of reads. When the ceiling is reached the page simply stops asking; the
     next visit reads normally. */
  const recheckAttempts = useRef(0);
  const refreshBlock = workspace?.refresh;
  const generatedAt = workspace?.freshness.generated_at;
  useEffect(() => {
    if (!refreshPending(refreshBlock)) return;
    if (recheckAttempts.current >= MAX_REFRESH_RECHECKS) return;
    recheckAttempts.current += 1;
    const timer = window.setTimeout(() => { void refresh(); },
                                    refreshBlock!.recheckInMs);
    return () => window.clearTimeout(timer);
    // Keyed on the SNAPSHOT INSTANT: each successful read schedules at most one
    // follow-up, and a re-read that returns the same state does not re-arm.
  }, [refreshBlock, generatedAt, refresh]);

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

  /* ── Inline "Ask Korvix" ───────────────────────────────────────────────
     One exchange, streamed in place through the EXISTING project chat +
     streaming AI path (see lib/inlineAsk). This function owns nothing about
     the conversation except which one it is: creating it, filing it under the
     project, persisting the turns and building the model's context are all the
     existing authorities' jobs.

     Duplicate-click protection is here and only here: while an exchange is
     streaming, another question is ignored outright. Re-sending the same
     question because a button was double-clicked is exactly the failure this
     surface must not have. */
  const runAsk = useCallback((question: string, questionMessageId?: string) => {
    const text = (question || '').trim();
    if (!text) return;
    // Duplicate-click protection is a REF, not the rendered state. `disabled`
    // on the button is not enough: two clicks in the same tick both read the
    // pre-update state, and the second would start a second stream and post a
    // second question. A ref flips synchronously, so the second click is
    // already too late.
    if (askStreaming.current) return;
    askStreaming.current = true;
    // The answer renders in the Overview. The header's Ask button is visible on
    // every view, so asking from Tasks or Activity has to bring the user back —
    // otherwise the answer would stream into a section that is not on screen.
    setView('overview');
    setAsk({ question: text, threadId: askThreadId.current,
             state: { phase: 'streaming', answer: '' } });
    // …and scroll it into view, because "the user clicks and immediately sees
    // the answer" is the whole point; a question asked from Today would
    // otherwise answer below the fold.
    askScrollPending.current = true;
    const handle = askInWorkspace(projectId, text, {
      onThread: (threadId) => {
        askThreadId.current = threadId;
        setAsk((prev) => (prev && prev.question === text
          ? { ...prev, threadId } : prev));
      },
      onToken: (answer) => setAsk((prev) => (
        prev && prev.state.phase === 'streaming'
          ? { ...prev, state: { phase: 'streaming', answer } } : prev)),
      onDone: (answer) => {
        askStreaming.current = false;
        setAsk((prev) => (prev ? { ...prev, state: { phase: 'done', answer } } : prev));
      },
      onError: (code) => {
        askStreaming.current = false;
        setAsk((prev) => (prev ? { ...prev, state: { phase: 'error', code } } : prev));
      },
    }, { threadId: askThreadId.current, questionMessageId });
    askHandle.current = handle;
    askQuestionId.current = handle.questionMessageId;
  }, [projectId, setView]);

  /* A retry re-sends under the SAME idempotency key, so the question is not
     written to the conversation twice. */
  const retryAsk = useCallback(() => {
    if (ask) runAsk(ask.question, askQuestionId.current);
  }, [ask, runAsk]);

  /* Stop = keep what arrived. `stop()` persists the partial answer as the
     assistant's turn, so what the page shows and what the conversation holds
     stay the same thing. */
  const stopAsk = useCallback(() => {
    askStreaming.current = false;
    askHandle.current?.stop();
    setAsk((prev) => (prev && prev.state.phase === 'streaming'
      ? { ...prev, state: { phase: 'done', answer: prev.state.answer } }
      : prev));
  }, []);

  /* Dismiss = close the surface. The exchange stays in the conversation. */
  const dismissAsk = useCallback(() => {
    askStreaming.current = false;
    askHandle.current?.cancel();
    askHandle.current = null;
    setAsk(null);
  }, []);

  /* Bring the answer on screen ONCE per question, after it has rendered.
     Guarded by a flag rather than run on every `ask` change, so the page does
     not yank the viewport on every streamed token while the user is reading. */
  useEffect(() => {
    if (!ask || !askScrollPending.current) return;
    askScrollPending.current = false;
    askSurface.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [ask]);

  /* Unmount and project switch ABANDON the stream: the user did not choose to
     end it here, so no fragment is written. Their question was persisted before
     the request and remains, answerable in Chat. */
  useEffect(() => () => { askHandle.current?.cancel(); }, []);

  /* ── Customize view ───────────────────────────────────────────────────
     PRESENTATION ONLY. Saving writes one narrow per-user, per-project table
     that nothing in the intelligence or execution chain reads; the page then
     re-reads the workspace so the feed it shows is the one the SERVER built
     from the stored preference, never an optimistic local re-sort.

     The panel's source list comes from the backend's own vocabulary, fetched
     once when it is first opened, so it can never advertise a provider this
     deployment does not have. */
  /** What is actually stored for this user+project: the last successful write
   *  if there has been one this mount, else whatever the snapshot carried.
   *  Memoised so it is a stable reference — otherwise every render would give
   *  `openCustomize` a new identity and re-render the control for nothing. */
  const effectivePrefs = useMemo(
    () => savedPrefs ?? workspace?.feedPreferences ?? EMPTY_PREFS,
    [savedPrefs, workspace],
  );
  const openCustomize = useCallback(() => {
    setPrefError(false);
    setDraftPrefs(effectivePrefs);
    setCustomizeOpen(true);
    if (prefSources.length === 0) {
      void (async () => {
        const res = await getProjectFeedPreferences(projectId);
        if (!res.ok) return;
        setPrefSources(res.sources);
        // Server truth wins over the snapshot copy the panel was seeded with.
        setSavedPrefs(res.preferences);
        setDraftPrefs(res.preferences);
      })();
    }
  }, [effectivePrefs, prefSources.length, projectId]);

  const changePref = useCallback((source: string, preference: FeedPreference) => {
    setDraftPrefs((prev) => {
      const next = { ...prev };
      // `normal` is the DEFAULT, not a third stored state — choosing it removes
      // the entry, exactly as the store does, so the two can never disagree
      // about what "no preference" looks like.
      if (preference === 'normal') delete next[source];
      else next[source] = preference;
      return next;
    });
  }, []);

  const saveCustomize = useCallback(async () => {
    setPrefBusy(true);
    setPrefError(false);
    const res = await setProjectFeedPreferences(projectId, draftPrefs);
    setPrefBusy(false);
    if (!res.ok) { setPrefError(true); return; }
    setSavedPrefs(res.preferences);
    setDraftPrefs(res.preferences);
    setCustomizeOpen(false);
    await refresh();
  }, [draftPrefs, projectId, refresh]);

  const resetCustomize = useCallback(() => {
    setPrefError(false);
    setDraftPrefs({});
  }, []);

  const customizeSources = useMemo(
    () => customizableSources(workspace, prefSources),
    [workspace, prefSources],
  );
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

  /* The page's ONE leading item, joined from three authorities that already
     agree (see `workspaceFocus`). Nothing here ranks: it resolves the backend's
     focus subject to its correlated story and carries the alarm the backend
     already chose. */
  const focusNow = workspaceFocus(workspace);

  const overviewTasks = workspace ? openTasks(workspace.tasks.items) : [];
  const openCount = workspace?.tasks.counts.open ?? 0;
  const knowledgeTotal = workspace?.knowledge.counts.total ?? 0;
  const listedTasks = tasks ?? [];
  /** Rows a HIDDEN source contributed and the feed therefore left out. The
   *  backend counts it; the page only reports it. */
  const hiddenActivity = workspace?.counts.activity_hidden ?? 0;
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
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-[20px] sm:text-[22px] font-semibold leading-tight break-words">
                {name || ' '}
              </h1>
              {/* THE PROJECT'S ACTUAL STATE, in the SAME closed vocabulary the
                  correlated subjects use — `project_intelligence.synthesis`
                  decides it, this renders it. Deliberately not a health
                  score, not a percentage and not a second word list: an empty
                  project reads "Nothing observed yet", which is true, rather
                  than "Stable", which would be a claim. */}
              {workspace?.understanding && (
                <StateChip state={workspace.understanding.state} t={t} />
              )}
            </div>
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
            {/* Ask Korvix ≠ New chat: it ASKS — right here — the most relevant
                of the honest suggestions below (attention first, then recent
                change, then goals, else "what is this about"), and streams the
                answer into the page. New chat still opens an empty conversation
                in Chat. The inline answer becomes a real turn of a real
                project-bound conversation, openable in Chat afterwards. */}
            <button onClick={() => headlineAsk && runAsk(headlineAsk)}
              disabled={!headlineAsk || ask?.state.phase === 'streaming'}
              className={`${PRIMARY_BTN} disabled:opacity-50`}>
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
            OVERVIEW — NOW → CHANGE → MEMORY → DETAIL

            One primary column carrying the reading, and a quiet rail carrying
            the things a project OWNS. The hierarchy is typography and space,
            not chrome: exactly one block on this page has a border, and it is
            the one that answers "what matters right now".

            DOM order IS the mobile priority order — focus, what changed,
            current state, memory, then the rail's contents.
            ══════════════════════════════════════════════════════════════════ */}
        {workspace && view === 'overview' && (
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 lg:gap-10 items-start">
            <div className="min-w-0 space-y-7">

              {/* ── NOW ────────────────────────────────────────────────── */}
              <FocusSection
                focus={focusNow}
                recommendation={workspace.today.recommendation}
                attentionRest={workspace.attention.slice(1)}
                nextItems={workspace.focus?.next || []}
                onAsk={runAsk}
                onCreateTask={startTaskFromRecommendation}
                onOpenTasks={() => setView('tasks')}
                t={t}
              />

              {/* ── CHANGE. Only with a real marker AND something inside the
                     window: on a first visit you have not been away, and
                     "recent changes" IS the Activity surface. ───────────── */}
              {hasVisitChanges(arrival) && (
                <ChangesSection workspace={workspace} changes={arrival!}
                  onAsk={runAsk} onOpenActivity={() => setView('activity')} t={t} />
              )}

              {/* ── CURRENT STATE ──────────────────────────────────────── */}
              {hasUnderstanding(workspace) && (
                <CurrentStateSection
                  items={workspace.projectState}
                  understanding={workspace.understanding}
                  focusSubjectId={focusNow.story?.id || ''}
                  onAsk={runAsk}
                  t={t}
                />
              )}

              {/* ── MEMORY ─────────────────────────────────────────────── */}
              <ProjectMemorySection
                workspace={workspace}
                suggestions={suggestions}
                ask={ask}
                askSurface={askSurface}
                onAsk={runAsk}
                onRetry={retryAsk}
                onStop={stopAsk}
                onDismiss={dismissAsk}
                onOpenChat={openChat}
                onOpenKnowledge={() => setView('knowledge')}
                t={t}
              />
            </div>

            {/* ── DETAIL. What the project OWNS: its tasks, its goals, the
                   newest few events, its builds, its chats, its tools. Quiet
                   rows under quiet headings — this rail is reference, not the
                   reading. Sticky on desktop; below `lg` it simply follows the
                   column in DOM (and therefore priority) order. ─────────── */}
            <aside className="min-w-0 space-y-7 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto scrollbar-thin lg:pl-6 lg:border-l lg:border-white/[0.05]">

              {/* Tasks */}
              <section>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className={SECTION_TITLE}>
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
                      <div className="mt-1.5">
                        <MoreLink label={t('projectTasksViewAll')} onClick={() => setView('tasks')} />
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Goals — read-only, and said so once rather than per row. */}
              {workspace.goals.length > 0 && (
                <section>
                  <div className={`${SECTION_TITLE} mb-1.5`}>{t('projectSectionGoals')}</div>
                  <ul className="space-y-1.5">
                    {workspace.goals.map((g, i) => (
                      <li key={g.id || `goal-${i}`}
                        className="flex items-start gap-2 text-[12.5px] text-white/70">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-white/25" />
                        <span className="min-w-0 break-words">{g.title}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[10.5px] text-white/25">{t('projectGoalsReadOnlyNote')}</p>
                </section>
              )}

              {/* Latest activity — a PULSE, not a log. The full chronology is
                  one tab away and says so. */}
              <section>
                <div className={`${SECTION_TITLE} mb-1.5`}>{t('projectActivityLatest')}</div>
                {workspace.activity.length === 0 ? (
                  <p className={EMPTY_TEXT}>
                    {hiddenActivity > 0
                      ? t('projectActivityAllHidden')
                      : workspace.connectors.length === 0
                        ? t('projectActivityEmptyNoTools')
                        : t('projectActivityEmpty')}
                  </p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {workspace.activity.slice(0, HOME_ACTIVITY).map((a, i) => (
                        <li key={`${a.source}-${a.id}-${i}`} className="flex items-start gap-2">
                          <SourceIcon source={a.source} className="mt-[3px] h-3 w-3 shrink-0 text-white/30" />
                          <div className="min-w-0 flex-1">
                            <ProviderText value={a.title || a.kind}
                              className="block text-[12px] leading-snug text-white/60 break-words" />
                            <div className="text-[10.5px] text-white/25">
                              <SourceName source={a.source} t={t} />
                              {a.occurred_at ? ` · ${timeAgo(a.occurred_at)}` : ''}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2">
                      <MoreLink label={t('projectChangesViewAll')}
                        onClick={() => setView('activity')} />
                    </div>
                  </>
                )}
              </section>

              {/* Products & builds */}
              {workspace.products.length > 0 && (
                <section>
                  <div className={`${SECTION_TITLE} mb-1.5`}>{t('projectSectionProducts')}</div>
                  <div className="-mx-1">
                    {workspace.products.map((p, i) => (
                      <ProductRow key={p.deliverable_id || `${p.run_id}-${i}`}
                        product={p} onOpen={openProduct} t={t} />
                    ))}
                  </div>
                </section>
              )}

              {/* Chats */}
              <section>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className={SECTION_TITLE}>{t('projectSectionChats')}</div>
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

              {/* Connected tools — one dense status row per provider. Not a
                  connector manager: the account-level authorization and the
                  project binding both still live in the connector authority at
                  /settings/integrations, which this links to. */}
              <section>
                <div className={`${SECTION_TITLE} mb-1.5`}>{t('projectSectionTools')}</div>
                {workspace.connectors.length === 0 ? (
                  <p className={EMPTY_TEXT}>{t('projectToolsEmpty')}</p>
                ) : (
                  <div className="-mx-1">
                    {workspace.connectors.map((c) => (
                      <ConnectorRow key={c.provider} connector={c} t={t} />
                    ))}
                  </div>
                )}
                <div className="mt-2">
                  <MoreLink label={t('projectActionManageTools')} external
                    onClick={() => navigate('/settings/integrations')} />
                </div>
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
            {hasVisitChanges(arrival) && (
              <ChangesList workspace={workspace} changes={arrival}
                onAsk={runAsk} t={t} />
            )}

            <section className={`${PANEL} p-4 sm:p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className={SECTION_TITLE}>
                  <Activity className="h-3.5 w-3.5 text-white/40" />
                  {t('projectSectionActivity')}
                  {hiddenActivity > 0 && (
                    /* Never a silently shorter list: what a hidden source
                       contributed is COUNTED and said out loud, because the
                       preference excludes rows from a view and deletes
                       nothing. */
                    <span className="font-normal normal-case tracking-normal text-white/30">
                      · {t('projectFeedHiddenCount', { count: hiddenActivity })}
                    </span>
                  )}
                </div>
                <button onClick={() => (customizeOpen ? setCustomizeOpen(false) : openCustomize())}
                  aria-expanded={customizeOpen}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[11px] text-white/45 hover:text-white hover:bg-white/[0.06] transition-all">
                  <SlidersHorizontal className="h-3 w-3" /> {t('projectFeedCustomize')}
                </button>
              </div>

              {customizeOpen && (
                <CustomizeFeedPanel
                  sources={customizeSources} draft={draftPrefs} busy={prefBusy}
                  error={prefError} onChange={changePref}
                  onSave={() => { void saveCustomize(); }}
                  onReset={resetCustomize}
                  onClose={() => setCustomizeOpen(false)} t={t} />
              )}

              {workspace.activity.length === 0 ? (
                <p className={EMPTY_TEXT}>
                  {hiddenActivity > 0
                    ? t('projectActivityAllHidden')
                    : workspace.connectors.length === 0
                      ? t('projectActivityEmptyNoTools')
                      : t('projectActivityEmpty')}
                </p>
              ) : (
                <ul className="divide-y divide-white/[0.04] -my-1">
                  {workspace.activity.map((a, i) => (
                    <li key={`${a.source}-${a.id}-${i}`} className="flex items-start gap-2.5 py-2">
                      <SourceIcon source={a.source} className="mt-[3px] h-3.5 w-3.5 shrink-0 text-white/30" />
                      <div className="min-w-0 flex-1">
                        <ProviderText value={a.title || a.kind}
                          className="block text-[12.5px] leading-snug text-white/70 break-words" />
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
