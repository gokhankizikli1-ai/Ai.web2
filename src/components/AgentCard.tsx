import { motion } from 'framer-motion';
import {
  Bot, TrendingUp, Search, Megaphone, DollarSign, Globe,
  ShieldCheck, BookOpen, Rocket, BarChart3, Code, Layout,
  Server, Cloud, Palette, CheckCircle, Zap,
} from 'lucide-react';
import type { ProjectAgent } from '@/types/projects';

const iconMap: Record<string, React.ElementType> = {
  Bot, TrendingUp, Search, Megaphone, DollarSign, Globe,
  ShieldCheck, BookOpen, Rocket, BarChart3, Code, Layout,
  Server, Cloud, Palette, CheckCircle, Zap, Presentation: Rocket,
};

const statusConfig = {
  active: {
    dot: 'bg-[#6F8F7A]',
    shadow: '0 0 8px rgba(111,143,122,0.3)',
    label: 'Active',
  },
  idle: {
    dot: 'bg-[#A68A5B]',
    shadow: '0 0 6px rgba(166,138,91,0.2)',
    label: 'Idle',
  },
  syncing: {
    dot: 'bg-[#52677A]',
    shadow: '0 0 8px rgba(82,103,122,0.3)',
    label: 'Syncing',
  },
  offline: {
    dot: 'bg-slate-500',
    shadow: 'none',
    label: 'Offline',
  },
};

interface AgentCardProps {
  agent: ProjectAgent;
  isSelected: boolean;
  onClick: () => void;
  index: number;
}

export default function AgentCard({ agent, isSelected, onClick, index }: AgentCardProps) {
  const status = statusConfig[agent.status];
  const IconComp = iconMap[agent.icon] || Bot;

  return (
    <motion.button
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      onClick={onClick}
      className="w-full text-left group relative"
    >
      <div
        className={`relative rounded-lg px-2.5 py-2 transition-all duration-200 ${
          isSelected
            ? 'border-white/[0.12]'
            : 'border-transparent hover:border-white/[0.06]'
        }`}
        style={{
          background: isSelected
            ? 'linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)'
            : 'transparent',
          border: isSelected ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
          boxShadow: isSelected ? 'inset 0 1px 0 rgba(255,255,255,0.04)' : 'none',
        }}
      >
        <div className="flex items-center gap-2">
          {/* Avatar */}
          <div className="relative shrink-0">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br ${agent.gradient}`}
              style={{ boxShadow: `0 2px 6px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)` }}
            >
              <IconComp className="h-3.5 w-3.5 text-white" />
            </div>
            {/* Status dot */}
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${status.dot} border-2`}
              style={{ borderColor: isSelected ? 'rgba(32,39,54,1)' : '#171C24', boxShadow: status.shadow }}
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className={`text-[12px] font-medium truncate ${isSelected ? 'text-white' : 'text-white/70 group-hover:text-white/90'}`}>
                {agent.name}
              </span>
              {/* Context sync badge */}
              <div
                className="flex items-center gap-0.5 px-1 py-0.5 rounded-full shrink-0"
                style={{
                  background: agent.contextSync >= 90 ? 'rgba(111,143,122,0.1)' : 'rgba(166,138,91,0.1)',
                }}
              >
                <div
                  className="w-1 h-1 rounded-full"
                  style={{ background: agent.contextSync >= 90 ? '#6F8F7A' : '#A68A5B' }}
                />
                <span
                  className="text-[8px] font-medium"
                  style={{ color: agent.contextSync >= 90 ? '#6F8F7A' : '#A68A5B' }}
                >
                  {agent.contextSync}%
                </span>
              </div>
            </div>
            <span className="text-[10px] text-white/30 truncate block">
              {agent.role}
            </span>
          </div>
        </div>

        {/* Memory bar */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex-1 h-0.5 rounded-full bg-white/[0.04] overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${agent.gradient} opacity-60`}
              style={{ width: `${agent.memoryUsage}%` }}
            />
          </div>
          <span className="text-[8px] text-white/20 shrink-0">{agent.memoryUsage}%</span>
        </div>
      </div>
    </motion.button>
  );
}
