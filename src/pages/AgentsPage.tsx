import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Plus, Search, ArrowLeft, Sparkles,
  MessageSquare, FolderOpen, Trash2,
  Zap, Shield, TrendingUp, Palette, Rocket,
  ShoppingBag, Code, Search as SearchIcon,
  X,
} from 'lucide-react';
import {
  getStandaloneAgents, removeStandaloneAgent, searchStandaloneAgents,
  updateStandaloneAgent,
  type StandaloneAgent,
} from '@/stores/standaloneAgentStore';
import { addProjectAgent } from '@/stores/projectStore';
import { getProjects } from '@/stores/projectStore';
import { useToast } from '@/hooks/useToast';

const ROLE_ICONS: Record<string, React.ElementType> = {
  Layout: Palette, Server: Code, Search: SearchIcon, Rocket,
  ShoppingBag, TrendingUp, Palette, Sparkles, Code: Code, Bot,
};

/* ═══════════════════════════════════════════
   AGENT CARD
   ═══════════════════════════════════════════ */

function AgentCard({ agent, onChat, onAttach, onDelete }: {
  agent: StandaloneAgent; onChat: () => void; onAttach: () => void; onDelete: () => void;
}) {
  const IconComp = ROLE_ICONS[agent.icon] || Bot;
  const isProjectAttached = !!agent.projectId;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="group relative rounded-xl border border-white/[0.04] bg-white/[0.015] hover:border-white/[0.08] hover:bg-white/[0.025] transition-all duration-200 p-4"
    >
      {/* Top row */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${agent.gradient}`}>
          <IconComp className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-white/90 truncate">{agent.name}</h3>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
              agent.status === 'active' ? 'bg-[#6F8F7A]/[0.08] text-[#6F8F7A]' : 'bg-slate-500/[0.06] text-slate-400'
            }`}>
              {agent.status === 'active' && <span className="w-1 h-1 rounded-full bg-[#6F8F7A]" />}
              {agent.status}
            </span>
          </div>
          <p className="text-[11px] text-white/40 mt-0.5">{agent.role}</p>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onDelete} className="p-1 rounded text-white/15 hover:text-[#B76E79] hover:bg-[#B76E79]/[0.06] transition-all">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.03] text-[9px] text-white/30 border border-white/[0.04]">
          <Zap className="h-2.5 w-2.5" />
          {agent.tone}
        </span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.03] text-[9px] text-white/30 border border-white/[0.04]">
          <Shield className="h-2.5 w-2.5" />
          {agent.memoryMode === 'project' ? 'Project Context' : 'Independent'}
        </span>
        {isProjectAttached && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#52677A]/[0.06] text-[9px] text-[#52677A]/70 border border-[#52677A]/10">
            <FolderOpen className="h-2.5 w-2.5" />
            {agent.projectName || 'Project'}
          </span>
        )}
        {!isProjectAttached && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.03] text-[9px] text-white/25 border border-white/[0.04]">
            <Sparkles className="h-2.5 w-2.5" />
            Standalone
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onChat}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-medium text-white/80 transition-all"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
          }}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Chat
        </button>
        {!isProjectAttached && (
          <button
            onClick={onAttach}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium text-[#52677A]/70 transition-all"
            style={{
              background: 'rgba(34,211,238,0.04)',
              border: '1px solid rgba(34,211,238,0.08)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(34,211,238,0.08)';
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,211,238,0.15)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(34,211,238,0.04)';
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,211,238,0.08)';
            }}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════
   ATTACH TO PROJECT MODAL
   ═══════════════════════════════════════════ */

function AttachToProjectModal({ agent, onClose, onAttach }: {
  agent: StandaloneAgent; onClose: () => void; onAttach: (projectId: string, projectName: string) => void;
}) {
  const projects = getProjects();
  const [selected, setSelected] = useState('');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5"
        style={{
          background: 'linear-gradient(180deg, #1B2230, #171C24)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[14px] font-semibold text-white/90">Add to Project</h2>
          <button onClick={onClose} className="text-white/25 hover:text-white/60 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[11px] text-white/30 mb-3">Attach <span className="text-white/60 font-medium">{agent.name}</span> to a project</p>

        {projects.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-[11px] text-white/30">No projects yet</p>
          </div>
        ) : (
          <div className="space-y-1 mb-4 max-h-[200px] overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all"
                style={{
                  background: selected === p.id ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: `1px solid ${selected === p.id ? 'rgba(255,255,255,0.1)' : 'transparent'}`,
                }}
              >
                <div className={`flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br ${p.gradient}`}>
                  <FolderOpen className="h-3 w-3 text-white" />
                </div>
                <span className={`text-[12px] ${selected === p.id ? 'text-white/90' : 'text-white/50'}`}>{p.name}</span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => {
            const p = projects.find(pr => pr.id === selected);
            if (p) onAttach(p.id, p.name);
          }}
          disabled={!selected}
          className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all disabled:opacity-30"
          style={{
            background: 'linear-gradient(135deg, #52677A, #7890A3)',
            boxShadow: '0 4px 16px rgba(34,211,238,0.15)',
          }}
        >
          Attach to Project
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════ */

export default function AgentsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [search, setSearch] = useState('');
  const [agents, setAgents] = useState<StandaloneAgent[]>(getStandaloneAgents);
  const [attachAgent, setAttachAgent] = useState<StandaloneAgent | null>(null);

  const filtered = useMemo(() => searchStandaloneAgents(search), [search, agents]);

  const refresh = () => setAgents(getStandaloneAgents());

  const handleDelete = (id: string) => {
    removeStandaloneAgent(id);
    refresh();
    addToast('Agent removed', 'success');
  };

  const handleAttach = (projectId: string, projectName: string) => {
    if (!attachAgent) return;
    // Add to project agents
    addProjectAgent(projectId, attachAgent);
    // Update standalone agent to reflect attachment
    updateStandaloneAgent(attachAgent.id, { projectId, projectName, usageMode: 'project' as const });
    refresh();
    setAttachAgent(null);
    addToast(`Agent attached to ${projectName}`, 'success');
  };

  return (
    <div className="min-h-[100dvh]" style={{ background: '#11151C', color: '#E2E8F0' }}>
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[300px] right-[10%] w-[500px] h-[500px] rounded-full opacity-[0.025]" style={{ background: 'radial-gradient(circle, #52677A 0%, transparent 70%)' }} />
      </div>

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-4 pb-20">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/chat')} className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <div className="w-px h-5 bg-white/10" />
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#52677A]/[0.08] border border-[#52677A]/15">
              <Bot className="h-4 w-4 text-[#52677A]/70" />
            </div>
            <div>
              <h1 className="text-[16px] font-semibold text-white/90">Agents</h1>
              <p className="text-[10px] text-white/30">Create and manage your AI agents</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/agents/builder')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold text-white transition-all hover:brightness-110"
            style={{
              background: 'linear-gradient(135deg, #52677A, #7890A3)',
              boxShadow: '0 4px 16px rgba(34,211,238,0.15)',
            }}
          >
            <Plus className="h-4 w-4" />
            Create Agent
          </button>
        </div>

        {/* Search */}
        {agents.length > 0 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="w-full h-9 pl-9 pr-3 rounded-xl text-[12px] text-white/70 placeholder:text-white/20 outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}
            />
          </div>
        )}

        {/* Agent Grid */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence>
              {filtered.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onChat={() => navigate(`/agents/${agent.id}`)}
                  onAttach={() => setAttachAgent(agent)}
                  onDelete={() => handleDelete(agent.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl mb-4"
              style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
                border: '1px solid rgba(139,92,246,0.12)',
                boxShadow: '0 0 24px rgba(139,92,246,0.04)',
              }}
            >
              <Bot className="h-7 w-7 text-[#52677A]/30" />
            </div>
            <h2 className="text-[15px] font-semibold text-white/60 mb-1.5">No agents yet</h2>
            <p className="text-[12px] text-white/25 mb-6 max-w-xs">
              Create your first custom AI agent. They can work standalone or inside projects.
            </p>
            <button
              onClick={() => navigate('/agents/builder')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-all hover:brightness-110"
              style={{
                background: 'linear-gradient(135deg, #52677A, #7890A3)',
                boxShadow: '0 4px 16px rgba(34,211,238,0.15)',
              }}
            >
              <Plus className="h-4 w-4" />
              Create Agent
            </button>
          </motion.div>
        )}
      </div>

      {/* Attach Modal */}
      <AnimatePresence>
        {attachAgent && (
          <AttachToProjectModal
            agent={attachAgent}
            onClose={() => setAttachAgent(null)}
            onAttach={handleAttach}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
