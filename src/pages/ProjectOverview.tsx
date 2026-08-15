/**
 * ProjectOverview — the DEFAULT and ONLY primary surface for /projects/:id.
 *
 * A Project is a durable workspace: CHATS, generated PRODUCTS, and a bounded
 * INTELLIGENCE summary — all read from backend-authoritative endpoints (never
 * duplicated into localStorage). It deliberately does NOT contain a second
 * build/chat composer; product generation happens in the normal chat / Web-App
 * Build experience and saves back here via the existing backend product
 * association. (The legacy /projects/:id/studio surface is retained only for
 * owner-gated Agent/orchestrator flows and is not linked from here.)
 *
 * Data sources (all existing, deterministic — no model calls):
 *   • chats           → GET /v2/sessions/projects/{id}/threads
 *   • addable chats   → GET /v2/sessions/workspaces/{ws}/threads (+ per-project membership)
 *   • products        → GET /v2/orchestrator/projects/{id}/products
 *   • intelligence    → GET /v2/projects/{id}/brain
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft, MessageSquare, Plus, FolderInput, Blocks, Sparkles,
  Github, Mail, Target, Loader2, Check, X, Search,
  MoreHorizontal, FolderMinus, CalendarDays, Triangle, Activity, Hash,
} from 'lucide-react';
import { getProject } from '@/stores/projectStore';
import {
  listProjectChats, listProjectProducts, getProjectBrainContext,
  listAddableChats, bindThreadToProject, removeThreadFromProject,
  type ProjectChat, type ProjectProduct, type ProjectBrainContext, type AddableChat,
} from '@/lib/projectApi';

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* Icon for a connector signal, keyed by the observation `source` the backend
 * registry emits (see observations_store.CONNECTOR_SOURCES). Unknown sources
 * fall back to a neutral activity glyph rather than being mislabelled as one of
 * the known providers — the previous binary "gmail ? Mail : Github" already
 * mislabelled every Vercel signal, and would have mislabelled Calendar too. */
function ConnectorSignalIcon({ source }: { source?: string | null }) {
  const cls = 'h-3 w-3 shrink-0 text-white/35';
  switch (source) {
    case 'gmail': return <Mail className={cls} />;
    case 'calendar': return <CalendarDays className={cls} />;
    case 'github': return <Github className={cls} />;
    case 'vercel': return <Triangle className={cls} />;
    case 'slack': return <Hash className={cls} />;
    default: return <Activity className={cls} />;
  }
}

const CARD = 'rounded-2xl border border-white/[0.06] bg-white/[0.02]';
const SECTION_TITLE = 'flex items-center gap-2 text-[13px] font-semibold text-white/85';
const HEADER_BTN = 'flex items-center gap-1 rounded-lg px-2 h-7 text-[11.5px] text-white/60 hover:text-white hover:bg-white/[0.05] transition-all';

// ── "Add existing chat" picker ──────────────────────────────────────────────
function AddExistingChatModal({
  projectId, onClose, onChanged,
}: {
  projectId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<AddableChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const list = await listAddableChats(projectId);
      if (!cancelled) { setItems(list); setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [projectId]);

  const act = useCallback(async (c: AddableChat) => {
    if (c.inCurrentProject) return;
    setBusyId(c.id);
    const res = await bindThreadToProject(c.id, projectId);
    setBusyId(null);
    if (res.ok) {
      // Reflect backend truth locally, then refresh the Overview list.
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
      <div className={`${CARD} w-full max-w-md max-h-[80vh] flex flex-col`}
        style={{ background: 'rgba(17,23,34,0.98)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className={SECTION_TITLE}><FolderInput className="h-4 w-4 text-[#60A5FA]" /> Add existing chat</div>
          <button onClick={onClose} aria-label="Close" className="text-white/40 hover:text-white/80 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {showSearch && (
          <div className="px-4 pt-3">
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 h-8">
              <Search className="h-3.5 w-3.5 text-white/30" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats…"
                className="flex-1 bg-transparent text-[12px] text-white/80 placeholder:text-white/25 outline-none" />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
          {loading ? (
            <div className="flex items-center gap-2 text-[12px] text-white/40 px-2 py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading chats…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-[12px] text-white/40 px-2 py-4">
              {items.length === 0 ? 'No saved chats yet. Start a conversation first.' : 'No chats match your search.'}
            </p>
          ) : filtered.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2">
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-white/30" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-[12.5px] text-white/80">{c.title}</div>
                <div className="text-[10px] text-white/30">
                  {timeAgo(c.updated_at)}
                  {c.otherProjectName ? ` · in ${c.otherProjectName}` : ''}
                </div>
              </div>
              {c.inCurrentProject ? (
                <span className="shrink-0 flex items-center gap-1 text-[11px] text-[#34D399]">
                  <Check className="h-3.5 w-3.5" /> In project
                </span>
              ) : (
                <button onClick={() => act(c)} disabled={busyId === c.id}
                  className="shrink-0 flex items-center gap-1 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.12] px-2.5 h-7 text-[11px] font-medium text-[#93C5FD] hover:bg-[#3B82F6]/[0.2] transition-all disabled:opacity-50">
                  {busyId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {c.otherProjectId ? 'Move here' : 'Add'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── A single project chat row with an "Open / Remove from project" kebab ─────
function ProjectChatRow({
  chat, onOpen, onRemoved,
}: {
  chat: ProjectChat;
  onOpen: (threadId: string) => void;
  onRemoved: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    const res = await removeThreadFromProject(chat.id);
    setBusy(false);
    setMenuOpen(false);
    if (res.ok) onRemoved();
  }, [chat.id, onRemoved]);

  return (
    <div ref={ref} className="group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-white/[0.04] transition-all">
      <button onClick={() => onOpen(chat.id)} className="flex flex-1 min-w-0 items-center gap-2.5 text-left">
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-white/30 group-hover:text-white/60" />
        <span className="flex-1 min-w-0 truncate text-[12.5px] text-white/75">{chat.title}</span>
        <span className="shrink-0 text-[10px] text-white/25">{timeAgo(chat.updated_at)}</span>
      </button>
      <button onClick={() => setMenuOpen((o) => !o)} aria-label="Chat actions"
        className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {menuOpen && (
        <div role="menu"
          className="absolute right-1 top-full mt-1 w-44 rounded-xl border shadow-2xl overflow-hidden z-50 py-1"
          style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(17,23,34,0.98)', backdropFilter: 'blur(24px)' }}>
          <button role="menuitem" onClick={() => { setMenuOpen(false); onOpen(chat.id); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-white/70 hover:bg-white/[0.05] transition-all">
            <MessageSquare className="h-3.5 w-3.5 text-white/40" /> Open chat
          </button>
          <button role="menuitem" onClick={() => { void remove(); }} disabled={busy}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] text-[#FCA5A5] hover:bg-white/[0.05] transition-all disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderMinus className="h-3.5 w-3.5" />} Remove from project
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProjectOverview() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const project = getProject(projectId || '');

  const [chats, setChats] = useState<ProjectChat[]>([]);
  const [products, setProducts] = useState<ProjectProduct[]>([]);
  const [brain, setBrain] = useState<ProjectBrainContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const refreshChats = useCallback(async () => {
    if (!projectId) return;
    const c = await listProjectChats(projectId);
    setChats(c);
  }, [projectId]);

  // Read backend truth on mount (and whenever the project changes). All state
  // updates happen inside the async callback; `loading` starts true.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const load = async () => {
      const [c, p, b] = await Promise.all([
        listProjectChats(projectId),
        listProjectProducts(projectId),
        getProjectBrainContext(projectId),
      ]);
      if (cancelled) return;
      setChats(c);
      setProducts(p);
      setBrain(b);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [projectId]);

  if (!project) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3" style={{ background: '#07090D', color: '#F8FAFC' }}>
        <p className="text-[13px] text-white/60">Project not found.</p>
        <button onClick={() => navigate('/projects')} className="text-[12px] text-[#60A5FA] hover:underline">← Back to projects</button>
      </div>
    );
  }

  const openChat = (threadId: string) =>
    navigate(`/chat?openSession=${encodeURIComponent(threadId)}`);
  const newProjectChat = () =>
    navigate(`/chat?newChatForProject=${encodeURIComponent(project.id)}`);

  return (
    <div className="min-h-[100dvh] w-full" style={{ background: 'radial-gradient(1200px 680px at 50% -14%, rgba(59,130,246,0.06), transparent 60%), #07090D', color: '#F8FAFC' }}>
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => navigate('/projects')} aria-label="Back to projects"
            className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border border-white/[0.06] text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-all">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-semibold truncate">{project.name}</h1>
            {project.description && (
              <p className="text-[12px] text-white/45 truncate">{project.description}</p>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-[12px] text-white/40 mt-6">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading workspace…
          </div>
        )}

        {/* Chats */}
        <section className={`${CARD} mt-6 p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className={SECTION_TITLE}><MessageSquare className="h-4 w-4 text-[#60A5FA]" /> Chats</div>
            <div className="flex items-center gap-1">
              <button onClick={() => setPickerOpen(true)} className={HEADER_BTN}>
                <FolderInput className="h-3.5 w-3.5" /> Add existing
              </button>
              <button onClick={newProjectChat} className={HEADER_BTN}>
                <Plus className="h-3.5 w-3.5" /> New chat
              </button>
            </div>
          </div>
          {chats.length === 0 ? (
            <p className="text-[12px] text-white/40 py-2">
              No chats in this project yet. Start one with <span className="text-white/60">New chat</span>, or bring in a saved conversation with <span className="text-white/60">Add existing</span>.
            </p>
          ) : (
            <div className="space-y-0.5">
              {chats.map((c) => (
                <ProjectChatRow key={c.id} chat={c} onOpen={openChat} onRemoved={() => { void refreshChats(); }} />
              ))}
            </div>
          )}
        </section>

        {/* Products / Builds — informational (product generation happens in chat) */}
        <section className={`${CARD} mt-4 p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className={SECTION_TITLE}><Blocks className="h-4 w-4 text-[#34D399]" /> Products &amp; Builds</div>
          </div>
          {products.length === 0 ? (
            <p className="text-[12px] text-white/40 py-2">
              No generated products yet. Create a Web or App build from a chat and save it to this project — it will appear here.
            </p>
          ) : (
            <div className="space-y-0.5">
              {products.map((p) => (
                <div key={p.deliverable_id || `${p.run_id}-${p.title}`}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2">
                  <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                    style={{ background: 'rgba(52,211,153,0.12)', color: '#6EE7B7' }}>
                    {(p.build_type || 'web') === 'app' ? 'App' : 'Web'}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[12.5px] text-white/75">{p.title || 'Untitled product'}</span>
                  <span className="shrink-0 text-[10px] text-white/30">{p.status || ''}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Intelligence / activity */}
        {brain && (brain.current_goals?.length || brain.connector_signals?.length || brain.project_summary) ? (
          <section className={`${CARD} mt-4 p-4`}>
            <div className={`${SECTION_TITLE} mb-3`}><Sparkles className="h-4 w-4 text-[#C084FC]" /> Project intelligence</div>
            {brain.project_summary && (
              <p className="text-[12px] text-white/55 mb-3 leading-relaxed">{brain.project_summary}</p>
            )}
            {brain.current_goals && brain.current_goals.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-1.5 text-[11px] text-white/40 mb-1.5"><Target className="h-3 w-3" /> Goals</div>
                <div className="space-y-1">
                  {brain.current_goals.slice(0, 4).map((g, i) => (
                    <div key={i} className="text-[12px] text-white/70 truncate">• {g}</div>
                  ))}
                </div>
              </div>
            )}
            {brain.connector_signals && brain.connector_signals.length > 0 && (
              <div>
                <div className="text-[11px] text-white/40 mb-1.5">Recent connector activity</div>
                <div className="space-y-1">
                  {brain.connector_signals.slice(0, 5).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px] text-white/65">
                      <ConnectorSignalIcon source={s.source} />
                      <span className="flex-1 min-w-0 truncate">{s.summary || s.kind}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>

      {pickerOpen && projectId && (
        <AddExistingChatModal
          projectId={projectId}
          onClose={() => setPickerOpen(false)}
          onChanged={() => { void refreshChats(); }}
        />
      )}
    </div>
  );
}
