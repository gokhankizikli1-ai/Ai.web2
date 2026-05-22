import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Loader2, Brain, Target, TrendingUp,
  DollarSign, Shield, CheckCircle2,
  Sparkles, Zap, CircleDot,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const AGENTS = [
  { id: 'research', name: 'Research Agent', role: 'Data Collection', icon: Brain, color: 'text-violet-400', bg: 'bg-violet-500/[0.06]', desc: 'Gathers market data, competitor info, and trends' },
  { id: 'strategy', name: 'Strategy Agent', role: 'Planning', icon: Target, color: 'text-blue-400', bg: 'bg-blue-500/[0.06]', desc: 'Creates action plans and prioritizes initiatives' },
  { id: 'marketing', name: 'Marketing Agent', role: 'Execution', icon: TrendingUp, color: 'text-rose-400', bg: 'bg-rose-500/[0.06]', desc: 'Generates campaigns, copy, and growth tactics' },
  { id: 'finance', name: 'Finance Agent', role: 'Analysis', icon: DollarSign, color: 'text-emerald-400', bg: 'bg-emerald-500/[0.06]', desc: 'Evaluates costs, pricing, and ROI projections' },
  { id: 'reviewer', name: 'Reviewer Agent', role: 'QA', icon: Shield, color: 'text-amber-400', bg: 'bg-amber-500/[0.06]', desc: 'Validates output quality and checks for errors' },
];

const STEPS = [
  { agent: 'Research Agent', action: 'Gathering market data and competitor analysis...', status: 'completed' },
  { agent: 'Strategy Agent', action: 'Developing go-to-market plan and prioritization...', status: 'completed' },
  { agent: 'Marketing Agent', action: 'Creating campaign copy and channel strategy...', status: 'active' },
  { agent: 'Finance Agent', action: 'Calculating projected ROI and pricing model...', status: 'queued' },
  { agent: 'Reviewer Agent', action: 'Final quality review and validation...', status: 'queued' },
];

export default function MultiAgentSwarm() {
  const [task, setTask] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  const handleRun = () => {
    if (!task.trim()) return;
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

          <motion.div {...fadeUp(0)} className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/[0.1] border border-cyan-500/15">
                <Users className="h-4 w-4 text-cyan-400" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">Multi-Agent Swarm</h1>
            </div>
            <p className="text-[13px] text-slate-500 ml-11">Assign complex tasks to multiple AI agents working together</p>
          </motion.div>

          {/* Agent Cards */}
          <motion.div {...fadeUp(0.05)} className="mb-6">
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {AGENTS.map((agent, i) => (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-white/[0.03] bg-white/[0.01] min-w-[100px]"
                >
                  <div className={`p-2 rounded-lg ${agent.bg}`}>
                    <agent.icon className={`w-4 h-4 ${agent.color}`} />
                  </div>
                  <span className="text-[10px] font-medium text-white text-center">{agent.name}</span>
                  <span className="text-[9px] text-slate-600">{agent.role}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Task Input */}
          <motion.div {...fadeUp(0.1)} className="mb-6">
            <div className="flex gap-2">
              <input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe a complex task for the agent swarm..."
                className="flex-1 h-12 px-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[14px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/20 focus:bg-white/[0.03] transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleRun()}
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleRun}
                disabled={generating || !task.trim()}
                className="h-12 px-6 rounded-xl bg-cyan-500/[0.1] border border-cyan-500/15 text-cyan-400 font-medium text-[13px] hover:bg-cyan-500/[0.15] transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Run Swarm
              </motion.button>
            </div>
          </motion.div>

          {/* Execution Timeline */}
          {generated && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              {/* Steps */}
              <div className="p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
                  <CircleDot className="w-4 h-4 text-cyan-400" /> Execution Timeline
                </h3>
                <div className="space-y-0">
                  {STEPS.map((step, i) => (
                    <div key={i} className="flex items-start gap-3 relative">
                      {/* Connector line */}
                      {i < STEPS.length - 1 && (
                        <div className="absolute left-[7px] top-6 w-px h-full bg-white/[0.04]" />
                      )}
                      {/* Status dot */}
                      <div className="mt-1 shrink-0">
                        {step.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                        {step.status === 'active' && (
                          <motion.div
                            className="w-3.5 h-3.5 rounded-full bg-cyan-400"
                            animate={{ opacity: [0.4, 1, 0.4] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          />
                        )}
                        {step.status === 'queued' && <div className="w-3.5 h-3.5 rounded-full border border-slate-600" />}
                      </div>
                      <div className="pb-4 flex-1">
                        <p className="text-[12px] font-medium text-white">{step.agent}</p>
                        <p className="text-[11px] text-slate-500">{step.action}</p>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        step.status === 'completed' ? 'bg-emerald-500/[0.08] text-emerald-400' :
                        step.status === 'active' ? 'bg-cyan-500/[0.08] text-cyan-400' :
                        'bg-slate-500/[0.08] text-slate-500'
                      }`}>
                        {step.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Final Synthesis */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="p-5 rounded-2xl border border-cyan-500/10 bg-cyan-500/[0.02]"
              >
                <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-cyan-400" /> Synthesis
                </h3>
                <p className="text-[13px] text-slate-400 leading-relaxed">
                  Based on research across market data, competitor positioning, and growth metrics, the recommended approach prioritizes channel X for initial traction due to lower CAC and higher audience alignment. Marketing should focus on [specific angle] while finance recommends a freemium model to maximize user acquisition. Quality review confirms all data sources are within confidence thresholds.
                </p>
                <div className="flex gap-3 mt-4">
                  <div className="px-3 py-1.5 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/10">
                    <span className="text-[10px] text-emerald-400">Confidence: 87%</span>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-blue-500/[0.06] border border-blue-500/10">
                    <span className="text-[10px] text-blue-400">Sources: 12</span>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-purple-500/[0.06] border border-purple-500/10">
                    <span className="text-[10px] text-purple-400">Agents: 5</span>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {!generated && !generating && (
            <motion.div {...fadeUp(0.15)} className="text-center py-16">
              <Users className="w-12 h-12 text-[#64748B] mx-auto mb-4" />
              <h3 className="text-sm font-medium text-white mb-1">Describe a complex task</h3>
              <p className="text-[12px] text-slate-500">Multiple AI agents will collaborate to research, plan, execute, and validate</p>
            </motion.div>
          )}

        </div>
      </div>
    </div>
  );
}
