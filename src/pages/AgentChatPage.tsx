import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import {
  Bot, ArrowLeft, Send, Sparkles, Zap, Shield,
  Trash2, FolderOpen, Star,
} from 'lucide-react';
import {
  getStandaloneAgent, addStandaloneAgentMessage, removeStandaloneAgent,
  type StandaloneAgent,
} from '@/stores/standaloneAgentStore';
import type { AgentMessage } from '@/types/projects';
import { useToast } from '@/hooks/useToast';

const ROLE_ICONS: Record<string, React.ElementType> = {
  Sparkles, Zap, Shield, Star, Bot,
};

export default function AgentChatPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [agent, setAgent] = useState<StandaloneAgent | null>(() =>
    agentId ? getStandaloneAgent(agentId) ?? null : null
  );
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  // Scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [agent?.messages, isTyping]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  if (!agent) {
    return (
      <div className="h-[100dvh] flex items-center justify-center" style={{ background: '#11151C' }}>
        <div className="text-center">
          <Bot className="h-8 w-8 text-white/10 mx-auto mb-3" />
          <p className="text-[13px] text-white/40 mb-3">Agent not found</p>
          <button
            onClick={() => navigate('/agents')}
            className="px-4 py-2 rounded-xl text-[12px] font-medium text-white/50 transition-all"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            Back to Agents
          </button>
        </div>
      </div>
    );
  }

  const IconComp = ROLE_ICONS[agent.icon] || Bot;

  function refresh() {
    if (agentId) {
      const updated = getStandaloneAgent(agentId);
      if (updated) setAgent(updated);
    }
  }

  async function handleSend() {
    if (!input.trim() || !agentId) return;
    const text = input.trim();
    setInput('');

    // Add user message
    const userMsg: AgentMessage = {
      id: `msg-${Date.now()}`,
      content: text,
      sender: 'user',
      timestamp: new Date().toISOString(),
      type: 'text',
    };
    addStandaloneAgentMessage(agentId, userMsg);
    refresh();

    // Simulate AI thinking
    setIsTyping(true);
    await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));

    // Generate response based on agent specialty
    if (!agent) return;
    const response = generateResponse(text, agent);
    const agentMsg: AgentMessage = {
      id: `msg-${Date.now()}-ai`,
      content: response,
      sender: 'agent',
      timestamp: new Date().toISOString(),
      type: 'text',
    };
    addStandaloneAgentMessage(agentId, agentMsg);
    setIsTyping(false);
    refresh();
  }

  function handleDelete() {
    if (!agentId) return;
    removeStandaloneAgent(agentId);
    addToast('Agent removed', 'success');
    navigate('/agents');
  }

  return (
    <div className="h-[100dvh] flex flex-col" style={{ background: '#11151C', color: '#E2E8F0' }}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 h-14 border-b border-white/[0.04]"
        style={{ background: 'linear-gradient(180deg, rgba(27,34,48,0.8), rgba(17,21,28,0.8))', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/agents')} className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-5 bg-white/10" />
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${agent.gradient}`}>
              <IconComp className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[13px] font-semibold text-white/90">{agent.name}</h1>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
                  agent.status === 'active' ? 'bg-emerald-500/[0.08] text-emerald-400' : 'bg-slate-500/[0.06] text-slate-400'
                }`}>
                  {agent.status === 'active' && <span className="w-1 h-1 rounded-full bg-emerald-400" />}
                  {agent.status}
                </span>
              </div>
              <p className="text-[10px] text-white/30">{agent.role} · {agent.tone}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {agent.projectId && (
            <button
              onClick={() => navigate(`/projects/${agent.projectId}`)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] text-cyan-400/60 transition-all"
              style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.08)' }}
            >
              <FolderOpen className="h-3 w-3" />
              {agent.projectName || 'Project'}
            </button>
          )}
          <button onClick={handleDelete} className="p-2 rounded-lg text-white/15 hover:text-red-400 hover:bg-red-500/[0.06] transition-all">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-4 scrollbar-thin">
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-[200px] right-[10%] w-[400px] h-[400px] rounded-full opacity-[0.012]" style={{ background: 'radial-gradient(circle, #6366F1 0%, transparent 70%)' }} />
        </div>

        {agent.messages.map((msg) => {
          const isAgent = msg.sender === 'agent';
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex gap-2.5 ${isAgent ? '' : 'flex-row-reverse'}`}
            >
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isAgent ? `bg-gradient-to-br ${agent.gradient}` : 'bg-white/[0.04] border border-white/[0.06]'}`}>
                {isAgent ? <IconComp className="h-3 w-3 text-white" /> : <div className="w-2 h-2 rounded-full bg-white/30" />}
              </div>
              <div
                className="max-w-[75%] rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap"
                style={{
                  background: isAgent ? 'rgba(255,255,255,0.025)' : 'rgba(34,211,238,0.04)',
                  border: isAgent ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(34,211,238,0.08)',
                  color: isAgent ? 'rgba(226,232,240,0.65)' : 'rgba(226,232,240,0.8)',
                }}
                dangerouslySetInnerHTML={{ __html: msg.content }}
              />
            </motion.div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 ml-9">
            <div className={`flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br ${agent.gradient}`}>
              <IconComp className="h-3 w-3 text-white" />
            </div>
            <div className="flex gap-1 px-3 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-white/20 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 pb-4 pt-2">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={`Message ${agent.name}...`}
            className="flex-1 bg-transparent text-[12px] text-white/70 placeholder:text-white/20 outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-all disabled:opacity-30"
            style={{
              background: input.trim() ? 'linear-gradient(135deg, #22D3EE, #3B82F6)' : 'rgba(255,255,255,0.04)',
            }}
          >
            <Send className="h-3 w-3 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   RESPONSE GENERATOR
   ═══════════════════════════════════════════ */

function generateResponse(userText: string, agent: StandaloneAgent): string {
  const lower = userText.toLowerCase();

  // Greetings
  if (/^(hi|hello|hey|yo|sup|hiya)/.test(lower)) {
    return `Hey there! I'm **${agent.name}**, your ${agent.role.toLowerCase()}. Ready to help with **${agent.specialty}**. What would you like to work on?`;
  }

  // Help
  if (/help|what can you do|capabilities/.test(lower)) {
    return `Here's what I can help you with as a **${agent.role}**:\n\n• **${agent.specialty}** - my core expertise\n• Multi-step analysis and reasoning\n• Context-aware responses with ${agent.memoryMode === 'project' ? 'project memory' : 'independent memory'}\n• ${agent.tone} communication style\n\nJust tell me what you need!`;
  }

  // Project-related
  if (lower.includes('project') && agent.projectId) {
    return `I'm currently synced with the **${agent.projectName || 'project'}** and using shared context. I can reference project knowledge, past decisions, and team conversations to give you better answers.\n\nWhat would you like to know?`;
  }

  // Status
  if (/status|how are you|what.*doing/.test(lower)) {
    return `I'm **active** and ready to assist! My context sync is at <strong>85%</strong> and memory usage is <strong>30%</strong>. I'm operating in **${agent.tone}** mode with **${agent.memoryMode === 'project' ? 'project context' : 'independent memory'}**.\n\nHow can I help today?`;
  }

  // Generic contextual responses
  const responses = [
    `Great question! As your **${agent.role}**, I'd approach this by analyzing the key factors in ${agent.specialty.toLowerCase()}. Let me break it down:\n\n1. First, I'd identify the core objectives\n2. Then gather relevant context and data\n3. Apply my expertise in ${agent.specialty.toLowerCase()}\n4. Deliver actionable insights\n\nWould you like me to dive deeper into any specific aspect?`,

    `Interesting! From my perspective as a **${agent.role}**, there are several angles to consider here:\n\n• The primary challenge in ${agent.specialty.toLowerCase()} is understanding the broader context\n• I can help you structure this systematically\n• My ${agent.tone.toLowerCase()} approach means I'll be thorough but focused\n\nWhat specific part should we tackle first?`,

    `I've got you covered. Here's how I can help as your **${agent.role}**:\n\nGiven my focus on **${agent.specialty}**, I'll analyze this with that lens in mind. I can break complex problems into manageable steps, track context across our conversation, and provide structured output.\n\nTell me more about what you're working on!`,

    `As your **${agent.role}**, let me think through this with you.\n\n**Context**: ${agent.specialty} domain\n**Approach**: ${agent.tone} analysis\n**Memory**: ${agent.memoryMode === 'project' ? 'Project-synced' : 'Independent'}\n\nI can help you brainstorm, analyze data, create structured plans, or simply think out loud. What direction would you like to go?`,
  ];

  // Pick deterministically based on user text
  const idx = Math.abs(userText.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % responses.length;
  return responses[idx];
}
