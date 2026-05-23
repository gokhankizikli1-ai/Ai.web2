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
  removeProjectAgent, addAgentMessage, AGENT_ROLES, createAgent, uid,
} from '@/stores/projectStore';
import type { ProjectAgent, AgentMessage } from '@/types/projects';

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

    // Phase 2 — send to the real chat backend with project_id. The backend
    // injects a "Project Context" block (project description + recent
    // memory) into the system prompt so the agent's reply is grounded in
    // this project's shared memory. Falls back to a local placeholder on
    // any error so the chat never dead-ends (network down, backend cold,
    // ENABLE_PROJECTS off → 503 on /projects routes — chat itself still
    // works because project_id is silently ignored when the flag is off).
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

    const fallbackReply = () => {
      const responses = [
        "Great question! Let me think through this step by step.",
        "I've analyzed this for you. Here's what I found...",
        "Interesting approach. Let me provide some insights.",
        "Based on your project context, here's my recommendation.",
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    };

    (async () => {
      let replyText = '';
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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        replyText = String(data.reply ?? data.response ?? data.message ?? '').trim();
      } catch {
        // Swallow — fallback reply below keeps the conversation alive.
      }
      if (!replyText) replyText = fallbackReply();
      const agentMsg: AgentMessage = {
        id: `msg-${uid()}`, content: replyText, sender: 'agent',
        timestamp: new Date().toISOString(), type: 'text', agentId: selectedAgent.id,
      };
      if (projectId) addAgentMessage(projectId, selectedAgent.id, agentMsg);
      refreshAgents();
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
                        <p className="text-[12px] text-white/75 leading-relaxed">{msg.content}</p>
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
                  <button className="shrink-0 p-1.5 rounded-lg text-white/15 hover:text-white/40 transition-colors"><Paperclip className="h-4 w-4" /></button>
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
          {/* Shared Context */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-3.5 w-3.5 text-cyan-400/50" />
              <span className="text-[11px] font-semibold text-white/60">Project Context</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 4px rgba(52,211,153,0.3)' }} />
              <span className="text-[10px] text-emerald-400/60">{agents.length > 0 ? 'All agents synced' : 'No agents yet'}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: 'Agents', value: `${agents.length}` },
                { label: 'Messages', value: `${agents.reduce((acc, a) => acc + a.messages.length, 0)}` },
              ].map(s => (
                <div key={s.label} className="rounded-lg p-2 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}>
                  <p className="text-[13px] font-semibold text-white/60">{s.value}</p>
                  <p className="text-[8px] text-white/20">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Active Tasks */}
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-3.5 w-3.5 text-white/30" />
              <span className="text-[11px] font-semibold text-white/60">Recent Activity</span>
            </div>
            {agents.length === 0 ? (
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
