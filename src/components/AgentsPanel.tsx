import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot, Play, Pause, Settings, Clock, FileText, Cpu,
  CheckCircle2, Loader2, AlertTriangle,
  Search, Code2, BarChart3, Globe, Shield, Wand2,
  Activity,
} from 'lucide-react';
import type { Agent, AgentTask } from '@/types';

/* ─── 8 Agent Definitions ─── */
const INITIAL_AGENTS: Agent[] = [
  { id: 'a1', name: 'Code Reviewer',    status: 'running', description: 'Reviews code for quality, security, and performance', icon: 'Code2',    color: 'blue',    tasksCompleted: 147, tasksActive: 2, uptime: '99.2%', lastAction: 'Reviewed 3 PRs',    memoryUsed: '128 MB', capabilities: ['Code review', 'Security scan', 'Performance analysis'] },
  { id: 'a2', name: 'Research Analyst',  status: 'running', description: 'Deep research and synthesis across multiple sources', icon: 'Search',   color: 'violet',  tasksCompleted: 89,  tasksActive: 1, uptime: '98.7%', lastAction: 'Compiled NVDA report', memoryUsed: '256 MB', capabilities: ['Web search', 'Source ranking', 'Synthesis'] },
  { id: 'a3', name: 'Market Scanner',    status: 'running', description: 'Monitors markets for trading signals and opportunities', icon: 'BarChart3',color: 'emerald', tasksCompleted: 203, tasksActive: 3, uptime: '99.5%', lastAction: 'Detected 2 signals',   memoryUsed: '192 MB', capabilities: ['Signal detection', 'Risk analysis', 'Volatility scan'] },
  { id: 'a4', name: 'Startup Scout',     status: 'idle',    description: 'Discovers and evaluates startup opportunities', icon: 'Globe',    color: 'amber',   tasksCompleted: 56,  tasksActive: 0, uptime: '97.1%', lastAction: 'Scanned 12 startups',  memoryUsed: '64 MB',  capabilities: ['Market scanning', 'Idea generation', 'Competitor tracking'] },
  { id: 'a5', name: 'Security Auditor',  status: 'running', description: 'Scans for vulnerabilities and compliance issues', icon: 'Shield',   color: 'red',     tasksCompleted: 34,  tasksActive: 1, uptime: '98.3%', lastAction: 'Audit completed',      memoryUsed: '96 MB',  capabilities: ['Vulnerability scan', 'Compliance check', 'Threat detection'] },
  { id: 'a6', name: 'Data Parser',       status: 'paused',  description: 'Extracts and structures data from unstructured sources', icon: 'FileText', color: 'cyan',    tasksCompleted: 178, tasksActive: 0, uptime: '99.0%', lastAction: 'Parsed 5 documents',   memoryUsed: '160 MB', capabilities: ['PDF parsing', 'Data extraction', 'Schema mapping'] },
  { id: 'a7', name: 'Content Writer',    status: 'idle',    description: 'Generates and refines content across formats', icon: 'Wand2',    color: 'pink',    tasksCompleted: 312, tasksActive: 0, uptime: '98.9%', lastAction: 'Drafted blog post',    memoryUsed: '112 MB', capabilities: ['Blog writing', 'Email drafting', 'Copy editing'] },
  { id: 'a8', name: 'System Optimizer',  status: 'running', description: 'Monitors and optimizes system performance', icon: 'Cpu',      color: 'indigo',  tasksCompleted: 67,  tasksActive: 1, uptime: '99.8%', lastAction: 'Optimized cache',      memoryUsed: '80 MB',  capabilities: ['Cache optimization', 'Resource monitoring', 'Auto-scaling'] },
];

const AGENT_TASKS: AgentTask[] = [
  { id: 't1', label: 'Review pull request #247',       status: 'active',    agentId: 'a1', progress: 65,  duration: '2m 14s', timestamp: new Date() },
  { id: 't2', label: 'Deep research: AI chip market',  status: 'active',    agentId: 'a2', progress: 34,  duration: '5m 42s', timestamp: new Date() },
  { id: 't3', label: 'Scan AAPL daily signal',         status: 'completed', agentId: 'a3', progress: 100, duration: '1m 08s', timestamp: new Date() },
  { id: 't4', label: 'Security audit: auth service',   status: 'completed', agentId: 'a5', progress: 100, duration: '3m 22s', timestamp: new Date() },
  { id: 't5', label: 'Parse earnings PDFs',            status: 'pending',   agentId: 'a6', progress: 0,   duration: '--',     timestamp: new Date() },
  { id: 't6', label: 'Startup scan: fintech sector',   status: 'pending',   agentId: 'a4', progress: 0,   duration: '--',     timestamp: new Date() },
];

const ICON_MAP: Record<string, typeof Code2> = {
  Code2, Search, BarChart3, Globe, Shield, FileText, Wand2, Cpu,
};

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  blue:    { bg: 'bg-blue-500/[0.06]',    border: 'border-blue-500/12',    text: 'text-blue-400/80',    dot: 'bg-blue-400' },
  violet:  { bg: 'bg-violet-500/[0.06]',  border: 'border-violet-500/12',  text: 'text-violet-400/80',  dot: 'bg-violet-400' },
  emerald: { bg: 'bg-emerald-500/[0.06]', border: 'border-emerald-500/12', text: 'text-emerald-400/80', dot: 'bg-emerald-400' },
  amber:   { bg: 'bg-amber-500/[0.06]',   border: 'border-amber-500/12',   text: 'text-amber-400/80',   dot: 'bg-amber-400' },
  red:     { bg: 'bg-red-500/[0.06]',     border: 'border-red-500/12',     text: 'text-red-400/80',     dot: 'bg-red-400' },
  cyan:    { bg: 'bg-cyan-500/[0.06]',    border: 'border-cyan-500/12',    text: 'text-cyan-400/80',    dot: 'bg-cyan-400' },
  pink:    { bg: 'bg-pink-500/[0.06]',    border: 'border-pink-500/12',    text: 'text-pink-400/80',    dot: 'bg-pink-400' },
  indigo:  { bg: 'bg-indigo-500/[0.06]',  border: 'border-indigo-500/12',  text: 'text-indigo-400/80',  dot: 'bg-indigo-400' },
};

function StatusDot({ status, color }: { status: Agent['status']; color: string }) {
  const c = COLOR_MAP[color] || COLOR_MAP.blue;
  if (status === 'running') return (
    <span className="relative flex h-2 w-2">
      <span className={`absolute inline-flex h-full w-full rounded-full animate-ping`} style={{ backgroundColor: 'currentColor', color: 'rgba(52,211,153,0.4)', animationDuration: '2s' }} />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${c.dot}`} />
    </span>
  );
  if (status === 'paused') return <span className="h-2 w-2 rounded-full bg-amber-400/40" />;
  if (status === 'error') return <AlertTriangle className="h-2 w-2 text-red-400" />;
  return <span className="h-2 w-2 rounded-full bg-slate-600" />;
}

function StatusLabel({ status }: { status: Agent['status'] }) {
  const labels = { running: 'Active', idle: 'Idle', paused: 'Paused', error: 'Error' };
  const colors = { running: 'text-emerald-400/60', idle: 'text-slate-600', paused: 'text-amber-400/60', error: 'text-red-400/60' };
  return <span className={`text-[10px] ${colors[status]}`}>{labels[status]}</span>;
}

type AgentView = 'grid' | 'list' | 'tasks';

export default function AgentsPanel() {
  const [agents, setAgents] = useState(INITIAL_AGENTS);
  const [view, setView] = useState<AgentView>('grid');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [tasks] = useState(AGENT_TASKS);

  const toggleAgent = (id: string) => {
    setAgents((prev) => prev.map((a) => {
      if (a.id !== id) return a;
      const nextStatus = a.status === 'running' ? 'idle' : a.status === 'idle' ? 'running' : 'idle';
      return { ...a, status: nextStatus as Agent['status'] };
    }));
  };

  const runningCount = agents.filter((a) => a.status === 'running').length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.02]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/[0.08] border border-indigo-500/15">
            <Bot className="h-4 w-4 text-indigo-400" />
          </div>
          <div>
            <span className="text-[14px] font-semibold text-white">Agent OS</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.03]">
          {([
            { id: 'grid' as AgentView, label: 'Grid', icon: Bot },
            { id: 'list' as AgentView, label: 'List', icon: FileText },
            { id: 'tasks' as AgentView, label: 'Queue', icon: Activity },
          ]).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] transition-all ${
                view === v.id ? 'bg-white/[0.06] text-white' : 'text-slate-700 hover:text-slate-400'
              }`}
            >
              <v.icon className="h-2.5 w-2.5" />
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-px bg-white/[0.015] border-b border-white/[0.02]">
        {[
          { label: 'Running', value: runningCount.toString(), color: 'text-emerald-400' },
          { label: 'Total Agents', value: agents.length.toString(), color: 'text-white' },
          { label: 'Tasks Done', value: agents.reduce((a, ag) => a + ag.tasksCompleted, 0).toString(), color: 'text-cyan-400' },
          { label: 'Uptime', value: '98.9%', color: 'text-indigo-400' },
        ].map((s) => (
          <div key={s.label} className="px-4 py-2.5 text-center">
            <div className={`text-[13px] font-semibold ${s.color}`}>{s.value}</div>
            <div className="text-[9px] text-slate-700 mt-0.5 uppercase tracking-wider font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        {/* Grid View */}
        {view === 'grid' && (
          <div className="grid grid-cols-2 gap-2">
            {agents.map((agent, i) => {
              const c = COLOR_MAP[agent.color] || COLOR_MAP.blue;
              const Icon = ICON_MAP[agent.icon] || Code2;
              return (
                <motion.button
                  key={agent.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
                  className={`text-left rounded-xl border p-3.5 transition-all duration-200 ${
                    selectedAgent === agent.id
                      ? `${c.bg} ${c.border} shadow-[0_0_20px_-8px_rgba(0,0,0,0.3)]`
                      : 'border-white/[0.03] bg-white/[0.005] hover:bg-white/[0.015] hover:border-white/[0.05]'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.bg} border ${c.border}`}>
                      <Icon className={`h-3.5 w-3.5 ${c.text}`} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={agent.status} color={agent.color} />
                      <StatusLabel status={agent.status} />
                    </div>
                  </div>
                  <h4 className="text-[12px] font-medium text-slate-300 mb-0.5">{agent.name}</h4>
                  <p className="text-[10px] text-slate-600 leading-snug mb-2">{agent.description}</p>
                  <div className="flex items-center gap-2 text-[9px] text-slate-700">
                    <span className="flex items-center gap-0.5"><CheckCircle2 className="h-2.5 w-2.5" /> {agent.tasksCompleted}</span>
                    <span className="flex items-center gap-0.5"><Cpu className="h-2.5 w-2.5" /> {agent.memoryUsed}</span>
                  </div>

                  {/* Expanded detail */}
                  <AnimatePresence>
                    {selectedAgent === agent.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="pt-3 mt-3 border-t border-white/[0.03] space-y-2">
                          <div className="text-[10px] text-slate-600">
                            <span className="text-slate-700">Last action:</span> {agent.lastAction}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {agent.capabilities.map((cap) => (
                              <span key={cap} className="text-[9px] text-slate-500 bg-white/[0.02] border border-white/[0.03] px-1.5 py-[1px] rounded">
                                {cap}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleAgent(agent.id); }}
                              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] transition-all ${
                                agent.status === 'running'
                                  ? 'text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/[0.06]'
                                  : 'text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/[0.06]'
                              }`}
                            >
                              {agent.status === 'running' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                              {agent.status === 'running' ? 'Pause' : 'Start'}
                            </button>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-slate-600 hover:text-slate-400 hover:bg-white/[0.03] transition-all"
                            >
                              <Settings className="h-3 w-3" /> Config
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </div>
        )}

        {/* List View */}
        {view === 'list' && (
          <div className="space-y-1.5">
            {agents.map((agent, i) => {
              const c = COLOR_MAP[agent.color] || COLOR_MAP.blue;
              const Icon = ICON_MAP[agent.icon] || Code2;
              return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.02] bg-white/[0.005] p-3 hover:bg-white/[0.01] hover:border-white/[0.04] transition-all"
                >
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${c.bg} border ${c.border} shrink-0`}>
                    <Icon className={`h-3 w-3 ${c.text}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-slate-300">{agent.name}</span>
                      <StatusLabel status={agent.status} />
                    </div>
                    <p className="text-[10px] text-slate-600 truncate">{agent.description}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-700 shrink-0">
                    <span>{agent.tasksCompleted} tasks</span>
                    <span className="font-mono">{agent.memoryUsed}</span>
                  </div>
                  <button onClick={() => toggleAgent(agent.id)}
                    className="p-1.5 rounded text-slate-700 hover:text-slate-400 hover:bg-white/[0.03] transition-all"
                  >
                    {agent.status === 'running' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Tasks Queue View */}
        {view === 'tasks' && (
          <div className="space-y-3">
            {/* Active tasks */}
            <div>
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <Activity className="h-3 w-3 text-cyan-400/50" />
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Active Tasks</span>
              </div>
              {tasks.filter((t) => t.status === 'active').map((task, i) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 rounded-lg border border-cyan-500/[0.06] bg-cyan-500/[0.02] p-3 mb-1.5"
                >
                  <Loader2 className="h-3.5 w-3.5 text-cyan-400 animate-spin shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-slate-300">{task.label}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-20 h-[2px] bg-white/[0.03] rounded-full overflow-hidden">
                        <motion.div className="h-full bg-cyan-400/40 rounded-full" animate={{ width: `${task.progress}%` }} transition={{ duration: 0.5 }} />
                      </div>
                      <span className="text-[9px] text-cyan-400/50 font-mono">{task.progress}%</span>
                      <span className="text-[9px] text-slate-700">{task.duration}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
              {tasks.filter((t) => t.status === 'active').length === 0 && (
                <p className="text-[11px] text-slate-700 px-3 py-4 text-center">No active tasks</p>
              )}
            </div>

            {/* Pending */}
            <div>
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <Clock className="h-3 w-3 text-slate-700" />
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Pending</span>
              </div>
              {tasks.filter((t) => t.status === 'pending').map((task, i) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.02] bg-white/[0.005] p-2.5 mb-1 opacity-60"
                >
                  <div className="h-3.5 w-3.5 rounded-full border border-white/[0.06] shrink-0" />
                  <span className="text-[11px] text-slate-500">{task.label}</span>
                </motion.div>
              ))}
            </div>

            {/* Completed */}
            <div>
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-400/50" />
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">Completed</span>
              </div>
              {tasks.filter((t) => t.status === 'completed').map((task, i) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-3 rounded-lg border border-emerald-500/[0.04] bg-emerald-500/[0.01] p-2.5 mb-1"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/60 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] text-slate-400">{task.label}</span>
                  </div>
                  <span className="text-[9px] text-slate-700 font-mono">{task.duration}</span>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
