/**
 * ProjectOverview — the DEFAULT surface for /projects/:id.
 *
 * A Project is a durable workspace, not a second build/chat mode. Opening a
 * project lands here — a clean overview of its CHATS, generated PRODUCTS, and a
 * bounded INTELLIGENCE summary — all read from backend-authoritative endpoints
 * (never duplicated into localStorage). Build Studio is an explicit action, not
 * the project homepage.
 *
 * Data sources (all existing, deterministic — no model calls):
 *   • chats     → GET /v2/sessions/projects/{id}/threads          (projectApi.listProjectChats)
 *   • products  → GET /v2/orchestrator/projects/{id}/products      (projectApi.listProjectProducts)
 *   • intel     → GET /v2/projects/{id}/brain                      (projectApi.getProjectBrainContext)
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft, MessageSquare, Plus, Blocks, Hammer, Sparkles,
  Github, Mail, Target, ChevronRight, Loader2,
} from 'lucide-react';
import { getProject } from '@/stores/projectStore';
import {
  listProjectChats, listProjectProducts, getProjectBrainContext,
  type ProjectChat, type ProjectProduct, type ProjectBrainContext,
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

const CARD = 'rounded-2xl border border-white/[0.06] bg-white/[0.02]';
const SECTION_TITLE = 'flex items-center gap-2 text-[13px] font-semibold text-white/85';

export default function ProjectOverview() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const project = getProject(projectId || '');

  const [chats, setChats] = useState<ProjectChat[]>([]);
  const [products, setProducts] = useState<ProjectProduct[]>([]);
  const [brain, setBrain] = useState<ProjectBrainContext | null>(null);
  const [loading, setLoading] = useState(true);

  // Read backend truth on mount (and whenever the project changes). All state
  // updates happen inside the async callback (never synchronously in the effect
  // body); `loading` starts true, so no synchronous set is needed.
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

  const openStudio = () => navigate(`/projects/${project.id}/studio`);
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
          <button onClick={openStudio}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.12] px-3 h-8 text-[12px] font-medium text-[#93C5FD] hover:bg-[#3B82F6]/[0.2] transition-all">
            <Hammer className="h-3.5 w-3.5" /> Open Build Studio
          </button>
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
            <button onClick={newProjectChat}
              className="flex items-center gap-1 rounded-lg px-2 h-7 text-[11.5px] text-white/60 hover:text-white hover:bg-white/[0.05] transition-all">
              <Plus className="h-3.5 w-3.5" /> New chat
            </button>
          </div>
          {chats.length === 0 ? (
            <p className="text-[12px] text-white/40 py-2">
              No chats in this project yet. Start one with <span className="text-white/60">New chat</span>, or add an existing chat from its ⋯ menu.
            </p>
          ) : (
            <div className="space-y-0.5">
              {chats.map((c) => (
                <button key={c.id} onClick={() => openChat(c.id)}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.04] transition-all group">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-white/30 group-hover:text-white/60" />
                  <span className="flex-1 min-w-0 truncate text-[12.5px] text-white/75">{c.title}</span>
                  <span className="shrink-0 text-[10px] text-white/25">{timeAgo(c.updated_at)}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/15 group-hover:text-white/40" />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Products / Builds */}
        <section className={`${CARD} mt-4 p-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className={SECTION_TITLE}><Blocks className="h-4 w-4 text-[#34D399]" /> Products &amp; Builds</div>
          </div>
          {products.length === 0 ? (
            <p className="text-[12px] text-white/40 py-2">
              No generated products yet. <button onClick={openStudio} className="text-[#93C5FD] hover:underline">Open Build Studio</button> to create a Web or App build.
            </p>
          ) : (
            <div className="space-y-0.5">
              {products.map((p) => (
                <button key={p.deliverable_id || `${p.run_id}-${p.title}`} onClick={openStudio}
                  className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.04] transition-all group">
                  <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                    style={{ background: 'rgba(52,211,153,0.12)', color: '#6EE7B7' }}>
                    {(p.build_type || 'web') === 'app' ? 'App' : 'Web'}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[12.5px] text-white/75">{p.title || 'Untitled product'}</span>
                  <span className="shrink-0 text-[10px] text-white/30">{p.status || ''}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/15 group-hover:text-white/40" />
                </button>
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
                      {s.source === 'gmail' ? <Mail className="h-3 w-3 shrink-0 text-white/35" /> : <Github className="h-3 w-3 shrink-0 text-white/35" />}
                      <span className="flex-1 min-w-0 truncate">{s.summary || s.kind}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
