import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PanelRightClose, PanelRightOpen, Wrench,
  Brain, Cpu, Activity, Clock, Zap, Target,
  BookOpen, BarChart3, ChevronRight, Sparkles, Hash,
} from 'lucide-react';
import type { ChatSession, Message, AIMode } from '@/types';

interface RightSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  activeSession: ChatSession;
  activeTools: string[];
  aiMode: AIMode;
  pinnedMessages: Message[];
  memoryRefs: string[];
  isLoading: boolean;
  activeTab: string;
}

function ModeBadge({ mode }: { mode: AIMode }) {
  const labels: Record<AIMode, string> = {
    fast: 'Fast',
    'deep-think': 'Deep Think',
    research: 'Research',
    creative: 'Creative',
    coding: 'Coding',
    study: 'Study',
  };
  return (
    <span className="text-[11px] text-[#3B82F6]/70 bg-[#3B82F6]/[0.06] border border-[#3B82F6]/10 px-2 py-0.5 rounded-md">
      {labels[mode]}
    </span>
  );
}

function StatusPulse({ active }: { active: boolean }) {
  if (!active) return <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />;
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full rounded-full bg-[#60A5FA]/50 animate-ping" style={{ animationDuration: '2s' }} />
      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#60A5FA]" />
    </span>
  );
}

function MiniSparkline({ data, color = 'cyan' }: { data: number[]; color?: string }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 60;
  const h = 20;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} className={`text-${color}-400/40`} style={{ color: `var(--${color})` }}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.5}
      />
    </svg>
  );
}

export default function RightSidebar({
  isOpen,
  onToggle,
  activeSession,
  activeTools,
  aiMode,
  pinnedMessages,
  memoryRefs,
  isLoading,
  activeTab,
}: RightSidebarProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>('status');

  const toggleSection = (id: string) => {
    setExpandedSection((prev) => prev === id ? null : id);
  };

  // Mock sparkline data
  const sparkData = [12, 19, 15, 25, 22, 30, 28, 35, 32, 38, 42, 39, 45, 48, 52, 49, 55, 58, 62, 60];

  const sections = [
    {
      id: 'status',
      label: 'System Status',
      icon: Activity,
      content: (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusPulse active={isLoading} />
              <span className="text-[11px] text-[#CBD5E1]">{isLoading ? 'Processing' : 'Idle'}</span>
            </div>
            <ModeBadge mode={aiMode} />
          </div>
          {isLoading && (
            <div className="h-1 bg-white/[0.03] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-[#60A5FA]/40 rounded-full"
                animate={{ width: ['0%', '60%', '80%', '40%', '90%'] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          )}
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">Workspace</span>
            <span className="text-[#CBD5E1] capitalize">{activeTab}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">Messages</span>
            <span className="text-[#CBD5E1]">{activeSession.messages.length}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">Context size</span>
            <span className="text-[#CBD5E1] font-mono">{Math.round(activeSession.messages.reduce((a, m) => a + m.content.length, 0) / 1000 * 10) / 10}k</span>
          </div>
          <MiniSparkline data={sparkData} />
        </div>
      ),
    },
    {
      id: 'tools',
      label: 'Active Tools',
      icon: Wrench,
      content: (
        <div className="space-y-1.5">
          {activeTools.length === 0 ? (
            <p className="text-[11px] text-[#94A3B8]">No tools active</p>
          ) : (
            activeTools.map((tool) => (
              <div key={tool} className="flex items-center gap-2 text-[11px] text-[#CBD5E1]">
                <Zap className="h-3 w-3 text-[#60A5FA]/50" />
                {tool}
              </div>
            ))
          )}
          <div className="flex items-center gap-1.5 pt-1">
            <Sparkles className="h-3 w-3 text-[#3B82F6]/60" />
            <span className="text-[10px] text-[#94A3B8]">Auto-detection enabled</span>
          </div>
        </div>
      ),
    },
    {
      id: 'memory',
      label: 'Memory References',
      icon: Brain,
      content: (
        <div className="space-y-1.5">
          {memoryRefs.length === 0 ? (
            <p className="text-[11px] text-[#94A3B8]">No memory references yet</p>
          ) : (
            memoryRefs.map((ref, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] text-[#CBD5E1]">
                <Hash className="h-3 w-3 text-[#3B82F6]/60 mt-0.5 shrink-0" />
                <span className="truncate">{ref}</span>
              </div>
            ))
          )}
        </div>
      ),
    },
    {
      id: 'pinned',
      label: 'Pinned Messages',
      icon: BookOpen,
      content: (
        <div className="space-y-1.5">
          {pinnedMessages.length === 0 ? (
            <p className="text-[11px] text-[#94A3B8]">No pinned messages</p>
          ) : (
            pinnedMessages.slice(0, 3).map((msg) => (
              <div key={msg.id} className="text-[11px] text-[#CBD5E1] truncate border-l-2 border-[#60A5FA]/20 pl-2">
                {msg.content.slice(0, 60)}...
              </div>
            ))
          )}
        </div>
      ),
    },
    {
      id: 'recent',
      label: 'Recent Actions',
      icon: Clock,
      content: (
        <div className="space-y-2">
          {[
            { action: 'Context analyzed', time: '2s ago' },
            { action: 'Response generated', time: '4s ago' },
            { action: 'Memory indexed', time: '1m ago' },
          ].map((item, i) => (
            <div key={i} className="flex items-center justify-between text-[11px]">
              <span className="text-[#94A3B8]">{item.action}</span>
              <span className="text-[#94A3B8]">{item.time}</span>
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <>
      {/* Toggle button when closed */}
      {!isOpen && (
        <div className="fixed top-14 right-4 z-40 hidden lg:block">
          <button
            onClick={onToggle}
            className="h-7 w-7 flex items-center justify-center text-[#94A3B8] hover:text-[#CBD5E1] hover:bg-white/[0.03] rounded-md transition-all border border-white/[0.04]"
            title="Open sidebar"
          >
            <PanelRightOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: isOpen ? 220 : 0, opacity: isOpen ? 1 : 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="shrink-0 border-l border-white/[0.03] bg-[#11151C]/60 backdrop-blur-md overflow-hidden hidden lg:block"
      >
        {isOpen && (
          <div className="w-[220px] h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.02] shrink-0">
              <div className="flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-[#60A5FA]/50" />
                <span className="text-[11px] font-medium text-[#CBD5E1]">Context Panel</span>
              </div>
              <button
                onClick={onToggle}
                className="h-6 w-6 flex items-center justify-center text-[#94A3B8] hover:text-[#CBD5E1] hover:bg-white/[0.03] rounded transition-all"
              >
                <PanelRightClose className="h-3 w-3" />
              </button>
            </div>

            {/* Sections */}
            <div className="flex-1 overflow-y-auto scrollbar-thin py-2 px-2.5 space-y-0.5">
              {sections.map((section) => {
                const isExpanded = expandedSection === section.id;
                return (
                  <div key={section.id} className="rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleSection(section.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-2 text-left transition-all duration-150 rounded-lg ${
                        isExpanded ? 'bg-white/[0.03] text-white' : 'text-[#94A3B8] hover:text-slate-300 hover:bg-white/[0.015]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <section.icon className="h-3 w-3" />
                        <span className="text-[11px] font-medium">{section.label}</span>
                      </div>
                      <motion.div
                        animate={{ rotate: isExpanded ? 90 : 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <ChevronRight className="h-3 w-3" />
                      </motion.div>
                    </button>
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="px-2.5 pb-2.5 pt-1">
                            {section.content}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* Footer stats */}
            <div className="shrink-0 p-3 border-t border-white/[0.02] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-[#94A3B8]">
                  <Target className="h-2.5 w-2.5" />
                  Token usage
                </div>
                <span className="text-[10px] text-[#94A3B8] font-mono">-- / --</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-[#94A3B8]">
                  <BarChart3 className="h-2.5 w-2.5" />
                  Efficiency
                </div>
                <span className="text-[10px] text-[#94A3B8] font-mono">--</span>
              </div>
            </div>
          </div>
        )}
      </motion.aside>
    </>
  );
}
