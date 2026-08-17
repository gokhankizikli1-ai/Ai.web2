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
 * The mutating actions that live here — add an existing chat, remove a chat
 * from the project — are unchanged: they call the same server-authoritative
 * binding endpoints as before and re-read the workspace afterwards.
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft, MessageSquare, Plus, FolderInput, Blocks, Sparkles,
  Github, Mail, Target, Loader2, Check, X, Search, AlertTriangle,
  MoreHorizontal, FolderMinus, CalendarDays, Triangle, Activity, Hash,
  Clock, Plug, ArrowUpRight, RefreshCw, ChevronRight,
} from 'lucide-react';
import { getProject } from '@/stores/projectStore';
import { useLanguageStore } from '@/stores/languageStore';
import {
  listAddableChats, bindThreadToProject, removeThreadFromProject,
  getProjectWorkspace, type AddableChat,
} from '@/lib/projectApi';
import {
  askSuggestions, attentionReasonKey, connectorSummary, freshnessKey,
  freshnessRelative, newProjectChatUrl, openProjectChatUrl, productBuildType,
  productOpenTarget, productStatusKey, relativeTime, relativeTimeKey,
  severityTone, sourceLabel,
  type AttentionItem, type ProjectWorkspace, type WorkspaceChat,
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
const TONE_STYLE: Record<'critical' | 'warning' | 'info', { dot: string; text: string }> = {
  critical: { dot: '#F87171', text: '#FCA5A5' },
  warning: { dot: '#FBBF24', text: '#FCD34D' },
  info: { dot: '#60A5FA', text: '#93C5FD' },
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

export default function ProjectOverview() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguageStore();
  // The locally-cached project record is used ONLY to render a name while the
  // authoritative workspace loads; the workspace's own project block replaces
  // it the moment it arrives, and it is never used to decide what the user may
  // see. Read once per project id rather than on every render.
  const localProject = useMemo(() => getProject(projectId || ''), [projectId]);

  const [load, setLoad] = useState<LoadState>({ state: 'loading' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const timeAgo = useTimeAgo(t);

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    setLoad(toLoadState(await getProjectWorkspace(projectId)));
  }, [projectId]);

  // ONE bounded read on mount (and on project switch). No polling, no provider
  // fan-out, no model call.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const run = async () => {
      const res = await getProjectWorkspace(projectId);
      if (!cancelled) setLoad(toLoadState(res));
    };
    void run();
    return () => { cancelled = true; };
  }, [projectId]);

  const workspace = load.state === 'ready' ? load.workspace : null;
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
    if (!projectId) return;
    navigate(newProjectChatUrl(projectId, prefill));
  }, [navigate, projectId]);
  // A product opens in the conversation it was generated in — the existing chat
  // surface already restores the embedded build there. This page never renders
  // or re-runs a build itself.
  const openProduct = useCallback((product: WorkspaceProduct) => {
    const target = productOpenTarget(product);
    if (target) navigate(target);
  }, [navigate]);

  // No project id, or the server says this project is not available to this
  // account — the SAME answer for "someone else's" and "does not exist", so the
  // page never reveals which.
  if (!projectId || load.state === 'missing') {
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
              {name || ' '}
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

        {workspace && (
          /* DOM order IS the mobile priority order: attention → brief + ask →
             goals → activity → products → chats → tools. On desktop the last
             three move into the right rail. */
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 lg:gap-6 items-start">
            <div className="min-w-0 space-y-4">

              {/* ── A. NEEDS ATTENTION ─────────────────────────────────── */}
              <section className={`${PANEL} p-4 sm:p-5`}
                style={workspace.attention.length > 0
                  ? { borderColor: 'rgba(248,113,113,0.16)', background: 'rgba(248,113,113,0.025)' }
                  : undefined}>
                <div className={`${SECTION_TITLE} mb-2`}>
                  <AlertTriangle className="h-3.5 w-3.5 text-[#F87171]" />
                  {t('projectSectionAttention')}
                </div>
                {workspace.attention.length === 0 ? (
                  <p className={EMPTY_TEXT}>{t('projectAttentionEmpty')}</p>
                ) : (
                  <ul className="divide-y divide-white/[0.05] -my-0.5">
                    {workspace.attention.map((item) => (
                      <AttentionRow key={item.id} item={item} t={t} />
                    ))}
                  </ul>
                )}
              </section>

              {/* ── B. WHAT KORVIX KNOWS + ASK ─────────────────────────── */}
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

              {/* ── C. CURRENT GOALS ───────────────────────────────────── */}
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

              {/* ── D. RECENT ACTIVITY ─────────────────────────────────── */}
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

            {/* ── Right rail. Sticky on desktop so a long activity list never
                   leaves a dead column beside it; a plain stacked block below
                   `lg` (where DOM order is the mobile priority order). ─────── */}
            <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto scrollbar-thin">

              {/* ── E. PRODUCTS & BUILDS ───────────────────────────────── */}
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

              {/* ── F. CHATS ───────────────────────────────────────────── */}
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

              {/* ── G. CONNECTED TOOLS ─────────────────────────────────── */}
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
