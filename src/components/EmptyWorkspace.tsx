import { useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Code, TrendingUp, Search, Building2, Bot,
  ArrowRight, Sparkles, Rocket, GraduationCap, Palette,
} from 'lucide-react';
import type { WorkspaceTab } from '@/types';

interface EmptyWorkspaceProps {
  onSend: (message: string) => void;
  workspace?: WorkspaceTab;
  compact?: boolean;
}

// Generic quick actions for default Chat workspace
const QUICK_ACTIONS = [
  { icon: Code, label: 'Write Code', description: 'Generate, debug, or refactor', prompt: 'Write a clean Python function that parses a CSV file and returns a summary of numeric columns', accent: 'cyan' },
  { icon: Search, label: 'Draft Content', description: 'Emails, docs, copy', prompt: 'Draft a professional email to a client explaining a 2-week project delay with a revised timeline', accent: 'blue' },
  { icon: TrendingUp, label: 'Analyze Data', description: 'Trends, forecasts, insights', prompt: 'Analyze the current market trends for AI-powered developer tools and provide a summary', accent: 'emerald' },
  { icon: Sparkles, label: 'Brainstorm', description: 'Ideas, strategies, plans', prompt: 'Brainstorm 10 innovative features for a modern AI-powered productivity app', accent: 'amber' },
  { icon: Search, label: 'Deep Research', description: 'Comprehensive topic analysis', prompt: 'Research the latest advances in transformer architectures and their practical implications', accent: 'violet' },
  { icon: TrendingUp, label: 'Financial Model', description: 'Projections, valuations', prompt: 'Build a 5-year revenue projection model for a SaaS startup growing from $0 to $10M ARR', accent: 'emerald' },
  { icon: Search, label: 'Translate', description: 'Multi-language support', prompt: 'Translate the following business email into Spanish, French, and Japanese', accent: 'blue' },
  { icon: Code, label: 'System Design', description: 'Architecture, infrastructure', prompt: 'Design a scalable system architecture for a real-time chat application handling 1M concurrent users', accent: 'cyan' },
];

const ACCENT_COLORS: Record<string, { bg: string; border: string; icon: string; glow: string }> = {
  cyan:    { bg: 'bg-cyan-500/[0.04]',    border: 'border-cyan-500/10',    icon: 'text-cyan-400/60',    glow: 'hover:shadow-[0_0_16px_-4px_rgba(34,211,238,0.1)]' },
  blue:    { bg: 'bg-blue-500/[0.04]',     border: 'border-blue-500/10',     icon: 'text-blue-400/60',     glow: 'hover:shadow-[0_0_16px_-4px_rgba(96,165,250,0.1)]' },
  emerald: { bg: 'bg-emerald-500/[0.04]',  border: 'border-emerald-500/10',  icon: 'text-emerald-400/60',  glow: 'hover:shadow-[0_0_16px_-4px_rgba(52,211,153,0.1)]' },
  amber:   { bg: 'bg-amber-500/[0.04]',    border: 'border-amber-500/10',    icon: 'text-amber-400/60',    glow: 'hover:shadow-[0_0_16px_-4px_rgba(251,191,36,0.1)]' },
  violet:  { bg: 'bg-violet-500/[0.04]',   border: 'border-violet-500/10',   icon: 'text-violet-400/60',   glow: 'hover:shadow-[0_0_16px_-4px_rgba(167,139,250,0.1)]' },
  indigo:  { bg: 'bg-indigo-500/[0.04]',   border: 'border-indigo-500/10',   icon: 'text-indigo-400/60',   glow: 'hover:shadow-[0_0_16px_-4px_rgba(129,140,248,0.1)]' },
  orange:  { bg: 'bg-orange-500/[0.04]',   border: 'border-orange-500/10',   icon: 'text-orange-400/60',   glow: 'hover:shadow-[0_0_16px_-4px_rgba(251,146,60,0.1)]' },
  rose:    { bg: 'bg-rose-500/[0.04]',     border: 'border-rose-500/10',     icon: 'text-rose-400/60',     glow: 'hover:shadow-[0_0_16px_-4px_rgba(251,113,133,0.1)]' },
  pink:    { bg: 'bg-pink-500/[0.04]',     border: 'border-pink-500/10',     icon: 'text-pink-400/60',     glow: 'hover:shadow-[0_0_16px_-4px_rgba(244,114,182,0.1)]' },
};

// Workspace-specific config
const WORKSPACE_CONFIG: Record<WorkspaceTab, { icon: typeof Code; title: string; subtitle: string; placeholder: string; accent: string }> = {
  chat: {
    icon: Sparkles,
    title: 'What do you want to build today?',
    subtitle: 'KorvixAI is your operating system for thought. Write, code, analyze, and create with context-aware intelligence.',
    placeholder: 'Type a message or select an action below...',
    accent: 'cyan',
  },
  coding: {
    icon: Code,
    title: 'Coding',
    subtitle: 'AI-powered coding assistant. Write, debug, refactor, and explain code in any language.',
    placeholder: 'Ask KorvixAI to write, debug, refactor, or explain code...',
    accent: 'blue',
  },
  research: {
    icon: Search,
    title: 'Research',
    subtitle: 'Deep research with multi-source synthesis. Ask KorvixAI to research, compare, verify, or summarize any topic.',
    placeholder: 'Ask KorvixAI to research, compare, verify, or summarize...',
    accent: 'violet',
  },
  trading: {
    icon: TrendingUp,
    title: 'Trading',
    subtitle: 'AI-powered market analysis and trading signals. Ask for market structure, signals, risk plans, or chart analysis.',
    placeholder: 'Ask for market structure, signals, risk plan, or chart analysis...',
    accent: 'emerald',
  },
  business: {
    icon: Building2,
    title: 'Business Intelligence',
    subtitle: 'Startup scanner, competitor analysis, and strategic insights. Ask for startup ideas, product research, competitors, or strategy.',
    placeholder: 'Ask for startup ideas, product research, competitors, ads, or strategy...',
    accent: 'amber',
  },
  startup: {
    icon: Rocket,
    title: 'Startup',
    subtitle: 'Validate ideas, research markets, build pitch decks, and plan growth strategies.',
    placeholder: 'Ask for startup ideas, validation, pitch review, or growth strategy...',
    accent: 'orange',
  },
  agents: {
    icon: Bot,
    title: 'AI Agents',
    subtitle: 'Deploy specialized AI agents for automated tasks. Tell an agent what to work on.',
    placeholder: 'Tell an agent what to work on...',
    accent: 'indigo',
  },
  study: {
    icon: GraduationCap,
    title: 'Study',
    subtitle: 'Learn anything with AI-powered explanations, quizzes, summaries, and study plans.',
    placeholder: 'Ask KorvixAI to explain, quiz, summarize, or create a study plan...',
    accent: 'rose',
  },
  creative: {
    icon: Palette,
    title: 'Creative',
    subtitle: 'Brainstorm, write stories, generate content, and explore creative ideas.',
    placeholder: 'Ask for creative writing, brainstorming, story ideas, or content...',
    accent: 'pink',
  },
};

export default function EmptyWorkspace({ onSend, workspace = 'chat', compact = false }: EmptyWorkspaceProps) {
  const config = WORKSPACE_CONFIG[workspace];
  const isGeneric = workspace === 'chat';
  const colors = ACCENT_COLORS[config.accent] || ACCENT_COLORS.cyan;

  // Auto-focus the textarea for non-chat workspaces
  useEffect(() => {
    if (!isGeneric) {
      const timer = setTimeout(() => {
        const el = document.querySelector('textarea') as HTMLTextAreaElement | null;
        if (el) el.focus();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isGeneric]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      <motion.div
        className="flex flex-col items-center max-w-xl w-full"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Icon */}
        <motion.div
          className={`relative flex h-12 w-12 items-center justify-center rounded-xl ${colors.bg} border ${colors.border} mb-8`}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          <config.icon className={`h-5 w-5 ${colors.icon}`} />
          <div className="absolute inset-0 rounded-xl bg-cyan-400/5 blur-xl -z-10" />
        </motion.div>

        {/* Heading */}
        <motion.h1
          className="text-[22px] sm:text-[26px] font-semibold text-white mb-2 text-center tracking-tight leading-tight"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          {config.title}
        </motion.h1>

        <motion.p
          className="text-[13px] text-slate-500 mb-10 text-center max-w-sm leading-relaxed"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          {config.subtitle}
        </motion.p>

        {/* Central input hint — always shown, workspace-specific placeholder */}
        <motion.div
          className={`w-full max-w-md mb-10 rounded-xl border border-white/[0.05] bg-white/[0.015] px-5 py-3.5 flex items-center gap-3 cursor-text transition-all duration-200 hover:${colors.glow} hover:bg-white/[0.02]`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.4 }}
          onClick={() => {
            const el = document.querySelector('textarea') as HTMLTextAreaElement | null;
            if (el) el.focus();
          }}
        >
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colors.bg} border ${colors.border}`}>
            <config.icon className={`h-3.5 w-3.5 ${colors.icon}`} />
          </div>
          <span className="text-[13px] text-slate-600">{config.placeholder}</span>
          <ArrowRight className="h-4 w-4 text-slate-700 ml-auto" />
        </motion.div>

        {/* Generic action cards — hidden in compact mode */}
        {isGeneric && !compact && (
          <motion.div
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full max-w-2xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4 }}
          >
            {QUICK_ACTIONS.map((action, i) => {
              const aColors = ACCENT_COLORS[action.accent] || ACCENT_COLORS.cyan;
              return (
                <motion.button
                  key={action.label}
                  onClick={() => onSend(action.prompt)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.03, duration: 0.3 }}
                  className={`flex flex-col items-start gap-2.5 rounded-xl border border-white/[0.04] bg-white/[0.01] p-4 text-left transition-all duration-200 hover:bg-white/[0.025] hover:border-white/[0.07] ${aColors.glow} group`}
                >
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${aColors.bg} border ${aColors.border} transition-colors`}>
                    <action.icon className={`h-4 w-4 ${aColors.icon}`} />
                  </div>
                  <div>
                    <div className="text-[12px] font-medium text-slate-300 group-hover:text-white transition-colors">{action.label}</div>
                    <div className="text-[11px] text-slate-600 mt-0.5">{action.description}</div>
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        )}

        {/* Trust footer */}
        <motion.div
          className="flex items-center gap-2 mt-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/50" />
          <span className="text-[11px] text-slate-600">Your data is encrypted and never used for training</span>
        </motion.div>
      </motion.div>
    </div>
  );
}
