import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, ArrowLeft, Send, Sparkles, Zap,
  Palette, ShoppingBag, TrendingUp, Code, Search, Brain,
  MessageSquare, Check, User,
} from 'lucide-react';
import { buildAgentFromConversation, addStandaloneAgent, type StandaloneAgent } from '@/stores/standaloneAgentStore';
import { getProjects, addProjectAgent } from '@/stores/projectStore';
import { useToast } from '@/hooks/useToast';

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */

type Step = 'welcome' | 'specialty' | 'project' | 'tone' | 'memory' | 'preview' | 'chat';

interface ConversationMessage {
  id: string;
  sender: 'ai' | 'user';
  content: string;
  options?: string[];
  type?: 'text' | 'options' | 'preview';
}

interface AgentConfig {
  name: string;
  role: string;
  specialty: string;
  description: string;
  tone: StandaloneAgent['tone'];
  memoryMode: StandaloneAgent['memoryMode'];
  usageMode: StandaloneAgent['usageMode'];
  projectId?: string;
  projectName?: string;
}

/* ═══════════════════════════════════════════
   SUGGESTION CHIPS
   ═══════════════════════════════════════════ */

const SPECIALTY_CHIPS = [
  { label: 'Data Analysis / Reports', icon: TrendingUp },
  { label: 'Social Media Management', icon: Palette },
  { label: 'Web Research / News Tracking', icon: Search },
  { label: 'Email / Communication', icon: MessageSquare },
  { label: 'Finance / Stock Market', icon: TrendingUp },
  { label: 'Ecommerce / Shopify', icon: ShoppingBag },
  { label: 'Coding / Debugging', icon: Code },
  { label: 'Study / Tutoring', icon: Brain },
  { label: 'Other', icon: Sparkles },
];

/* ═══════════════════════════════════════════
   PREVIEW CARD
   ═══════════════════════════════════════════ */

function AgentPreviewCard({ config, onCreate, onEdit, onChat }: {
  config: AgentConfig; onCreate: () => void; onEdit: () => void; onChat: () => void;
}) {
  const gradients = [
    'from-[#9CBBD1] to-[#9CBBD1]',
    'from-[#9CBBD1] to-[#9CBBD1]',
    'from-[#86A88B] to-[#9CBBD1]',
    'from-[#C2A15A] to-[#C2A15A]',
    'from-[#9CBBD1] to-[#C98282]',
  ];
  const idx = Math.abs(config.specialty.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % gradients.length;

  return (
    <div className="rounded-2xl overflow-hidden" style={{
      background: 'linear-gradient(180deg, #1B2532, #171C24)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${gradients[idx]}`}>
            <Bot className="h-6 w-6 text-white" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-white/90">{config.name}</h3>
            <p className="text-[11px] text-white/40">{config.role}</p>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between py-1.5 border-b border-white/[0.03]">
            <span className="text-[10px] text-white/30">Specialty</span>
            <span className="text-[11px] text-white/60">{config.specialty}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 border-b border-white/[0.03]">
            <span className="text-[10px] text-white/30">Tone</span>
            <span className="text-[11px] text-white/60">{config.tone}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 border-b border-white/[0.03]">
            <span className="text-[10px] text-white/30">Memory</span>
            <span className="text-[11px] text-white/60">{config.memoryMode === 'project' ? 'Project Context' : 'Independent'}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 border-b border-white/[0.03]">
            <span className="text-[10px] text-white/30">Mode</span>
            <span className="text-[11px] text-white/60">{config.usageMode === 'project' ? `Project: ${config.projectName}` : 'Standalone'}</span>
          </div>
          {config.description && (
            <div className="py-1.5">
              <span className="text-[10px] text-white/30">Description</span>
              <p className="text-[11px] text-white/50 mt-1 leading-relaxed">{config.description}</p>
            </div>
          )}
        </div>

        {/* Capabilities */}
        <div className="mt-3 pt-3 border-t border-white/[0.04]">
          <span className="text-[9px] text-white/25 uppercase tracking-wider">Capabilities</span>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {['Natural Language', 'Context Awareness', 'Multi-step Reasoning', 'Memory Persistence'].map(c => (
              <span key={c} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.03] text-[9px] text-white/30 border border-white/[0.04]">
                <Check className="h-2 w-2 text-[#86A88B]/50" />
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 p-4" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <button
          onClick={onEdit}
          className="px-4 py-2 rounded-xl text-[12px] font-medium text-white/50 transition-all"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          Edit Details
        </button>
        <button
          onClick={onChat}
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-medium text-white/50 transition-all"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Test in Chat
        </button>
        <button
          onClick={onCreate}
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-semibold text-white transition-all hover:brightness-110"
          style={{
            background: 'linear-gradient(135deg, #9CBBD1, #8FB4CC)',
            boxShadow: '0 4px 16px rgba(126, 166, 191,0.15)',
          }}
        >
          <Zap className="h-3.5 w-3.5" />
          Create Agent
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CHAT MESSAGE
   ═══════════════════════════════════════════ */

function ChatMessage({ msg, onOptionClick }: { msg: ConversationMessage; onOptionClick?: (opt: string) => void }) {
  const isAI = msg.sender === 'ai';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isAI ? '' : 'flex-row-reverse'}`}
    >
      {/* Avatar */}
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isAI ? 'bg-[#8FB4CC]/[0.08] border border-[#8FB4CC]/15' : 'bg-white/[0.04] border border-white/[0.06]'}`}>
        {isAI ? <Sparkles className="h-3.5 w-3.5 text-[#9CBBD1]/70" /> : <User className="h-3.5 w-3.5 text-white/40" />}
      </div>

      {/* Content */}
      <div className={`max-w-[80%] ${isAI ? '' : 'text-right'}`}>
        <div
          className="inline-block rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed"
          style={{
            background: isAI ? 'rgba(255,255,255,0.03)' : 'rgba(126, 166, 191,0.06)',
            border: isAI ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(126, 166, 191,0.1)',
            color: isAI ? 'rgba(226,232,240,0.65)' : 'rgba(226,232,240,0.8)',
          }}
        >
          {msg.content}
        </div>

        {/* Options */}
        {msg.options && msg.options.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 mt-2 ${isAI ? '' : 'justify-end'}`}>
            {msg.options.map((opt) => (
              <motion.button
                key={opt}
                whileTap={{ scale: 0.97 }}
                onClick={() => onOptionClick?.(opt)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium text-white/60 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
                  (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
                }}
              >
                {opt}
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════
   MAIN BUILDER
   ═══════════════════════════════════════════ */

export default function AgentBuilder() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [step, setStep] = useState<Step>('welcome');
  const [config, setConfig] = useState<AgentConfig>({
    name: '', role: '', specialty: '', description: '', tone: 'Professional', memoryMode: 'independent', usageMode: 'standalone',
  });
  const [showPreview, setShowPreview] = useState(false);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, showPreview]);

  // Send initial welcome
  useEffect(() => {
    if (messages.length === 0) {
      addAIMessage(
        "What kind of agent do you want to create?",
        SPECIALTY_CHIPS.map(c => c.label)
      );
    }
  }, []);

  function addAIMessage(content: string, options?: string[]) {
    setMessages(prev => [...prev, {
      id: `ai-${Date.now()}`,
      sender: 'ai',
      content,
      options,
      type: options ? 'options' : 'text',
    }]);
  }

  function addUserMessage(content: string) {
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      sender: 'user',
      content,
    }]);
  }

  function deriveNameAndRole(specialty: string): { name: string; role: string } {
    const map: Record<string, { name: string; role: string }> = {
      'Data Analysis / Reports': { name: 'Data Analyst', role: 'Analytics Specialist' },
      'Social Media Management': { name: 'Social Manager', role: 'Social Media Strategist' },
      'Web Research / News Tracking': { name: 'Researcher', role: 'Research Analyst' },
      'Email / Communication': { name: 'Comms Assistant', role: 'Communication Specialist' },
      'Finance / Stock Market': { name: 'Finance Agent', role: 'Financial Analyst' },
      'Ecommerce / Shopify': { name: 'Shop Assistant', role: 'Ecommerce Specialist' },
      'Coding / Debugging': { name: 'Code Agent', role: 'Developer Assistant' },
      'Study / Tutoring': { name: 'Tutor', role: 'Education Assistant' },
    };
    return map[specialty] || { name: 'Assistant', role: 'General Purpose Agent' };
  }

  function deriveDescription(specialty: string, tone: string): string {
    return `An AI agent specialized in ${specialty.toLowerCase()}. Communicates in a ${tone.toLowerCase()} tone and adapts to your workflow.`;
  }

  async function handleUserResponse(text: string) {
    addUserMessage(text);

    switch (step) {
      case 'welcome':
      case 'specialty': {
        const spec = SPECIALTY_CHIPS.find(c => c.label === text)?.label || text;
        const { name, role } = deriveNameAndRole(spec);
        setConfig(prev => ({ ...prev, specialty: spec, name, role, description: deriveDescription(spec, prev.tone) }));
        setStep('project');
        await wait(400);
        addAIMessage(
          `Great! I'll create a **${role}** for you.\n\nWill this agent be standalone or inside a project?`,
          ['Standalone', 'Add to Project', 'Ask later']
        );
        break;
      }

      case 'project': {
        if (text === 'Standalone') {
          setConfig(prev => ({ ...prev, usageMode: 'standalone' as const }));
          setStep('tone');
          await wait(400);
          addAIMessage(
            "What tone should this agent use?",
            ['Professional', 'Friendly', 'Concise', 'Detailed']
          );
        } else if (text === 'Add to Project') {
          const projects = getProjects();
          if (projects.length === 0) {
            setConfig(prev => ({ ...prev, usageMode: 'standalone' as const }));
            setStep('tone');
            await wait(400);
            addAIMessage(
              "You don't have any projects yet. I'll set this as standalone for now.\n\nWhat tone should this agent use?",
              ['Professional', 'Friendly', 'Concise', 'Detailed']
            );
          } else {
            setStep('tone');
            await wait(400);
            addAIMessage(
              `What tone should this agent use?`,
              ['Professional', 'Friendly', 'Concise', 'Detailed']
            );
            // Store project selection for later
            setConfig(prev => ({ ...prev, usageMode: 'project' as const }));
          }
        } else {
          setConfig(prev => ({ ...prev, usageMode: 'standalone' as const }));
          setStep('tone');
          await wait(400);
          addAIMessage(
            "No problem! You can always add it to a project later.\n\nWhat tone should this agent use?",
            ['Professional', 'Friendly', 'Concise', 'Detailed']
          );
        }
        break;
      }

      case 'tone': {
        const tone = text as AgentConfig['tone'];
        setConfig(prev => ({ ...prev, tone, description: deriveDescription(prev.specialty, tone) }));
        setStep('memory');
        await wait(400);
        addAIMessage(
          "Should it use shared project memory or work independently?",
          ['Use Project Context', 'Independent Memory']
        );
        break;
      }

      case 'memory': {
        const memoryMode = text === 'Use Project Context' ? 'project' as const : 'independent' as const;
        setConfig(prev => ({ ...prev, memoryMode }));
        setStep('preview');
        await wait(400);
        addAIMessage(
          "Perfect! Here's what I've built for you. Take a look:"
        );
        await wait(300);
        setShowPreview(true);
        break;
      }

      case 'preview':
        // User can chat with the preview or click buttons
        addAIMessage(
          `You can click **Create Agent** to finalize, **Test in Chat** to try it out, or **Edit Details** to make changes.`,
          ['Create Agent', 'Test in Chat']
        );
        break;
    }
  }

  function handleOptionClick(opt: string) {
    if (showPreview) {
      if (opt === 'Create Agent') handleCreate();
      if (opt === 'Test in Chat') handleTestChat();
      return;
    }
    handleUserResponse(opt);
  }

  function handleSend() {
    if (!inputText.trim()) return;
    const text = inputText.trim();
    setInputText('');
    handleUserResponse(text);
  }

  async function handleCreate() {
    const agent = buildAgentFromConversation({
      name: config.name,
      role: config.role,
      specialty: config.specialty,
      description: config.description,
      tone: config.tone,
      memoryMode: config.memoryMode,
      usageMode: config.usageMode,
      projectId: config.projectId,
      projectName: config.projectName,
    });

    addStandaloneAgent(agent);

    // If attached to a project, also add to project agents
    if (config.projectId) {
      addProjectAgent(config.projectId, agent);
    }

    addToast(`Agent "${agent.name}" created`, 'success');

    // Navigate based on mode
    if (config.usageMode === 'project' && config.projectId) {
      navigate(`/projects/${config.projectId}`);
    } else {
      navigate(`/agents/${agent.id}`);
    }
  }

  function handleTestChat() {
    // Just show a message that they can chat after creation
    addAIMessage("You can start chatting with your agent right after creating it. Click **Create Agent** to begin!");
  }

  function handleEdit() {
    setShowPreview(false);
    setStep('specialty');
    addAIMessage(
      "Let's adjust your agent. What kind of agent do you want to create?",
      SPECIALTY_CHIPS.map(c => c.label)
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col" style={{ background: '#11151C', color: '#E2E8F0' }}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 h-14 border-b border-white/[0.04]">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/agents')} className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/60 transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-5 bg-white/10" />
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#8FB4CC]/[0.08] border border-[#8FB4CC]/15">
              <Bot className="h-3.5 w-3.5 text-[#9CBBD1]/70" />
            </div>
            <div>
              <h1 className="text-[13px] font-semibold text-white/90">Agent Creator</h1>
              <p className="text-[9px] text-white/30">Build your AI assistant</p>
            </div>
          </div>
        </div>
        {step === 'preview' && showPreview && (
          <button onClick={() => setShowPreview(false)} className="text-[10px] text-white/30 hover:text-white/60 transition-colors">
            Hide Preview
          </button>
        )}
      </div>

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin">
        {/* Subtle ambient */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[10%] right-[20%] w-[400px] h-[400px] rounded-full opacity-[0.015]" style={{ background: 'radial-gradient(circle, #8FB4CC 0%, transparent 70%)' }} />
        </div>

        {messages.map((msg) => (
          <ChatMessage key={msg.id} msg={msg} onOptionClick={handleOptionClick} />
        ))}

        {/* Preview Card */}
        <AnimatePresence>
          {showPreview && step === 'preview' && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              className="ml-10"
            >
              <AgentPreviewCard
                config={config}
                onCreate={handleCreate}
                onEdit={handleEdit}
                onChat={handleTestChat}
              />
            </motion.div>
          )}
        </AnimatePresence>
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
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type your response..."
            className="flex-1 bg-transparent text-[12px] text-white/70 placeholder:text-white/20 outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-all disabled:opacity-30"
            style={{
              background: inputText.trim() ? 'linear-gradient(135deg, #9CBBD1, #8FB4CC)' : 'rgba(255,255,255,0.04)',
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
   UTILS
   ═══════════════════════════════════════════ */

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}