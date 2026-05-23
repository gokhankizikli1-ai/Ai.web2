import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/hooks/useToast';
import {
  ArrowLeft, Plus, Send, Bot, Paperclip, MoreHorizontal,
  FolderOpen, Zap, Sparkles, X, Pencil, Trash2,
  Layout, Server, Search, Rocket, ShoppingBag,
  TrendingUp, Palette, Activity,
} from 'lucide-react';

const ROLE_ICONS: Record<string, React.ElementType> = {
  Layout, Server, Search, Rocket, ShoppingBag, TrendingUp, Palette, Sparkles, Code: Bot, Bot,
};

import {
  getProject, getProjectAgents, addProjectAgent, updateProjectAgent,
  removeProjectAgent, addAgentMessage, updateAgentMessage,
  AGENT_ROLES, createAgent, uid,
  listProjectMemory, addProjectMemory, type ProjectMemoryEntry,
} from '@/stores/projectStore';
import type { ProjectAgent, AgentMessage } from '@/types/projects';
import { useProjectActivity } from '@/hooks/useProjectActivity';
import AgentMessageRenderer from '@/components/AgentMessageRenderer';

/* ═══════════════════════════════════════════════════════════════════
   Phase 3.7 — typewriter helpers.
   ═══════════════════════════════════════════════════════════════════
   Splits the full reply into a sequence of progressively-larger
   prefixes that respect word + code-fence boundaries. The first
   prefix is the first ~3 words; subsequent prefixes add 2-4 words
   each; fenced code blocks land in ONE tick (not split mid-token)
   so syntax highlighting / structure stays readable as it appears.

   Output is fed to the in-component typewriter loop one prefix per
   tick; the renderer re-parses markdown each tick, so the loop has
   to be cheap (linear-time chunking, no per-tick string concat). */
const TYPEWRITER_TICK_MS = 28;

function chunkForTypewriter(reply: string): string[] {
  if (!reply) return [];
  const out: string[] = [];
  const tokens: string[] = [];
  // Greedy tokenization that keeps fenced code blocks atomic.
  // Walks the string; when it sees ```, captures up to the closing
  // ```, then continues word-by-word elsewhere.
  let i = 0;
  while (i < reply.length) {
    if (reply.startsWith('```', i)) {
      const end = reply.indexOf('```', i + 3);
      if (end === -1) {
        tokens.push(reply.slice(i));
        break;
      }
      tokens.push(reply.slice(i, end + 3));
      i = end + 3;
      continue;
    }
    // Capture next word + trailing whitespace as one token
    let j = i;
    while (j < reply.length && /\S/.test(reply[j])) j++;
    while (j < reply.length && /\s/.test(reply[j]) && !reply.startsWith('```', j)) j++;
    tokens.push(reply.slice(i, j));
    i = j;
  }
  // Build progressive prefixes: emit a new prefix every WORDS_PER_TICK
  // word-tokens, BUT code-fence tokens get their own tick (atomic).
  const WORDS_PER_TICK = 3;
  let acc = '';
  let wordCount = 0;
  for (const t of tokens) {
    const isCode = t.startsWith('```');
    acc += t;
    if (isCode) {
      out.push(acc);
      wordCount = 0;
      continue;
    }
    wordCount++;
    if (wordCount >= WORDS_PER_TICK) {
      out.push(acc);
      wordCount = 0;
    }
  }
  // Ensure the final prefix == the full reply (capture any trailing
  // remainder that didn't cross WORDS_PER_TICK).
  if (out.length === 0 || out[out.length - 1] !== acc) {
    out.push(acc);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════
   Phase 3.7 — humanise SSE event kinds into operator-friendly status
   labels. The user sees "Planning" / "Delegating → researcher" /
   "Generating with coder" / "Completed", not "agent.started" /
   "run.finished". Colour follows status state, with pulse on active. */
interface OrchestrationStatus {
  label: string;
  color: string;
  pulse: boolean;
}

/**
 * Phase 4.1 — humanise an agent_id into a display name. The new
 * built-ins use snake_case ids (ux_designer, brand_designer, ...);
 * ephemeral specialists use `ephemeral-<role>-<hash>`. Both should
 * read as natural English in the activity timeline.
 */
function humanAgentName(id: string | null | undefined): string {
  if (!id) return 'agent';
  if (id.startsWith('ephemeral-')) {
    // 'ephemeral-security_auditor-c1eaa46e' → 'Security Auditor (new)'
    const rolePart = id.replace(/^ephemeral-/, '').replace(/-[0-9a-f]{6,}$/i, '');
    return `${rolePart.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} (new)`;
  }
  // 'ux_designer' → 'UX Designer'; 'brand_designer' → 'Brand Designer'
  const upcase = new Set(['ux', 'ui', 'api', 'cto', 'pm', 'qa', 'seo']);
  return id.split('_')
    .map((part) => upcase.has(part.toLowerCase())
      ? part.toUpperCase()
      : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Phase 4.1 — workflow-stage colour for an agent_id, so multi-agent
 *  panels read as a colourful timeline rather than a uniform blob. */
function agentTone(id: string | null | undefined): string {
  if (!id) return '#34d399';
  const map: Record<string, string> = {
    researcher:         '#a78bfa',  // violet — analysis
    product_strategist: '#fb923c',  // orange — strategy
    ux_designer:        '#38bdf8',  // sky — design flow
    brand_designer:     '#f472b6',  // pink — visual
    copywriter:         '#fbbf24',  // amber — voice
    coder:              '#34d399',  // emerald — build
    marketer:           '#facc15',  // yellow — growth
    strategist:         '#fb923c',  // orange — advice
    trader:             '#22d3ee',  // cyan — markets
  };
  if (map[id]) return map[id];
  if (id.startsWith('ephemeral-')) return '#c084fc';  // purple — ephemeral
  return '#34d399';
}

function orchestrationStatusFor(evt: {
  kind: string;
  agent_id?: string | null;
  payload?: Record<string, unknown>;
}): OrchestrationStatus {
  const p = (evt.payload ?? {}) as { agent_id?: string; tool?: string; error?: string; code?: string };
  const targetId = p.agent_id ?? evt.agent_id ?? undefined;
  const targetName = humanAgentName(targetId);
  const targetColor = agentTone(targetId);

  switch (evt.kind) {
    case 'run.started':
      return { label: 'Supervisor planning…', color: '#22d3ee', pulse: true };
    case 'run.finished':
      return { label: 'Orchestration complete', color: '#94a3b8', pulse: false };
    case 'run.errored':
      return { label: `Orchestration errored — ${p.error ?? 'unknown'}`, color: '#fbbf24', pulse: false };
    case 'delegate.started':
      // Spawned ephemeral agents read as "Spawning → X (new)"; known
      // agents read as "Delegating → X".
      return {
        label: `${targetId?.startsWith('ephemeral-') ? 'Spawning' : 'Delegating'} → ${targetName}`,
        color: targetColor, pulse: true,
      };
    case 'delegate.returned':
      return { label: `${targetName} ready`, color: '#94a3b8', pulse: false };
    case 'delegate.errored':
      return { label: `Delegation failed — ${p.code ?? p.error ?? 'unknown'}`, color: '#fbbf24', pulse: false };
    case 'agent.started':
      return { label: `${targetName} thinking…`, color: targetColor, pulse: true };
    case 'agent.finished':
      return { label: `${targetName} delivered`, color: '#94a3b8', pulse: false };
    case 'tool.called':
      return { label: `Calling tool: ${p.tool ?? 'unknown'}`, color: '#34d399', pulse: true };
    case 'tool.completed':
      return { label: `${p.tool ?? 'Tool'} done`, color: '#94a3b8', pulse: false };
    case 'tool.errored':
      return { label: `${p.tool ?? 'Tool'} failed`, color: '#fbbf24', pulse: false };

    // Phase 4.2 — deeper specialist telemetry. Each step becomes its own
    // line in the activity timeline so "context lookup → draft → quality
    // check → completed" reads as visible execution rather than opaque
    // "thinking…".
    case 'agent.context_lookup':
      return {
        label: `${targetName} reading project context`,
        color: targetColor, pulse: true,
      };
    case 'agent.draft_generated':
      return {
        label: `${targetName} draft ready`,
        color: targetColor, pulse: true,
      };
    case 'agent.quality_check': {
      const ok = (evt.payload as { ok?: boolean })?.ok;
      return ok
        ? { label: `${targetName} passed quality check`,
            color: '#34d399', pulse: false }
        : { label: `${targetName} quality check flagged issues`,
            color: '#fbbf24', pulse: true };
    }
    case 'agent.regenerated':
      return {
        label: `${targetName} regenerating with stricter contract`,
        color: '#fbbf24', pulse: true,
      };
    default:
      return { label: evt.kind, color: '#94a3b8', pulse: false };
  }
}

/* ═══════════════════════════════════════════ */

export default function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const project = getProject(projectId || '');

  const [agents, setAgents] = useState<ProjectAgent[]>(() => getProjectAgents(projectId || ''));
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id || '');
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  /* Phase 3.7 — id of the message currently being streamed in by the
     typewriter. The renderer reads this to show its in-bubble
     three-dot pulse while content is still empty / mid-stream. */
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);

  /* ── Phase 2.5: project memory state ─────────────────────────────────
     `memorySyncState` tracks whether we're hitting the backend or
     falling back to "offline" (backend disabled / unreachable). The UI
     shows a tiny indicator so the user can see whether project context
     is being shared across devices or only kept locally in this session. */
  const [memory, setMemory] = useState<ProjectMemoryEntry[]>([]);
  const [memorySyncState, setMemorySyncState] = useState<'unknown' | 'connected' | 'offline'>('unknown');
  const [memorySyncedAt, setMemorySyncedAt] = useState<string | null>(null);
  const [showAddMemory, setShowAddMemory] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [newMemoryKind, setNewMemoryKind] = useState<'note' | 'fact' | 'decision'>('note');
  const [memoryBusy, setMemoryBusy] = useState(false);

  const refreshMemory = useCallback(async () => {
    if (!projectId) return;
    const items = await listProjectMemory(projectId, { limit: 20 });
    setMemory(items);
    // listProjectMemory returns [] on failure too, so we can't use length
    // alone to detect offline. Re-probe by attempting a tiny GET against
    // /projects/health which is cheap and always callable when the route
    // is registered. 404 / network error → offline.
    try {
      const apiBase = ((import.meta.env.VITE_API_URL as string | undefined)?.trim()
        || 'https://worker-production-1345.up.railway.app').replace(/\/+$/, '');
      const r = await fetch(`${apiBase}/projects/health`);
      if (r.ok) {
        const body = await r.json();
        setMemorySyncState(body.enabled ? 'connected' : 'offline');
      } else {
        setMemorySyncState('offline');
      }
      setMemorySyncedAt(new Date().toISOString());
      // eslint-disable-next-line no-console
      console.info('[projectStore] project_loaded_from_backend', {
        projectId, memory_count: items.length, route_status: r.status,
      });
    } catch {
      setMemorySyncState('offline');
      setMemorySyncedAt(new Date().toISOString());
    }
  }, [projectId]);

  useEffect(() => { refreshMemory(); }, [refreshMemory]);

  /* ── Phase 3.5: realtime project activity via SSE ────────────────────
     Subscribes the workspace to /v2/events/stream?scope=project:<id>
     when an orchestration is running. The hook is inert when no
     projectId is set or when the backend has ENABLE_REALTIME_EVENTS
     off — falls back to the existing per-agent "Recent Activity"
     list in those cases. */
  const { events: liveEvents, status: liveStatus } =
    useProjectActivity(projectId || null);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);
  const activeAgentCount = agents.filter(a => a.status === 'active').length;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedAgent?.messages.length, isTyping]);

  /* ─── Agent CRUD ─── */
  const refreshAgents = useCallback(() => {
    if (projectId) {
      const updated = getProjectAgents(projectId);
      setAgents(updated);
      if (updated.length > 0 && !updated.find(a => a.id === selectedAgentId)) {
        setSelectedAgentId(updated[0].id);
      }
    }
  }, [projectId, selectedAgentId]);

  const handleCreateAgent = (roleId: string, name: string, customRole?: string) => {
    if (!projectId) return;
    const agent = createAgent(roleId, name, customRole);
    addProjectAgent(projectId, agent);
    // Phase 2.5 marker — addProjectAgent already fires-and-forgets a
    // POST to /projects/{id}/agents; this log just makes the lifecycle
    // visible in production DevTools without changing the persist path.
    // eslint-disable-next-line no-console
    console.info('[projectStore] project_agent_bound', {
      projectId, agentId: agent.id, name: agent.name, role: agent.role,
    });
    refreshAgents();
    setSelectedAgentId(agent.id);
    setShowCreateAgent(false);
    addToast(`Agent "${agent.name}" created`, 'success');
  };

  const handleRenameAgent = (agentId: string, newName: string) => {
    if (!projectId) return;
    updateProjectAgent(projectId, agentId, { name: newName });
    refreshAgents();
    setEditingAgent(null);
  };

  /* Phase 2.5 — submit a new project memory entry from the modal. */
  const handleAddMemory = async () => {
    if (!projectId) return;
    const content = newMemoryContent.trim();
    if (!content || memoryBusy) return;
    setMemoryBusy(true);
    try {
      const entry = await addProjectMemory(projectId, content, { kind: newMemoryKind });
      if (entry) {
        // eslint-disable-next-line no-console
        console.info('[projectStore] project_memory_created', {
          projectId, memoryId: entry.id, kind: entry.kind, length: content.length,
        });
        addToast('Memory saved to project', 'success');
        setShowAddMemory(false);
        setNewMemoryContent('');
        setNewMemoryKind('note');
        refreshMemory();
      } else {
        // Backend rejected or unreachable. Don't lose the user's text —
        // keep the modal open so they can retry. The /projects/* routes
        // return 503 when ENABLE_PROJECTS=false; this is the most likely
        // cause and the toast tells the user clearly.
        addToast('Could not save memory — backend offline or projects disabled', 'error');
      }
    } finally {
      setMemoryBusy(false);
    }
  };

  const handleDeleteAgent = (agentId: string) => {
    if (!projectId) return;
    removeProjectAgent(projectId, agentId);
    refreshAgents();
    setAgentMenuOpen(null);
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !projectId || !selectedAgent) return;
    const messageText = inputMessage.trim();
    const userMsg: AgentMessage = { id: `msg-${uid()}`, content: messageText, sender: 'user', timestamp: new Date().toISOString(), type: 'text' };
    addAgentMessage(projectId, selectedAgent.id, userMsg);
    setInputMessage('');
    setIsTyping(true);
    refreshAgents();

    /* Phase 3.6 — project chat now routes to the orchestrator.
       Strategy:
         1. Try POST /v2/orchestrate (real multi-agent: Supervisor plans,
            delegates to specialists, synthesises a structured reply).
         2. On 503 (ENABLE_ORCHESTRATOR=false), fall back to POST /chat
            with project_id (Phase 2 behaviour — single-LLM with
            project context injection).
         3. On both failing, render a local placeholder so the chat
            never visually dead-ends.

       The final reply is rendered progressively via a client-side
       typewriter into a pre-inserted empty assistant message — gives
       the ChatGPT-style streaming feel even when the underlying API
       returned the full string at once. Activity events from the
       Phase 3.5 SSE stream surface separately in the Recent Activity
       sidebar panel while generation is happening. */
    const apiBase = ((import.meta.env.VITE_API_URL as string | undefined)?.trim()
      || 'https://worker-production-1345.up.railway.app').replace(/\/+$/, '');
    const userId = (() => {
      try {
        const key = 'korvix_user_id';
        let id = localStorage.getItem(key);
        if (!id) {
          id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
            ? crypto.randomUUID() : `u-${Date.now()}`;
          localStorage.setItem(key, id);
        }
        return id;
      } catch { return 'guest'; }
    })();

    const fallbackReply = () =>
      'I had trouble reaching the orchestrator. The connection will retry — '
      + 'in the meantime, please rephrase or try again.';

    /* Phase 3.7 — DEFER the assistant message insert until we have
       the first chunk of content. This eliminates the "empty bubble"
       window that Phase 3.6 produced (where an empty agent message
       sat next to the typing indicator while the fetch was pending).
       The id is generated up-front so the renderer can correlate it
       with the streaming flag. */
    const assistantMsgId = `msg-${uid()}`;
    setStreamingMsgId(assistantMsgId);

    (async () => {
      let replyText = '';
      let usedOrchestrator = false;

      // Phase 4.2 — send the last 12 messages of THIS agent's chat so
      // the orchestrator has conversation continuity (the new
      // recent_messages field on OrchestrateBody). Skip the placeholder
      // we just inserted; map to the backend's {role, content} shape.
      const recentMessages = selectedAgent.messages
        .filter((m) => m.id !== assistantMsgId && (m.content || '').trim().length > 0)
        .slice(-12)
        .map((m) => ({
          role:    m.sender === 'user' ? 'user' as const : 'assistant' as const,
          content: m.content,
        }));

      // 1. Try the orchestrator (Phase 3.4 + 4.2)
      try {
        const res = await fetch(`${apiBase}/v2/orchestrate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id:    userId,
            message:    messageText,
            project_id: projectId,
            // Use the user-selected project agent's id as the root when
            // the user explicitly picked a non-supervisor specialist;
            // otherwise default to 'supervisor' so the LLM plans + delegates.
            agent_id:   selectedAgent.id.startsWith('agent-')
                          ? 'supervisor'
                          : (selectedAgent.id || 'supervisor'),
            metadata:   { from_project_workspace: true, selected_agent: selectedAgent.id },
            recent_messages: recentMessages.length > 0 ? recentMessages : undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          replyText = String(data.reply ?? '').trim();
          usedOrchestrator = true;
          // eslint-disable-next-line no-console
          console.info('[projectChat] orchestrator_used', {
            run_id: data.run_id, agents_used: data.agents_used,
            trace: data.trace,
          });
        } else if (res.status !== 503) {
          // Non-503 error — log and fall through to /chat fallback
          // eslint-disable-next-line no-console
          console.warn('[projectChat] orchestrator returned', res.status);
        }
      } catch {
        // Network error — fall through to legacy /chat below
      }

      // 2. Fall back to /chat if orchestrator was disabled or unreachable
      if (!replyText) {
        try {
          const res = await fetch(`${apiBase}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id:    userId,
              message:    messageText,
              chat_id:    `project-${projectId}-${selectedAgent.id}`,
              session_id: `project-${projectId}-${selectedAgent.id}`,
              platform:   'web',
              project_id: projectId,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            replyText = String(data.reply ?? data.response ?? data.message ?? '').trim();
          }
        } catch {
          // Swallow
        }
      }

      if (!replyText) replyText = fallbackReply();

      /* Phase 3.7 — word-boundary typewriter.
         Replaces the Phase 3.6 character-stride reveal with chunks
         that respect word + code-fence boundaries. Code blocks and
         long structural sections appear in one tick each so they
         don't fragment visually as the reader's eye scans them.
         The first reveal also INSERTS the bubble (deferred from
         the pre-insert in Phase 3.6) so an empty bubble never appears.

         Pacing: ~30-40 ticks/sec on long replies (matches reading
         speed for fluent users), ~2 ticks for tiny replies. */
      const chunks = chunkForTypewriter(replyText);
      let insertedBubble = false;
      let revealed = '';
      for (const next of chunks) {
        revealed = next;
        if (!projectId) break;
        if (!insertedBubble) {
          // First non-empty content — NOW we add the message to the
          // session. The render swap from "typing dots" to "bubble"
          // is instant from the user's perspective.
          addAgentMessage(projectId, selectedAgent.id, {
            id: assistantMsgId, content: revealed, sender: 'agent',
            timestamp: new Date().toISOString(), type: 'text', agentId: selectedAgent.id,
          });
          insertedBubble = true;
        } else {
          updateAgentMessage(projectId, selectedAgent.id, assistantMsgId, {
            content: revealed,
          });
        }
        refreshAgents();
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, TYPEWRITER_TICK_MS));
      }

      // Defensive final commit (no-op if the loop already wrote the full text)
      if (projectId && insertedBubble) {
        updateAgentMessage(projectId, selectedAgent.id, assistantMsgId, {
          content: replyText,
        });
        refreshAgents();
      }

      // eslint-disable-next-line no-console
      console.info('[projectChat] reply_complete', {
        used_orchestrator: usedOrchestrator,
        reply_chars: replyText.length,
        chunk_count: chunks.length,
      });
      setStreamingMsgId(null);
      setIsTyping(false);
    })();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  /* ─── No project ─── */
  if (!project) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: '#11151C' }}>
        <div className="text-center">
          <FolderOpen className="h-12 w-12 text-white/10 mx-auto mb-3" />
          <p className="text-[13px] text-white/30">Project not found</p>
          <button onClick={() => navigate('/projects')} className="text-[12px] text-cyan-400 hover:text-cyan-300 mt-2">Back to Projects</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden" style={{ background: '#11151C', color: '#E2E8F0' }}>
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[200px] -right-[200px] w-[600px] h-[600px] rounded-full opacity-[0.03]" style={{ background: 'radial-gradient(circle, #22D3EE 0%, transparent 70%)' }} />
      </div>

      {/* Top Bar */}
      <div className="relative shrink-0 flex items-center justify-between px-4 py-2.5" style={{ background: 'rgba(17,21,28,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.05)', zIndex: 10 }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/projects')} className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-4 bg-white/10" />
          <div className={`flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br ${project.gradient}`}>
            <FolderOpen className="h-3 w-3 text-white" />
          </div>
          <h1 className="text-[13px] font-semibold text-white/90">{project.name}</h1>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.12)' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] text-emerald-400/80 font-medium">{activeAgentCount} active</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <Bot className="h-3 w-3 text-white/25" />
            <span className="text-[10px] text-white/35">{agents.length} agents</span>
          </div>
          <button onClick={() => setShowCreateAgent(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-cyan-400/70 hover:text-cyan-300 transition-all" style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.08)' }}>
            <Plus className="h-3 w-3" /> Agent
          </button>
        </div>
      </div>

      {/* 3-Panel Layout */}
      <div className="relative flex-1 flex min-h-0">
        {/* LEFT: Agent List */}
        <div className="hidden lg:flex flex-col w-[230px] shrink-0 overflow-hidden" style={{ background: 'rgba(17,21,28,0.5)', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex-1 overflow-y-auto px-2.5 py-3 scrollbar-thin">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] font-semibold text-white/25 uppercase tracking-wider">Agents</span>
              <span className="text-[10px] text-white/15">{agents.length}</span>
            </div>

            {agents.length === 0 ? (
              <div className="py-8 text-center px-2">
                <Bot className="h-8 w-8 text-white/[0.06] mx-auto mb-2" />
                <p className="text-[11px] text-white/25 mb-3">No agents yet</p>
                <button onClick={() => setShowCreateAgent(true)} className="text-[11px] text-cyan-400/50 hover:text-cyan-300 transition-colors">Create your first agent</button>
              </div>
            ) : (
              <div className="space-y-1">
                {agents.map((agent, i) => (
                  <AgentListItem
                    key={agent.id}
                    agent={agent}
                    isSelected={selectedAgentId === agent.id}
                    isEditing={editingAgent === agent.id}
                    menuOpen={agentMenuOpen === agent.id}
                    onSelect={() => setSelectedAgentId(agent.id)}
                    onRename={(name) => handleRenameAgent(agent.id, name)}
                    onDelete={() => handleDeleteAgent(agent.id)}
                    onMenuToggle={() => setAgentMenuOpen(agentMenuOpen === agent.id ? null : agent.id)}
                    onStartEdit={() => setEditingAgent(agent.id)}
                    index={i}
                  />
                ))}
              </div>
            )}

            <button
              onClick={() => setShowCreateAgent(true)}
              className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] text-white/20 hover:text-white/45 transition-all"
              style={{ border: '1px dashed rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}
            >
              <Plus className="h-3 w-3" /> Add Agent
            </button>
          </div>

          {/* Shared memory indicator */}
          <div className="shrink-0 px-3 py-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'rgba(34,211,238,0.02)', border: '1px solid rgba(34,211,238,0.05)' }}>
              <Zap className="h-3 w-3 text-cyan-400/40" />
              <span className="text-[10px] text-cyan-400/40">Project context active</span>
              <span className="text-[9px] text-white/15 ml-auto">{agents.length > 0 ? 'Synced' : '—'}</span>
            </div>
          </div>
        </div>

        {/* CENTER: Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedAgent ? (
            <>
              {/* Agent Header */}
              <div className="shrink-0 flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br ${selectedAgent.gradient}`} style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                    <Bot className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-white/85">{selectedAgent.name}</span>
                      <span className="text-[10px] text-white/25">{selectedAgent.role}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(52,211,153,0.04)', border: '1px solid rgba(52,211,153,0.08)' }}>
                    <div className="w-1 h-1 rounded-full bg-emerald-400/60" />
                    <span className="text-[8px] text-emerald-400/60">{selectedAgent.contextSync}% sync</span>
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin">
                {selectedAgent.messages.length === 0 && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center py-8">
                    <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${selectedAgent.gradient} mb-3`}>
                      <Sparkles className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="text-[14px] font-semibold text-white/70 mb-1">{selectedAgent.name}</h3>
                    <p className="text-[11px] text-white/30 max-w-sm mx-auto">{selectedAgent.description}</p>
                  </motion.div>
                )}

                {selectedAgent.messages.map((msg, i) => (
                  <motion.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] ${msg.sender === 'user' ? 'order-1' : ''}`}>
                      {msg.sender === 'agent' && (
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className={`flex h-4 w-4 items-center justify-center rounded-md bg-gradient-to-br ${selectedAgent.gradient}`}>
                            <Bot className="h-2 w-2 text-white" />
                          </div>
                          <span className="text-[10px] text-white/25">{selectedAgent.name}</span>
                        </div>
                      )}
                      <div className="rounded-xl px-3.5 py-2.5" style={{
                        background: msg.sender === 'user' ? 'linear-gradient(135deg, rgba(34,211,238,0.1), rgba(59,130,246,0.06))' : 'rgba(255,255,255,0.025)',
                        border: `1px solid ${msg.sender === 'user' ? 'rgba(34,211,238,0.08)' : 'rgba(255,255,255,0.04)'}`,
                      }}>
                        {msg.sender === 'user' ? (
                          <p className="text-[12px] text-white/75 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          /* Phase 3.7 — structured agent renderer.
                             Splits supervisor output on ## headers into
                             cards, renders markdown (code blocks, lists,
                             tables) inside each. The renderer hides
                             empty content so we don't get empty bubbles
                             during the fetch window. */
                          <AgentMessageRenderer
                            content={msg.content}
                            isStreaming={isTyping && msg.id === streamingMsgId}
                          />
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}

                {isTyping && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-2">
                    <div className={`flex h-4 w-4 items-center justify-center rounded-md bg-gradient-to-br ${selectedAgent.gradient}`}><Bot className="h-2 w-2 text-white" /></div>
                    <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}>
                      <div className="flex items-center gap-1">
                        {[0, 1, 2].map(d => <div key={d} className="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce" style={{ animationDelay: `${d * 150}ms` }} />)}
                      </div>
                    </div>
                  </motion.div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div className="shrink-0 px-4 pb-3 pt-1">
                <div className="flex items-end gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(27,34,48,0.5)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 4px 16px -8px rgba(0,0,0,0.3)' }}>
                  <button
                    className="shrink-0 p-1.5 rounded-lg text-white/15 hover:text-white/40 transition-colors cursor-not-allowed"
                    title="File uploads — coming soon (Phase 2.6)"
                    aria-label="Attach file (coming soon)"
                    onClick={(e) => { e.preventDefault(); addToast('File uploads coming soon', 'info'); }}>
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <textarea value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} onKeyDown={handleKeyDown} placeholder={`Message ${selectedAgent.name}...`} rows={1} className="flex-1 bg-transparent text-[13px] text-white/80 placeholder:text-white/15 outline-none resize-none py-1.5 max-h-[80px] scrollbar-thin" />
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={handleSendMessage} disabled={!inputMessage.trim()} className={`shrink-0 p-2 rounded-lg transition-all ${inputMessage.trim() ? 'bg-cyan-500/15 text-cyan-400' : 'text-white/10'}`}>
                    <Send className="h-3.5 w-3.5" />
                  </motion.button>
                </div>
                <p className="text-center text-[9px] text-white/8 mt-1">All agents share project context</p>
              </div>
            </>
          ) : (
            /* Empty state: no agent selected */
            <div className="flex-1 flex flex-col items-center justify-center">
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl mx-auto mb-4" style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.08), rgba(59,130,246,0.08))', border: '1px solid rgba(34,211,238,0.08)', boxShadow: '0 0 24px rgba(34,211,238,0.04)' }}>
                  <Sparkles className="h-6 w-6 text-cyan-400/30" />
                </div>
                <h3 className="text-[15px] font-semibold text-white/60 mb-1.5">{agents.length === 0 ? 'No agents yet' : 'Select an agent'}</h3>
                <p className="text-[12px] text-white/25 mb-5 max-w-xs mx-auto">
                  {agents.length === 0 ? 'Create your first AI agent to start collaborating on this project.' : 'Choose an agent from the sidebar to start chatting.'}
                </p>
                {agents.length === 0 && (
                  <button onClick={() => setShowCreateAgent(true)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white" style={{ background: 'linear-gradient(180deg, #1B2230, #11151C)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
                    <Plus className="h-4 w-4" /> Create Agent
                  </button>
                )}
              </motion.div>
            </div>
          )}
        </div>

        {/* RIGHT: Context & Tasks */}
        <div className="hidden xl:flex flex-col w-[260px] shrink-0 overflow-y-auto scrollbar-thin p-3 gap-3" style={{ background: 'rgba(17,21,28,0.3)', borderLeft: '1px solid rgba(255,255,255,0.04)' }}>
          {/* Shared Context — Phase 2.5: project memory + sync indicator */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-cyan-400/50" />
                <span className="text-[11px] font-semibold text-white/60">Project Context</span>
              </div>
              <button
                onClick={() => { setShowAddMemory(true); setNewMemoryContent(''); }}
                className="p-1 rounded-md text-white/30 hover:text-cyan-300 transition-colors"
                title="Add memory note for this project"
                aria-label="Add memory note">
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: memorySyncState === 'connected'
                    ? 'rgb(52,211,153)'
                    : memorySyncState === 'offline'
                      ? 'rgb(251,191,36)'
                      : 'rgb(148,163,184)',
                  boxShadow: memorySyncState === 'connected'
                    ? '0 0 4px rgba(52,211,153,0.3)'
                    : 'none',
                }}
              />
              <span
                className="text-[10px]"
                style={{
                  color: memorySyncState === 'connected'
                    ? 'rgba(52,211,153,0.7)'
                    : memorySyncState === 'offline'
                      ? 'rgba(251,191,36,0.7)'
                      : 'rgba(148,163,184,0.5)',
                }}>
                {memorySyncState === 'connected' && 'Project context active'}
                {memorySyncState === 'offline'   && 'Offline — local only'}
                {memorySyncState === 'unknown'   && 'Checking…'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: 'Agents',  value: `${agents.length}` },
                { label: 'Memory',  value: `${memory.length}` },
                { label: 'Messages', value: `${agents.reduce((acc, a) => acc + a.messages.length, 0)}` },
              ].map(s => (
                <div key={s.label} className="rounded-lg p-2 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <p className="text-[13px] font-semibold text-white/60">{s.value}</p>
                  <p className="text-[8px] text-white/20">{s.label}</p>
                </div>
              ))}
            </div>
            {/* Recent memory entries (latest 3, terse) */}
            {memory.length > 0 && (
              <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <p className="text-[9px] uppercase tracking-wider text-white/25">Recent memory</p>
                {memory.slice(0, 3).map((m) => (
                  <div key={m.id} className="text-[10px] text-white/55 leading-snug">
                    <span className="text-white/30 mr-1">
                      {m.kind === 'fact' ? '◆' : m.kind === 'decision' ? '★' : '·'}
                    </span>
                    {m.content.length > 70 ? m.content.slice(0, 70) + '…' : m.content}
                  </div>
                ))}
              </div>
            )}
            {/* Last synced timestamp — only shown after a successful sync */}
            {memorySyncedAt && memorySyncState === 'connected' && (
              <p className="text-[9px] text-white/15 mt-2">
                Last synced {new Date(memorySyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            {/* File upload placeholder — Phase 2.5: schema exists, UI hint only */}
            <div
              className="mt-3 pt-3 flex items-center gap-1.5 cursor-not-allowed"
              style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
              title="Project file uploads — coming soon. Backend schema is ready; upload pipeline lands in Phase 2.6.">
              <Paperclip className="h-3 w-3 text-white/15" />
              <span className="text-[9px] text-white/25">Files · coming soon</span>
            </div>
          </div>

          {/* Active Tasks — Phase 3.5: shows realtime SSE events when an
              orchestration is in flight; falls back to the per-agent
              static list otherwise so the demo design is preserved. */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-white/30" />
                <span className="text-[11px] font-semibold text-white/60">Recent Activity</span>
              </div>
              {/* Tiny SSE status indicator — matches Phase 2.5 sync dot pattern */}
              <div
                className="w-1.5 h-1.5 rounded-full"
                title={`Realtime: ${liveStatus}`}
                style={{
                  background:
                    liveStatus === 'connected' ? 'rgb(52,211,153)' :
                    liveStatus === 'connecting' ? 'rgb(148,163,184)' :
                    liveStatus === 'offline' ? 'rgb(251,191,36)' :
                    'rgb(100,116,139)',
                  boxShadow: liveStatus === 'connected' ? '0 0 4px rgba(52,211,153,0.3)' : 'none',
                }}
              />
            </div>
            {liveEvents.length > 0 ? (
              // SSE events available — render newest-first, capped to 6 lines.
              // Phase 3.7: maps raw event kinds into operator-friendly
              // status labels ("Planning" / "Delegating" / "Generating" /
              // "Completed") so the user can SEE the orchestration
              // executing instead of staring at engineer-speak event names.
              <div className="space-y-2">
                {liveEvents.slice(-6).reverse().map((evt, i) => {
                  const status = orchestrationStatusFor(evt);
                  return (
                    <div key={`${evt.kind}-${evt.emitted_at}-${i}`} className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full mt-0.5 shrink-0"
                        style={{
                          background: status.color,
                          boxShadow: status.pulse ? `0 0 4px ${status.color}55` : 'none',
                        }} />
                      <div className="min-w-0">
                        <p className="text-[10px] text-white/55 truncate">{status.label}</p>
                        <p className="text-[8px] text-white/15">
                          {new Date(evt.emitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : agents.length === 0 ? (
              <p className="text-[10px] text-white/15 text-center py-2">No activity yet</p>
            ) : (
              <div className="space-y-2">
                {agents.slice(0, 5).map((agent) => (
                  <div key={agent.id} className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full mt-0.5 shrink-0" style={{ background: agent.status === 'active' ? '#34d399' : '#94a3b8', boxShadow: agent.status === 'active' ? '0 0 4px rgba(52,211,153,0.3)' : 'none' }} />
                    <div>
                      <p className="text-[10px] text-white/45">{agent.name}</p>
                      <p className="text-[8px] text-white/15">{agent.lastActive}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Create Agent Modal ═══ */}
      <AnimatePresence>
        {showCreateAgent && (
          <CreateAgentModal onClose={() => setShowCreateAgent(false)} onCreate={handleCreateAgent} />
        )}
      </AnimatePresence>

      {/* ═══ Phase 2.5: Add Memory Modal ═══ */}
      <AnimatePresence>
        {showAddMemory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(8,10,14,0.7)', backdropFilter: 'blur(8px)' }}
            onClick={() => !memoryBusy && setShowAddMemory(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl p-5"
              style={{ background: 'rgba(20,24,32,0.95)', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 24px 64px -16px rgba(0,0,0,0.5)' }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-cyan-400/70" />
                  <h3 className="text-[14px] font-semibold text-white/85">Add project memory</h3>
                </div>
                <button
                  onClick={() => !memoryBusy && setShowAddMemory(false)}
                  className="p-1 rounded-md text-white/30 hover:text-white/60 transition-colors"
                  aria-label="Close">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-white/40 mb-3 leading-snug">
                Shared across every chat and agent in this project. Used by the AI as context — keep entries short and specific.
              </p>
              <div className="flex gap-1.5 mb-3">
                {(['note', 'fact', 'decision'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setNewMemoryKind(k)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${newMemoryKind === k ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/20' : 'bg-white/[0.03] text-white/40 border border-white/[0.04] hover:text-white/60'}`}>
                    {k === 'note' ? '· Note' : k === 'fact' ? '◆ Fact' : '★ Decision'}
                  </button>
                ))}
              </div>
              <textarea
                value={newMemoryContent}
                onChange={(e) => setNewMemoryContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAddMemory(); }
                }}
                rows={4}
                placeholder={
                  newMemoryKind === 'fact'
                    ? 'e.g. Tech stack: Next.js + FastAPI + Postgres'
                    : newMemoryKind === 'decision'
                      ? 'e.g. Pricing tiers — Free, Pro $29, Team $99'
                      : 'e.g. Targeting EU mid-market in Q1'
                }
                className="w-full rounded-lg text-[12px] text-white/85 placeholder:text-white/20 outline-none resize-none p-2.5 mb-3 scrollbar-thin"
                style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}
                autoFocus
                disabled={memoryBusy}
              />
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-white/20">
                  ⌘+Enter to save · {newMemoryContent.trim().length}/8000
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => !memoryBusy && setShowAddMemory(false)}
                    disabled={memoryBusy}
                    className="px-3 py-1.5 rounded-md text-[11px] text-white/50 hover:text-white/70 transition-colors">
                    Cancel
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleAddMemory}
                    disabled={!newMemoryContent.trim() || memoryBusy}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${(!newMemoryContent.trim() || memoryBusy) ? 'bg-white/[0.04] text-white/20 cursor-not-allowed' : 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'}`}>
                    {memoryBusy ? 'Saving…' : 'Save memory'}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════
   AGENT LIST ITEM
   ═══════════════════════════════════════════ */

function AgentListItem({ agent, isSelected, isEditing, menuOpen, onSelect, onRename, onDelete, onMenuToggle, onStartEdit, index }: {
  agent: ProjectAgent; isSelected: boolean; isEditing: boolean; menuOpen: boolean;
  onSelect: () => void; onRename: (name: string) => void; onDelete: () => void;
  onMenuToggle: () => void; onStartEdit: () => void; index: number;
}) {
  const [editValue, setEditValue] = useState(agent.name);
  const IconComp = ROLE_ICONS[agent.icon] || Bot;

  return (
    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }} className="relative">
      <button
        onClick={onSelect}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all group"
        style={{
          background: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
          border: isSelected ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
        }}
      >
        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${agent.gradient}`}>
          <IconComp className="h-3 w-3 text-white" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          {isEditing ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => onRename(editValue)}
              onKeyDown={(e) => { if (e.key === 'Enter') onRename(editValue); if (e.key === 'Escape') onRename(agent.name); }}
              className="w-full bg-transparent text-[11px] text-white/80 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <p className={`text-[11px] truncate ${isSelected ? 'text-white/80 font-medium' : 'text-white/50 group-hover:text-white/70'}`}>{agent.name}</p>
          )}
          <p className="text-[9px] text-white/20 truncate">{agent.role}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-1 h-1 rounded-full" style={{ background: agent.status === 'active' ? '#34d399' : '#94a3b8', boxShadow: agent.status === 'active' ? '0 0 3px rgba(52,211,153,0.3)' : 'none' }} />
          <button onClick={(e) => { e.stopPropagation(); onMenuToggle(); }} className="p-0.5 rounded text-white/10 hover:text-white/40 transition-colors opacity-0 group-hover:opacity-100">
            <MoreHorizontal className="h-3 w-3" />
          </button>
        </div>
      </button>

      {/* Dropdown menu */}
      {menuOpen && (
        <div className="absolute right-0 top-full mt-0.5 z-20 rounded-lg overflow-hidden" style={{ background: 'linear-gradient(180deg, #1B2230, #171C24)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          <button onClick={() => { onStartEdit(); onMenuToggle(); }} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-white/50 hover:text-white/80 hover:bg-white/[0.03] transition-all">
            <Pencil className="h-3 w-3" /> Rename
          </button>
          <button onClick={() => { onDelete(); }} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-red-400/50 hover:text-red-400 hover:bg-red-500/[0.04] transition-all">
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════
   CREATE AGENT MODAL
   ═══════════════════════════════════════════ */

function CreateAgentModal({ onClose, onCreate }: { onClose: () => void; onCreate: (roleId: string, name: string, customRole?: string) => void }) {
  const [selectedRole, setSelectedRole] = useState('');
  const [agentName, setAgentName] = useState('');
  const [customRole, setCustomRole] = useState('');
  const [errors, setErrors] = useState<{ name?: string; role?: string }>({});

  const isCustom = selectedRole === 'custom';
  const selectedRoleData = AGENT_ROLES.find(r => r.id === selectedRole);

  const handleCreate = () => {
    const errs: { name?: string; role?: string } = {};
    if (!agentName.trim()) errs.name = 'Name your agent';
    if (!selectedRole) errs.role = 'Select a role';
    if (isCustom && !customRole.trim()) errs.role = 'Describe the custom role';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    onCreate(selectedRole, agentName.trim(), isCustom ? customRole.trim() : undefined);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }} transition={{ duration: 0.2 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl p-6" style={{ background: 'linear-gradient(180deg, #1B2230, #171C24)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 24px 48px rgba(0,0,0,0.4)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[15px] font-semibold text-white/90">Create Agent</h2>
          <button onClick={onClose} className="text-white/25 hover:text-white/60 transition-colors"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="text-[11px] font-medium text-white/40 mb-1.5 block">Agent Name <span className="text-red-400/50">*</span></label>
            <input type="text" value={agentName} onChange={(e) => { setAgentName(e.target.value); if (errors.name) setErrors(p => ({ ...p, name: undefined })); }} placeholder="e.g., Frontend Dev" className="w-full px-3 py-2.5 rounded-xl text-[13px] text-white/80 placeholder:text-white/15 outline-none" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${errors.name ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.05)'}` }} />
            {errors.name && <p className="text-[10px] text-red-400/60 mt-1">{errors.name}</p>}
          </div>

          {/* Role */}
          <div>
            <label className="text-[11px] font-medium text-white/40 mb-2 block">Role <span className="text-red-400/50">*</span></label>
            <div className="grid grid-cols-2 gap-1.5">
              {AGENT_ROLES.map((role) => (
                <button key={role.id} onClick={() => { setSelectedRole(role.id); if (errors.role) setErrors(p => ({ ...p, role: undefined })); }}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] transition-all duration-200"
                  style={{
                    background: selectedRole === role.id ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.015)',
                    border: `1px solid ${selectedRole === role.id ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)'}`,
                    color: selectedRole === role.id ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
                  }}>
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${role.gradient}`}><div className="w-2 h-2 rounded-sm bg-white/80" /></div>
                  <span className="truncate">{role.label}</span>
                </button>
              ))}
            </div>
            {errors.role && <p className="text-[10px] text-red-400/60 mt-1">{errors.role}</p>}
          </div>

          {/* Custom role input */}
          <AnimatePresence>
            {isCustom && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <label className="text-[11px] font-medium text-white/40 mb-1.5 block">Custom Role</label>
                <input type="text" value={customRole} onChange={(e) => { setCustomRole(e.target.value); if (errors.role) setErrors(p => ({ ...p, role: undefined })); }} placeholder="Describe this agent's role..." className="w-full px-3 py-2.5 rounded-xl text-[13px] text-white/80 placeholder:text-white/15 outline-none" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${errors.role ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.05)'}` }} autoFocus />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Preview */}
          {selectedRoleData && (
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${selectedRoleData.gradient}`}>
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-[11px] text-white/60 font-medium">{agentName || selectedRoleData.label}</p>
                <p className="text-[9px] text-white/25">{selectedRoleData.description}</p>
              </div>
            </div>
          )}

          {/* Submit */}
          <button onClick={handleCreate} className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:brightness-110" style={{ background: 'linear-gradient(135deg, #22D3EE, #3B82F6)', boxShadow: '0 4px 16px rgba(34,211,238,0.15)' }}>
            Create Agent
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
