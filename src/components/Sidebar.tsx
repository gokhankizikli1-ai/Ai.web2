import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, MessageSquare, Trash2,
  PanelLeftClose, PanelLeftOpen,
  Crown, Search, X,
  LogIn, Sparkles, FolderOpen, FolderPlus, FolderInput,
  Bot, Plug, FileText, ChevronDown, ChevronRight, Code2, Briefcase, MoreHorizontal,
  BarChart3, Blocks, FolderMinus, Loader2,
} from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import type { ChatSession, ChatFolder } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { shouldShowUpgradeCta } from '@/lib/plan';
import { removeThreadFromProject, assignChatToProject } from '@/lib/projectApi';
import {
  buildSidebarGroups, type ProjectChatRef, type SidebarChatItem,
} from '@/lib/sidebarGroups';
import {
  SIDEBAR_TOP_NAV, NEW_PROJECT_ROUTE, projectRoute,
  isTopNavActive, sidebarShellClasses, isProjectGroupExpanded,
} from '@/lib/sidebarNav';
import {
  CHAT_DRAG_MIME, canMoveChatToProject, moveChatToProject, pruneConfirmedMoves,
} from '@/lib/chatProjectMove';
import DeleteConfirmModal from './DeleteConfirmModal';
import ProjectBindingSection from './MoveToProjectMenu';
import UserAccountDropdown from './UserAccountDropdown';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  activeSessionId: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onMoveToFolder?: (sessionId: string, folder: ChatFolder) => void;
  filteredSessions: ChatSession[];
  onOpenSettings: () => void;
  onOpenUpgrade: () => void;
  /* ── Project grouping (backend-authoritative view; see lib/sidebarGroups) ── */
  /** The user's projects (id + display name). */
  projects?: { id: string; name: string }[];
  /** projectId → chats filed under it, read from the sessions authority. */
  projectChats?: Record<string, ProjectChatRef[]>;
  /** sessionId → projectId for bindings that are still in flight. */
  pendingProjectBindings?: Record<string, string>;
  /** Open a chat known only by SERVER THREAD ID (resolves the real session). */
  onOpenThread?: (threadId: string) => void;
  /** Re-read the project↔chat index after a mutation. */
  onProjectChatsChanged?: () => void;
}

/* ═══════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════ */

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'Now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Which project groups are expanded. Per-identity is unnecessary (it holds no
 *  data, only UI state), but it IS persisted so the sidebar doesn't re-collapse
 *  on every navigation. A malformed/absent value degrades to "all collapsed". */
const EXPANDED_KEY = 'korvix_sidebar_expanded_projects';

function loadExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch { return {}; }
}

/** One row action (the hover-revealed icon buttons on a chat row). */
interface RowAction {
  label: string;
  icon: 'trash' | 'unbind' | 'move';
  onClick: () => void;
  busy?: boolean;
}

function actionIcon(kind: RowAction['icon']) {
  if (kind === 'trash') return <Trash2 className="h-3 w-3" />;
  if (kind === 'unbind') return <FolderMinus className="h-3 w-3" />;
  return <FolderInput className="h-3 w-3" />;
}

  /* ─── Chat row ───
   One compact line: icon · title · timestamp. The timestamp shares the row
   with the title (it no longer takes a second line), so twelve chats fit in
   the space seven used to. Selection is a soft tinted surface + a hairline
   rail rather than a hard border/glow.

   A row in RECENT is also a drag SOURCE: it can be dragged onto a project
   group to file it there. Dragging is never the only path — the same move is
   available from the row's "Move to project" action, which opens the existing
   project picker. */
function ChatRow({
  title, updatedAt, active, onOpen, actions, draggable, onDragStart, onDragEnd, dragging,
}: {
  title: string;
  updatedAt: Date;
  active: boolean;
  onOpen: () => void;
  actions: RowAction[];
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}) {
  // Reserve room on the right for however many actions this row carries, so a
  // long title ellipsizes before it can slide under them.
  const pad = actions.length > 1 ? 'pr-12' : 'pr-7';
  return (
  <div
    className={`group/row relative min-w-0 overflow-hidden transition-opacity ${dragging ? 'opacity-40' : ''}`}
    draggable={draggable}
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
  >
    <button
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      title={title}
      className={`w-full min-w-0 flex items-center gap-2 rounded-lg pl-2 ${pad} h-[30px] text-left transition-colors duration-150 ${
        active
          ? 'bg-[#3B82F6]/[0.10] text-[#F1F5F9]'
          : 'text-white/55 hover:bg-white/[0.045] hover:text-white/85'
      }`}
    >
      {/* Selection rail — softer than the previous border + glow. */}
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-[2px] rounded-full transition-all duration-200 ${
          active ? 'h-4 bg-[#60A5FA]' : 'h-0 bg-transparent'
        }`}
      />
      <MessageSquare className={`h-3 w-3 shrink-0 ${active ? 'text-[#60A5FA]' : 'text-white/25'}`} />
      <span className="flex-1 min-w-0 truncate whitespace-nowrap overflow-hidden text-ellipsis text-[11.5px] leading-none">
        {title}
      </span>
      <span className="shrink-0 text-[9.5px] tabular-nums text-white/20 group-hover/row:opacity-0 transition-opacity">
        {timeAgo(updatedAt)}
      </span>
    </button>

    {/* Row actions — keyboard reachable (focus-visible), revealed on hover. */}
    <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center">
      {actions.map((a) => (
        <button
          key={a.icon}
          onClick={(e) => { e.stopPropagation(); a.onClick(); }}
          disabled={a.busy}
          aria-label={a.label}
          title={a.label}
          className={`p-1 rounded text-white/25 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:bg-white/[0.08] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#60A5FA]/50 transition-all disabled:opacity-40 ${
            a.icon === 'trash' ? 'hover:text-[#F87171] hover:bg-[#F87171]/[0.08]' : 'hover:text-white/80'
          }`}
        >
          {a.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : actionIcon(a.icon)}
        </button>
      ))}
    </div>
  </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════ */

export default function Sidebar({
  isOpen, onToggle, filteredSessions, activeSessionId,
  searchQuery, onSearchChange, onSelect, onDelete, onNewChat,
  onOpenSettings, onOpenUpgrade,
  projects = [], projectChats = {}, pendingProjectBindings = {},
  onOpenThread, onProjectChatsChanged,
}: SidebarProps) {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  // "More" expander for the Korvix Code / Korvix Work placeholders.
  const [moreOpen, setMoreOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(loadExpanded);
  const [unbinding, setUnbinding] = useState<string | null>(null);
  /* Drag-and-drop: which chat is in flight, and which project group is hovered.
     Both are ephemeral gesture state — the binding itself is server truth. */
  const [dragSessionId, setDragSessionId] = useState<string | null>(null);
  const dragSessionRef = useRef<string | null>(null);
  const [dragOverProject, setDragOverProject] = useState<string | null>(null);
  /* Optimistic moves (sessionId → projectId) applied the instant a drop lands,
     rolled back if the server refuses. `buildSidebarGroups` already gives
     backend truth precedence over these, and `pruneConfirmedMoves` drops each
     entry once the server has caught up — so this can never become a second
     source of truth for project membership. */
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, string>>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  /** Chat whose "Move to project" picker is open (the keyboard-reachable path). */
  const [movePickerFor, setMovePickerFor] = useState<ChatSession | null>(null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // While isHydrating is true, the footer renders neither the guest CTA
  // nor the user card — just a thin skeleton. This kills the
  // "flash of Guest User" the user reported on first paint when a
  // valid session is already in localStorage. authStore.checkAuth (in
  // App.tsx mount) flips isHydrating to false at the earliest
  // definitive resolution.
  const isHydrating = useAuthStore((s) => s.isHydrating);
  // Owner-token unlock also counts as "signed in" for footer UI
  // purposes — the project owner shouldn't see "Create Account /
  // Sign In" prompts when they've already unlocked owner mode via
  // the shared secret. isAuthenticated alone misses that path
  // (OWNER_TOKEN doesn't go through /v2/auth/*).
  const { isOwner } = useOwnerMode();
  // The sidebar upgrade CTA must agree with the account-card plan badge: both
  // derive from the SAME authoritative source (useBillingPlan → /v2/billing/me).
  // A paid or owner user never sees "Upgrade to Pro", and it never flashes while
  // the plan is still resolving (planKey === null).
  const { planKey, isPaid } = useBillingPlan();
  const showUpgradeCta = shouldShowUpgradeCta({ planKey, isPaid, isOwner });
  // Phase 9 safety net — if a JWT exists in localStorage but the auth
  // store hasn't flipped isAuthenticated to true yet, treat as
  // session-active rather than guest. This catches the failure mode
  // where /auth/me silently returns null (CORS / 5xx / wrong base URL)
  // but the user's stored credentials are actually valid. Without this
  // gate, a flaky backend would flash the "Create Account / Sign In"
  // buttons to a real logged-in user.
  const hasStoredToken = (() => {
    try { return !!localStorage.getItem('korvix_access_token'); }
    catch { return false; }
  })();
  const sessionActive = isAuthenticated || isOwner || hasStoredToken;
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const location = useLocation();
  // Persistent active styling for router destinations (matches the selected
  // treatment used elsewhere). Only /owner/costs needs it today.
  const isCostsActive = location.pathname === '/owner/costs';

  useEffect(() => {
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded)); }
    catch { /* private mode — group state is UI-only, safe to lose */ }
  }, [expanded]);

  // Escape closes the move picker. Without this the dialog is openable from the
  // keyboard but only dismissable with a pointer, which would make the
  // "keyboard equivalent of the drag" a one-way trip.
  useEffect(() => {
    if (!movePickerFor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMovePickerFor(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [movePickerFor]);

  /* Optimistic entries the backend has caught up with are dropped by DERIVATION
     (never by writing state from an effect), so the server's answer always wins
     without an effect→setState cascade. */
  const liveOptimistic = useMemo(
    () => pruneConfirmedMoves(optimisticMoves, filteredSessions, projectChats),
    [optimisticMoves, filteredSessions, projectChats],
  );

  /* Grouping is a PURE function of (sessions, projects, backend membership,
     pending requests) — see lib/sidebarGroups for the identity rules. An
     in-flight drop is just another pending request. */
  const groups = useMemo(() => buildSidebarGroups({
    sessions: filteredSessions,
    projects,
    projectChats,
    pendingBindings: { ...pendingProjectBindings, ...liveOptimistic },
    search: searchQuery,
    recentLimit: 12,
  }), [filteredSessions, projects, projectChats, pendingProjectBindings, liveOptimistic, searchQuery]);

  // The group that owns the ACTIVE chat defaults to EXPANDED, so opening a
  // project chat from anywhere (sidebar, Project Overview deep link, refresh)
  // always reveals it. This is a derived default, not stored state: an explicit
  // user toggle is recorded in `expanded` and always wins (see
  // lib/sidebarNav.isProjectGroupExpanded).
  const activeProjectGroup = useMemo(() => {
    for (const g of groups.projects) {
      if (g.chats.some((c) => c.sessionId === activeSessionId)) return g.projectId;
    }
    return null;
  }, [groups, activeSessionId]);

  const unbindChat = useCallback(async (threadId: string) => {
    setUnbinding(threadId);
    // Non-destructive: the conversation and its messages stay; only the project
    // binding is dropped (server-authoritative, ownership-enforced).
    const res = await removeThreadFromProject(threadId);
    setUnbinding(null);
    if (res.ok) onProjectChatsChanged?.();
  }, [onProjectChatsChanged]);

  /* ── Move a chat into a project ──
     One code path for BOTH the drag gesture and the picker: validate against
     backend truth, apply optimistically, call the authoritative binding route,
     roll back on refusal (see lib/chatProjectMove). */
  const moveContext = useMemo(
    () => ({ projectChats, pendingBindings: { ...pendingProjectBindings, ...liveOptimistic } }),
    [projectChats, pendingProjectBindings, liveOptimistic],
  );

  const runMove = useCallback(async (session: ChatSession, projectId: string) => {
    setMoveError(null);
    // Reveal the destination immediately so the row is visible where it landed.
    setExpanded((p) => ({ ...p, [projectId]: true }));
    const res = await moveChatToProject(session, projectId, moveContext, {
      bind: assignChatToProject,
      applyOptimistic: (sid, pid) => setOptimisticMoves((p) => ({ ...p, [sid]: pid })),
      rollbackOptimistic: (sid) => setOptimisticMoves((p) => {
        if (!(sid in p)) return p;
        const next = { ...p }; delete next[sid]; return next;
      }),
      onChanged: onProjectChatsChanged,
    });
    if (!res.ok && res.outcome !== 'already-there' && res.outcome !== 'not-movable') {
      setMoveError(res.outcome === 'forbidden' ? t('moveNoAccess') : t('moveFailed'));
    }
  }, [moveContext, onProjectChatsChanged, t]);

  const handleDrop = useCallback((projectId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    // Prefer the typed payload; fall back to the ref for browsers that withhold
    // dataTransfer contents outside a real drop (and for synthetic events).
    const sessionId = e.dataTransfer?.getData(CHAT_DRAG_MIME) || dragSessionRef.current || '';
    setDragOverProject(null);
    setDragSessionId(null);
    dragSessionRef.current = null;
    const session = filteredSessions.find((s) => s.id === sessionId);
    if (!session) return;
    void runMove(session, projectId);
  }, [filteredSessions, runMove]);

  /** The chat currently being dragged, resolved to its real session. */
  const draggedSession = useMemo(
    () => (dragSessionId ? filteredSessions.find((s) => s.id === dragSessionId) ?? null : null),
    [dragSessionId, filteredSessions],
  );

  // Shared Kimi-style nav row styles — larger, readable, comfortable spacing.
  // `min-w-0` lets the row shrink below its intrinsic content width, which is
  // what allows `navLabel`'s truncation to engage; without it a long localized
  // label sets the row's min-content width and pushes past the sidebar edge.
  const navRow = 'group w-full min-w-0 flex items-center gap-3 px-3 h-10 rounded-xl text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/[0.05] transition-colors';
  const navSub = 'w-full min-w-0 flex items-center gap-2.5 pl-3 pr-3 h-9 rounded-lg text-[12.5px] text-white/55 hover:text-white/90 hover:bg-white/[0.04] transition-colors';
  // Every nav label ellipsizes rather than widening its row. Labels come from
  // t(...) so their length varies per language — this must hold for all of them,
  // not just the ones that happen to be short in English.
  const navLabel = 'flex-1 min-w-0 text-left truncate';
  const sectionLabel = 'text-[9.5px] font-semibold uppercase tracking-[0.08em] text-white/25';

  const navIcon = (key: string, active: boolean) => {
    const cls = `h-4 w-4 shrink-0 transition-colors ${active ? 'text-[#60A5FA]' : 'text-white/50 group-hover:text-white/85'}`;
    return key === 'projects' ? <FolderOpen className={cls} /> : <Blocks className={cls} />;
  };

  const openProjectChat = (c: SidebarChatItem) => {
    // A chat present locally opens by its LOCAL id (what the active session is
    // keyed on). One that exists only on the server is opened by THREAD id via
    // the same resolver the Project Overview uses — never by minting a new chat.
    if (c.sessionId) onSelect(c.sessionId);
    else if (c.threadId && onOpenThread) onOpenThread(c.threadId);
  };

  return (
    <>
      {/* Mobile toggle */}
      {!isOpen && (
        <div className="lg:hidden fixed top-[14px] left-3 z-40">
          <button
            onClick={onToggle}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.04] backdrop-blur-md transition-all"
            aria-label="Open sidebar"
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Mobile overlay */}
      {isOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onToggle} />
      )}

      {/* ═══ SIDEBAR ═══
       *
       * Layout classes come from `lib/sidebarNav.sidebarShellClasses` so the
       * two-mode responsive contract (sub-lg overlay vs lg+ locked-width flex
       * sibling) is asserted in a test rather than living only in JSX. Width is
       * set ENTIRELY via utility classes — an inline `style.width` outranks the
       * `lg:` overrides and would pin the sidebar at the mobile width on iPad
       * landscape. `overflow-hidden` remains the boundary defence against a long
       * unbreakable chat title.
       */}
      <aside
        className={sidebarShellClasses(isOpen)}
        style={{
          background: 'rgba(13, 17, 23,0.96)',
          backdropFilter: 'blur(12px) saturate(1.1)',
          borderRight: '1px solid rgba(255,255,255,0.035)',
        }}
      >
        {/* ═── Header ─══ */}
        <div className="shrink-0 flex items-center justify-between px-3 h-11" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Link to="/" className="opacity-90 transition-opacity hover:opacity-100" aria-label="KorvixAI home">
            <BrandLogo tone="onDark" markSize={24} wordSize={15} />
          </Link>
          <button
            onClick={onToggle}
            className="h-6 w-6 flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.04] rounded transition-all"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-3 w-3" />
          </button>
        </div>

        <ScrollArea className="flex-1 min-h-0 min-w-0">
          <div className="px-3 py-3 space-y-3 min-w-0">

            {/* ═══ 1. NEW CHAT — prominent, top ═══ */}
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onNewChat}
              className="w-full h-10 gap-2 flex items-center justify-center rounded-xl text-[13px] font-semibold text-white transition-all"
              style={{
                background: 'linear-gradient(135deg, rgba(59,130,246,0.22) 0%, rgba(59,130,246,0.10) 100%)',
                border: '1px solid rgba(59,130,246,0.30)',
                boxShadow: '0 0 18px -8px rgba(59,130,246,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              <Plus className="h-4 w-4" /> {t('newChat')}
            </motion.button>

            {/* ═══ 2. WORKSPACE NAV — Projects + Connectors, pinned to the top ═══
                 These are workspace destinations, not chat history, so they sit
                 directly under New Chat and ABOVE everything that grows with
                 usage. Order and routes come from lib/sidebarNav. */}
            <div className="space-y-0.5">
              {SIDEBAR_TOP_NAV.map((item) => {
                const active = isTopNavActive(item, location.pathname);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => navigate(item.to)}
                    aria-current={active ? 'page' : undefined}
                    className={`${navRow}${active ? ' bg-white/[0.06] text-white' : ''}`}
                  >
                    {navIcon(item.key, active)}
                    <span className={navLabel}>{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </div>

            {/* ═══ 3. SEARCH ═══ */}
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <Search className="h-3 w-3 text-white/20 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t('searchChats')}
                className="flex-1 bg-transparent text-[11px] outline-none min-w-0 placeholder:text-white/20"
                style={{ color: '#CBD5E1' }}
              />
              {searchQuery && (
                <button onClick={() => onSearchChange('')} aria-label="Clear search" className="shrink-0 text-white/20 hover:text-white/40">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* ═══ 4. PROJECTS — folders, with their chats inline ═══ */}
            <div>
              <div className="flex items-center justify-between py-1 px-1">
                <button
                  type="button"
                  onClick={() => setProjectsOpen((v) => !v)}
                  aria-expanded={projectsOpen}
                  className="flex items-center gap-1.5 rounded px-0.5 py-0.5 hover:text-white/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#60A5FA]/50"
                >
                  <ChevronRight className={`h-3 w-3 text-white/25 transition-transform ${projectsOpen ? 'rotate-90' : ''}`} />
                  <span className={sectionLabel}>{t('projects')}</span>
                </button>
                {/* New project — opens the EXISTING create-project flow
                    (ProjectsDashboard's own modal via ?new=1). No second modal,
                    store or API is introduced here. */}
                <button
                  type="button"
                  onClick={() => navigate(NEW_PROJECT_ROUTE)}
                  title={t('newProject')}
                  aria-label={t('newProject')}
                  className="h-5 w-5 flex items-center justify-center rounded text-white/30 hover:text-white/80 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#60A5FA]/50 transition-all"
                >
                  <FolderPlus className="h-3 w-3" />
                </button>
              </div>

              {moveError && (
                <p role="alert" className="mx-1 mb-1 rounded px-2 py-1 text-[10px]" style={{ background: 'rgba(248,113,113,0.08)', color: '#FCA5A5' }}>
                  {moveError}
                </p>
              )}

              {projectsOpen && (
                <>
                  {/* Always-available create affordance — a labelled row, not
                      just the icon above, so it is obvious on first look. */}
                  <button
                    type="button"
                    onClick={() => navigate(NEW_PROJECT_ROUTE)}
                    className="ml-3 w-[calc(100%-0.75rem)] flex items-center gap-1.5 pl-1.5 pr-2 h-[28px] rounded-lg text-left text-[11.5px] text-white/40 hover:text-white/85 hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#60A5FA]/50 transition-colors"
                    style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <Plus className="h-3 w-3 shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{t('newProject')}</span>
                  </button>

                  {projects.length === 0 ? (
                    <p className="ml-3 px-2 py-1.5 text-[10.5px] text-white/25" style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                      {t('projectsSidebarEmpty')}
                    </p>
                  ) : (
                    <div className="ml-3 min-w-0" style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                      {groups.projects.map((g) => {
                        const open = isProjectGroupExpanded(g.projectId, expanded, activeProjectGroup);
                        // A group lights up as a drop target only for a chat it
                        // could actually accept (never for one already filed here).
                        const droppable = canMoveChatToProject(draggedSession, g.projectId, moveContext);
                        const over = droppable && dragOverProject === g.projectId;
                        return (
                          <div
                            key={g.projectId}
                            className="min-w-0"
                            onDragOver={(e) => {
                              if (!droppable) return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              if (dragOverProject !== g.projectId) setDragOverProject(g.projectId);
                            }}
                            onDragLeave={(e) => {
                              // Ignore bubbling leaves from child rows.
                              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                              setDragOverProject((p) => (p === g.projectId ? null : p));
                            }}
                            onDrop={handleDrop(g.projectId)}
                          >
                            <div
                              className={`group/proj relative flex items-center min-w-0 rounded-lg transition-colors ${
                                over
                                  ? 'bg-[#3B82F6]/[0.22] ring-1 ring-[#60A5FA]'
                                  : droppable ? 'ring-1 ring-dashed ring-white/[0.10]' : ''
                              }`}
                              data-drop-target={over ? 'active' : droppable ? 'available' : undefined}
                            >
                              {/* Expand / collapse — the folder affordance. */}
                              <button
                                type="button"
                                onClick={() => setExpanded((p) => ({ ...p, [g.projectId]: !open }))}
                                aria-expanded={open}
                                aria-label={open ? `Collapse ${g.name}` : `Expand ${g.name}`}
                                className="shrink-0 h-[30px] w-5 flex items-center justify-center rounded-l-lg text-white/25 hover:text-white/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#60A5FA]/50 transition-colors"
                              >
                                <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
                              </button>
                              {/* Name — opens the real project route. */}
                              <button
                                type="button"
                                onClick={() => navigate(projectRoute(g.projectId))}
                                title={g.name}
                                className="flex-1 min-w-0 flex items-center gap-1.5 pr-2 h-[30px] rounded-r-lg text-left text-white/65 hover:text-white/95 hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#60A5FA]/50 transition-colors"
                              >
                                <FolderOpen className="h-3 w-3 shrink-0 text-white/35" />
                                <span className="flex-1 min-w-0 truncate text-[11.5px] font-medium leading-none">{g.name}</span>
                                {g.chats.length > 0 && (
                                  <span className="shrink-0 text-[9.5px] tabular-nums text-white/20">{g.chats.length}</span>
                                )}
                              </button>
                            </div>

                            {open && (
                              <div className="pl-3 min-w-0">
                                {g.chats.length === 0 ? (
                                  <p className="px-2 py-1.5 text-[10px] text-white/22">{t('projectNoChats')}</p>
                                ) : g.chats.map((c) => (
                                  <ChatRow
                                    key={c.key}
                                    title={c.title}
                                    updatedAt={c.updatedAt}
                                    active={!!c.sessionId && c.sessionId === activeSessionId}
                                    onOpen={() => openProjectChat(c)}
                                    actions={[{
                                      label: t('removeFromProject'),
                                      icon: 'unbind',
                                      onClick: () => { if (c.threadId) void unbindChat(c.threadId); },
                                      busy: !!c.threadId && unbinding === c.threadId,
                                    }]}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ═══ 5. RECENT — standalone chats only ═══
                 Each row is a drag SOURCE for the project groups above, and
                 carries a "Move to project" action so the same move is reachable
                 without a pointer. */}
            <div>
              <div className="flex items-center justify-between py-1 px-1">
                <span className={sectionLabel}>{t('recent')}</span>
                <span className="text-[9.5px] text-white/15">{groups.recents.length}</span>
              </div>

              {groups.recents.length > 0 ? (
                <div className="ml-3 min-w-0 overflow-hidden" style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="pl-2 min-w-0">
                    {groups.recents.map((s) => (
                      <ChatRow
                        key={s.id}
                        title={s.title}
                        updatedAt={s.updatedAt}
                        active={activeSessionId === s.id}
                        onOpen={() => onSelect(s.id)}
                        draggable={projects.length > 0}
                        dragging={dragSessionId === s.id}
                        onDragStart={(e) => {
                          setMoveError(null);
                          dragSessionRef.current = s.id;
                          setDragSessionId(s.id);
                          try {
                            e.dataTransfer.setData(CHAT_DRAG_MIME, s.id);
                            e.dataTransfer.setData('text/plain', s.title);
                            e.dataTransfer.effectAllowed = 'move';
                          } catch { /* older browsers — the ref fallback covers it */ }
                        }}
                        onDragEnd={() => {
                          dragSessionRef.current = null;
                          setDragSessionId(null);
                          setDragOverProject(null);
                        }}
                        actions={[
                          ...(projects.length > 0 ? [{
                            label: t('moveToProject'),
                            icon: 'move' as const,
                            onClick: () => setMovePickerFor(s),
                          }] : []),
                          { label: t('deleteChat'), icon: 'trash' as const, onClick: () => setDeleteTarget(s.id) },
                        ]}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-4 text-center ml-3" style={{ borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
                  <MessageSquare className="h-4 w-4 text-white/10 mx-auto mb-1.5" />
                  <p className="text-[11px] text-white/30 mb-0.5">{t('noChats')}</p>
                  <p className="text-[9px] text-white/15">{t('startConversation')}</p>
                </div>
              )}
            </div>

            {/* ═══ 6. OWNER TOOLS ═══
                 Phase 14A — Plugins, Skills and the entire More group (its only
                 children are the unfinished Korvix Code / Korvix Work
                 placeholders) are gated to the owner via the existing
                 useOwnerMode authority. Connectors is NOT here: it is a
                 workspace destination and lives in the top nav above. */}
            {isOwner && (
              <div className="space-y-0.5 pt-1">
                <button type="button" onClick={() => navigate('/agents')} className={navRow}>
                  <Bot className="h-4 w-4 shrink-0 text-[#60A5FA]" />
                  <span className={navLabel}>{t('agents')}</span>
                </button>
                {/* Owner-only Web Build cost analytics. Router-native navigation
                    (HashRouter resolves the /owner/costs hash). Backend enforces
                    owner access on every cost endpoint regardless of this link. */}
                <button
                  type="button"
                  onClick={() => navigate('/owner/costs')}
                  aria-current={isCostsActive ? 'page' : undefined}
                  className={`${navRow}${isCostsActive ? ' bg-white/[0.06] text-white' : ''}`}
                >
                  <BarChart3 className={`h-4 w-4 shrink-0 transition-colors ${isCostsActive ? 'text-[#60A5FA]' : 'text-white/50 group-hover:text-white/85'}`} />
                  <span className={navLabel}>{t('navCostAnalytics')}</span>
                </button>
                <button type="button" className={navRow}>
                  <Plug className="h-4 w-4 shrink-0 text-white/50 group-hover:text-white/85 transition-colors" />
                  <span className={navLabel}>Plugins</span>
                </button>
                <button type="button" className={navRow}>
                  <FileText className="h-4 w-4 shrink-0 text-white/50 group-hover:text-white/85 transition-colors" />
                  <span className={navLabel}>Skills</span>
                </button>
                <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className={navRow}>
                  <MoreHorizontal className="h-4 w-4 shrink-0 text-white/50 group-hover:text-white/85 transition-colors" />
                  <span className={navLabel}>More</span>
                  <ChevronDown className={`shrink-0 h-3.5 w-3.5 text-white/35 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                </button>
                {moreOpen && (
                  <div className="ml-4 space-y-0.5" style={{ borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
                    <button type="button" className={navSub}>
                      <Code2 className="h-3.5 w-3.5 shrink-0 text-white/40" />
                      <span className={navLabel}>Korvix Code</span>
                    </button>
                    <button type="button" className={navSub}>
                      <Briefcase className="h-3.5 w-3.5 shrink-0 text-white/40" />
                      <span className={navLabel}>Korvix Work</span>
                    </button>
                  </div>
                )}
              </div>
            )}

          </div>
        </ScrollArea>

        {/* ═── Footer ─══ */}
        <div className="shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>

          {/* While auth is still hydrating, render a thin skeleton in
              place of the CTA / user card so we don't briefly flash
              "Create Account" to a user who's actually signed in. */}
          {isHydrating && (
            <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div className="flex flex-col gap-1.5">
                <div className="h-7 rounded-lg bg-white/[0.03] animate-pulse" />
                <div className="h-7 rounded-lg bg-white/[0.02] animate-pulse" />
              </div>
            </div>
          )}

          {/* Guest: Prominent auth CTA — also hidden when owner mode is
              active via OWNER_TOKEN (isOwner from useOwnerMode), since
              that's a legitimately-authenticated session even though
              isAuthenticated stays false. */}
          {!isHydrating && !sessionActive && (
            <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => navigate('/signup')}
                  className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg bg-[#3B82F6]/[0.14] text-[#60A5FA] border border-[#3B82F6]/30 text-[11px] font-medium hover:bg-[#3B82F6]/[0.2] transition-all"
                >
                  <Sparkles className="w-3 h-3" /> {t('createAccount')}
                </button>
                <button
                  onClick={() => navigate('/login')}
                  className="w-full h-7 flex items-center justify-center gap-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all"
                  style={{ border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <LogIn className="w-3 h-3" /> {t('signIn')}
                </button>
              </div>
              <p className="text-[9px] text-white/15 mt-1.5 text-center">
                {t('syncDevices')}
              </p>
            </div>
          )}

          {/* User card — gated on !isHydrating so the dropdown doesn't
              briefly render "Guest User / user@korvix.ai" while the
              persisted session is being verified. Replaced by a
              compact skeleton during hydration. */}
          <div className="px-3 py-2">
            {isHydrating ? (
              <div className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 border border-white/[0.03] bg-white/[0.015]">
                <div className="h-7 w-7 rounded-lg bg-white/[0.04] animate-pulse shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="h-2.5 rounded bg-white/[0.04] animate-pulse w-2/3" />
                  <div className="h-2 rounded bg-white/[0.025] animate-pulse w-1/3" />
                </div>
              </div>
            ) : (
              <UserAccountDropdown onOpenSettings={onOpenSettings} onOpenUpgrade={onOpenUpgrade} />
            )}
          </div>

          {/* Upgrade — only for a confirmed non-paid, non-owner user (never
              contradicts the plan badge; never flashes while the plan resolves). */}
          {showUpgradeCta && (
            <div className="px-3 pb-3">
              <Button
                variant="ghost"
                onClick={onOpenUpgrade}
                className="w-full h-7 gap-1.5 text-[11px] text-white/30 hover:text-[#60A5FA] hover:bg-[#3B82F6]/[0.08] rounded-lg transition-all border border-transparent hover:border-[#3B82F6]/25"
              >
                <Crown className="h-3 w-3" />
                {t('upgradePro')}
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* ═══ Move to project — the keyboard-reachable equivalent of the drag ═══
           Hosts the EXISTING project picker (components/MoveToProjectMenu →
           ProjectBindingSection), which reads the chat's current binding from
           server truth and mutates through the same ownership-checked routes.
           Rendered outside the sidebar so it is not clipped by `overflow-hidden`
           and works identically on mobile. */}
      <AnimatePresence>
        {movePickerFor && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0f1a]/70 backdrop-blur-sm"
            onClick={() => setMovePickerFor(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.18 }}
              role="dialog"
              aria-modal="true"
              aria-label={t('moveToProject')}
              className="w-full max-w-xs mx-4 rounded-2xl border border-white/[0.06] bg-[#171C24] shadow-2xl p-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-2 pt-1 pb-1">
                <span className="text-[12px] font-semibold text-white/85 truncate">{movePickerFor.title}</span>
                <button
                  onClick={() => setMovePickerFor(null)}
                  aria-label="Close"
                  className="h-6 w-6 flex items-center justify-center rounded text-white/35 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <ProjectBindingSection session={movePickerFor} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
      <DeleteConfirmModal
        open={!!deleteTarget}
        title="Delete Chat"
        description="This chat and all its messages will be permanently deleted."
        onConfirm={() => { if (deleteTarget) onDelete(deleteTarget); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
