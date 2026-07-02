import { motion } from 'framer-motion';
import {
  Brain, MessageSquare, FileText, Lightbulb,
  Clock, CheckCircle2, AlertTriangle, Zap,
  FolderOpen, TrendingUp, Sparkles,
} from 'lucide-react';
import type { ProjectContext, ProjectMemory, ProjectTask } from '@/types/projects';

interface ProjectMemoryPanelProps {
  context: ProjectContext;
  memory: ProjectMemory[];
  tasks: ProjectTask[];
  activeAgentCount: number;
  totalAgentCount: number;
}

export default function ProjectMemoryPanel({
  context, memory, tasks, activeAgentCount, totalAgentCount,
}: ProjectMemoryPanelProps) {
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;

  const memoryIcons: Record<string, React.ElementType> = {
    knowledge: Sparkles,
    decision: Lightbulb,
    conversation: MessageSquare,
    resource: FileText,
  };

  const memoryColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    knowledge: { bg: 'bg-[#7EA6BF]/[0.06]', border: 'border-[#7EA6BF]/[0.12]', text: 'text-[#7EA6BF]', dot: 'bg-[#7EA6BF]' },
    decision: { bg: 'bg-[#7EA6BF]/[0.06]', border: 'border-[#7EA6BF]/[0.12]', text: 'text-[#7EA6BF]', dot: 'bg-[#7EA6BF]' },
    conversation: { bg: 'bg-[#7EA6BF]/[0.06]', border: 'border-[#7EA6BF]/[0.12]', text: 'text-[#7EA6BF]', dot: 'bg-[#7EA6BF]' },
    resource: { bg: 'bg-[#7EA6BF]/[0.06]', border: 'border-[#7EA6BF]/[0.12]', text: 'text-[#7EA6BF]', dot: 'bg-[#7EA6BF]' },
  };

  return (
    <div className="space-y-4">
      {/* Context Health */}
      <div
        className="rounded-xl p-3"
        style={{
          background: 'linear-gradient(180deg, rgba(27,34,48,0.5) 0%, rgba(17, 24, 32,0.6) 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5 text-[#7EA6BF]" />
            <span className="text-[11px] font-semibold text-white/70">Context Health</span>
          </div>
          <span className="text-[11px] font-bold text-[#7EA6BF]">{context.contextHealth}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#7EA6BF] to-[#9CBBD1]"
            initial={{ width: 0 }}
            animate={{ width: `${context.contextHealth}%` }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[9px] text-white/25">Last sync: {context.lastSync}</span>
          <div className="flex items-center gap-0.5">
            <Zap className="h-2.5 w-2.5 text-[#7EA6BF]/50" />
            <span className="text-[9px] text-white/25">Auto-sync on</span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: Brain, label: 'Shared Knowledge', value: `${context.sharedKnowledge.length} topics`, color: 'text-[#7EA6BF]' },
          { icon: MessageSquare, label: 'Conversations', value: `${context.syncedConversations}`, color: 'text-[#7EA6BF]' },
          { icon: FolderOpen, label: 'Resources', value: `${context.uploadedResources}`, color: 'text-[#7EA6BF]' },
          { icon: TrendingUp, label: 'Total Messages', value: `${context.totalMessages}`, color: 'text-[#7EA6BF]' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            className="rounded-lg p-2.5"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <stat.icon className={`h-3 w-3 ${stat.color} mb-1`} />
            <p className="text-[13px] font-semibold text-white/80">{stat.value}</p>
            <p className="text-[9px] text-white/30">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Active Agents */}
      <div
        className="rounded-xl p-3"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-white/70">Active Agents</span>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-[#6F8F7A] animate-pulse" />
            <span className="text-[10px] text-[#6F8F7A]">{activeAgentCount}/{totalAgentCount}</span>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#7EA6BF] to-[#9CBBD1]"
            style={{ width: `${(activeAgentCount / totalAgentCount) * 100}%` }}
          />
        </div>
      </div>

      {/* Task Summary */}
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-lg p-2 text-center" style={{ background: 'rgba(111,143,122,0.06)', border: '1px solid rgba(111,143,122,0.1)' }}>
          <CheckCircle2 className="h-3 w-3 text-[#6F8F7A] mx-auto mb-0.5" />
          <p className="text-[12px] font-semibold text-[#6F8F7A]">{completedTasks}</p>
          <p className="text-[8px] text-[#6F8F7A]/50">Done</p>
        </div>
        <div className="flex-1 rounded-lg p-2 text-center" style={{ background: 'rgba(126, 166, 191,0.06)', border: '1px solid rgba(126, 166, 191,0.1)' }}>
          <Clock className="h-3 w-3 text-[#7EA6BF] mx-auto mb-0.5" />
          <p className="text-[12px] font-semibold text-[#7EA6BF]">{inProgressTasks}</p>
          <p className="text-[8px] text-[#7EA6BF]/50">Active</p>
        </div>
        <div className="flex-1 rounded-lg p-2 text-center" style={{ background: 'rgba(166,138,91,0.06)', border: '1px solid rgba(166,138,91,0.1)' }}>
          <AlertTriangle className="h-3 w-3 text-[#A68A5B] mx-auto mb-0.5" />
          <p className="text-[12px] font-semibold text-[#A68A5B]">{tasks.filter(t => t.priority === 'critical').length}</p>
          <p className="text-[8px] text-[#A68A5B]/50">Critical</p>
        </div>
      </div>

      {/* Recent Decisions */}
      <div>
        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2 block">Recent Decisions</span>
        <div className="space-y-1.5">
          {context.recentDecisions.slice(0, 3).map((decision, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.06 }}
              className="flex items-start gap-2 p-2 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}
            >
              <Lightbulb className="h-3 w-3 text-[#7EA6BF]/60 shrink-0 mt-0.5" />
              <span className="text-[10px] text-white/50 leading-relaxed">{decision}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Memory Feed */}
      <div>
        <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2 block">Project Memory</span>
        <div className="space-y-1.5">
          {memory.slice(0, 4).map((mem, i) => {
            const colors = memoryColors[mem.type] || memoryColors.knowledge;
            const IconComp = memoryIcons[mem.type] || Sparkles;
            return (
              <motion.div
                key={mem.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.06 }}
                className={`rounded-lg p-2 ${colors.bg}`}
                style={{ border: `1px solid ${colors.border.replace('[0.12]', '[0.08]')}` }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <IconComp className={`h-3 w-3 ${colors.text}`} />
                  <span className="text-[10px] font-medium text-white/70 truncate">{mem.title}</span>
                </div>
                <p className="text-[9px] text-white/35 leading-relaxed line-clamp-2">{mem.content}</p>
                <div className="flex items-center gap-1 mt-1">
                  <div className={`w-1 h-1 rounded-full ${colors.dot}`} />
                  <span className="text-[8px] text-white/20">{mem.type}</span>
                  <span className="text-[8px] text-white/15 ml-auto">{Math.round(mem.confidence * 100)}% confidence</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
