import { motion } from 'framer-motion';
import { useNavigate } from 'react-router';
import {
  Bot, Clock, TrendingUp, ShoppingBag, Rocket,
  ChevronRight, Activity, FolderOpen,
} from 'lucide-react';
import type { Project } from '@/types/projects';

const iconMap: Record<string, React.ElementType> = {
  ShoppingBag, TrendingUp, Rocket, Code: FolderOpen,
  Bot, Activity,
};

const statusConfig = {
  active: { label: 'Active', bg: 'bg-emerald-500/[0.08]', text: 'text-emerald-400', dot: 'bg-emerald-400', pulse: true },
  draft: { label: 'Draft', bg: 'bg-amber-500/[0.08]', text: 'text-amber-400', dot: 'bg-amber-400', pulse: false },
  archived: { label: 'Archived', bg: 'bg-slate-500/[0.08]', text: 'text-slate-400', dot: 'bg-slate-400', pulse: false },
};

const categoryColor: Record<string, string> = {
  Ecommerce: 'text-emerald-400',
  Trading: 'text-cyan-400',
  Startup: 'text-amber-400',
  Development: 'text-indigo-400',
};

interface ProjectCardProps {
  project: Project;
  index: number;
}

export default function ProjectCard({ project, index }: ProjectCardProps) {
  const navigate = useNavigate();
  const status = statusConfig[project.status];
  const IconComp = iconMap[project.icon] || FolderOpen;
  const activeAgents = project.agents.filter(a => a.status === 'active').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      onClick={() => navigate(`/projects/${project.id}`)}
      className="group relative cursor-pointer"
    >
      {/* Card */}
      <div
        className="relative rounded-xl overflow-hidden transition-all duration-300 group-hover:border-white/[0.12]"
        style={{
          background: 'linear-gradient(180deg, rgba(27,34,48,0.7) 0%, rgba(17,21,28,0.8) 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
      >
        {/* Top accent bar */}
        <div className={`h-0.5 bg-gradient-to-r ${project.gradient} opacity-60`} />

        <div className="p-4">
          {/* Header row */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${project.gradient} bg-opacity-10`}
                style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
              >
                <IconComp className="h-4 w-4 text-white" />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-white/90 group-hover:text-white transition-colors">
                  {project.name}
                </h3>
                <span className={`text-[10px] font-medium ${categoryColor[project.category] || 'text-slate-400'}`}>
                  {project.category}
                </span>
              </div>
            </div>
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${status.bg}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status.dot} ${status.pulse ? 'animate-pulse' : ''}`} />
              <span className={`text-[10px] font-medium ${status.text}`}>{status.label}</span>
            </div>
          </div>

          {/* Description */}
          <p className="text-[11px] text-white/40 leading-relaxed mb-3 line-clamp-2">
            {project.description}
          </p>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-white/30">Progress</span>
              <span className="text-[10px] font-semibold text-white/60">{project.progress}%</span>
            </div>
            <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
              <motion.div
                className={`h-full rounded-full bg-gradient-to-r ${project.gradient}`}
                initial={{ width: 0 }}
                animate={{ width: `${project.progress}%` }}
                transition={{ delay: 0.3 + index * 0.1, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>

          {/* Footer stats */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Bot className="h-3 w-3 text-white/25" />
                <span className="text-[10px] text-white/40">{activeAgents}/{project.agents.length} agents</span>
              </div>
              <div className="flex items-center gap-1">
                <Activity className="h-3 w-3 text-white/25" />
                <span className="text-[10px] text-white/40">{project.tasks.filter(t => t.status === 'in_progress').length} tasks</span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-white/20 group-hover:text-white/50 transition-colors">
              <span className="text-[10px]">Open</span>
              <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>

          {/* Last updated */}
          <div className="flex items-center gap-1 mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <Clock className="h-2.5 w-2.5 text-white/20" />
            <span className="text-[9px] text-white/20">Updated {project.updatedAt}</span>
          </div>
        </div>

        {/* Hover glow */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
          style={{
            background: `radial-gradient(circle at 50% 0%, rgba(255,255,255,0.02) 0%, transparent 70%)`,
          }}
        />
      </div>
    </motion.div>
  );
}
