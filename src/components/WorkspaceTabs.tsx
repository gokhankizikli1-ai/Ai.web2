import { motion } from 'framer-motion';
import {
  MessageSquare, Search, TrendingUp, Building2, Bot,
  Code2, Rocket, GraduationCap, Palette,
} from 'lucide-react';
import type { WorkspaceTab } from '@/types';

const TABS: { id: WorkspaceTab; label: string; icon: typeof MessageSquare; color: string; activeColor: string }[] = [
  { id: 'chat',     label: 'Chat',     icon: MessageSquare,   color: 'text-slate-600', activeColor: 'text-cyan-400/70' },
  { id: 'coding',   label: 'Coding',   icon: Code2,           color: 'text-slate-600', activeColor: 'text-blue-400/70' },
  { id: 'research', label: 'Research', icon: Search,          color: 'text-slate-600', activeColor: 'text-violet-400/70' },
  { id: 'trading',  label: 'Trading',  icon: TrendingUp,      color: 'text-slate-600', activeColor: 'text-emerald-400/70' },
  { id: 'business', label: 'Business', icon: Building2,       color: 'text-slate-600', activeColor: 'text-amber-400/70' },
  { id: 'startup',  label: 'Startup',  icon: Rocket,          color: 'text-slate-600', activeColor: 'text-orange-400/70' },
  { id: 'agents',   label: 'Agents',   icon: Bot,             color: 'text-slate-600', activeColor: 'text-indigo-400/70' },
  { id: 'study',    label: 'Study',    icon: GraduationCap,   color: 'text-slate-600', activeColor: 'text-rose-400/70' },
  { id: 'creative', label: 'Creative', icon: Palette,         color: 'text-slate-600', activeColor: 'text-pink-400/70' },
];

interface WorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
}

export default function WorkspaceTabs({ activeTab, onTabChange }: WorkspaceTabsProps) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.015] border border-white/[0.03]">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-normal transition-all duration-200 ${
              isActive ? 'text-white' : 'text-slate-600 hover:text-slate-400'
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-white/[0.06] rounded-md border border-white/[0.08] shadow-[0_0_12px_-2px_rgba(255,255,255,0.03),inset_0_1px_1px_rgba(255,255,255,0.04)]"
                transition={{ type: 'spring', duration: 0.4, bounce: 0.1 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <tab.icon className={`h-3 w-3 transition-colors ${isActive ? tab.activeColor : ''}`} />
              <span className="hidden md:inline">{tab.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
