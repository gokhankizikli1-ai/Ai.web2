import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search, Database, Brain, Sparkles, CheckCircle2,
  Loader2, Timer, Zap, Shield,
} from 'lucide-react';

interface TimelineStep {
  id: string;
  label: string;
  description: string;
  icon: typeof Search;
  status: 'pending' | 'active' | 'completed';
  duration?: string;
}

const DEFAULT_STEPS: TimelineStep[] = [
  { id: '1', label: 'Searching Sources', description: 'Scanning web, docs, and knowledge base', icon: Search, status: 'completed', duration: '0.8s' },
  { id: '2', label: 'Ranking Information', description: 'Evaluating relevance and credibility', icon: Database, status: 'completed', duration: '1.2s' },
  { id: '3', label: 'Building Synthesis', description: 'Combining insights across sources', icon: Brain, status: 'active', duration: '2.1s' },
  { id: '4', label: 'Verifying Consistency', description: 'Cross-checking facts and data', icon: Shield, status: 'pending', duration: '0.9s' },
  { id: '5', label: 'Preparing Response', description: 'Formatting final output', icon: Sparkles, status: 'pending', duration: '0.5s' },
];

interface AgentTimelineProps {
  isVisible: boolean;
  steps?: TimelineStep[];
}

function StatusIcon({ status }: { status: TimelineStep['status'] }) {
  if (status === 'completed') {
    return (
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        className="h-5 w-5 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center"
      >
        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
      </motion.div>
    );
  }
  if (status === 'active') {
    return (
      <div className="h-5 w-5 rounded-full bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center">
        <Loader2 className="h-3 w-3 text-cyan-400 animate-spin" />
      </div>
    );
  }
  return (
    <div className="h-5 w-5 rounded-full bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
      <div className="h-1.5 w-1.5 rounded-full bg-slate-700" />
    </div>
  );
}

function ConnectorLine({ status }: { status: 'before-active' | 'active' | 'after-active' }) {
  if (status === 'before-active') {
    return (
      <div className="w-[2px] h-full bg-emerald-500/20" />
    );
  }
  if (status === 'active') {
    return (
      <div className="w-[2px] h-full relative overflow-hidden">
        <div className="absolute inset-0 bg-white/[0.03]" />
        <motion.div
          className="absolute top-0 left-0 w-full bg-cyan-400/30"
          animate={{ height: ['0%', '100%'] }}
          transition={{ duration: 2, ease: 'easeInOut' }}
        />
      </div>
    );
  }
  return <div className="w-[2px] h-full bg-white/[0.02]" />;
}

export default function AgentTimeline({ isVisible, steps = DEFAULT_STEPS }: AgentTimelineProps) {
  const [displaySteps, setDisplaySteps] = useState(steps);

  useEffect(() => {
    if (!isVisible) return;
    const mkStep = (idx: number, completedUpTo: number, activeAt: number): TimelineStep['status'] => {
      if (idx <= completedUpTo) return 'completed';
      if (idx === activeAt) return 'active';
      return 'pending';
    };
    const timers = [
      setTimeout(() => setDisplaySteps((s) => s.map((step, i) => ({ ...step, status: mkStep(i, 1, 2) }))), 0),
      setTimeout(() => setDisplaySteps((s) => s.map((step, i) => ({ ...step, status: mkStep(i, 2, 3) }))), 3000),
      setTimeout(() => setDisplaySteps((s) => s.map((step, i) => ({ ...step, status: mkStep(i, 3, 4) }))), 5500),
      setTimeout(() => setDisplaySteps((s) => s.map((step) => ({ ...step, status: 'completed' as const }))), 7500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isVisible]);

  if (!isVisible) return null;

  const activeIndex = displaySteps.findIndex((s) => s.status === 'active');
  const completedCount = displaySteps.filter((s) => s.status === 'completed').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-3xl mx-auto px-4 pb-3"
    >
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] backdrop-blur-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.03]">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-cyan-400/60" />
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Execution Pipeline</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-16 h-1 bg-white/[0.03] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-cyan-400/40 rounded-full"
                animate={{ width: `${(completedCount / displaySteps.length) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <span className="text-[10px] text-slate-600 font-mono">{completedCount}/{displaySteps.length}</span>
          </div>
        </div>

        {/* Steps */}
        <div className="px-4 py-3">
          <div className="space-y-0">
            {displaySteps.map((step, i) => {
              const isLast = i === displaySteps.length - 1;
              const connectorStatus = i < activeIndex ? 'before-active' : i === activeIndex ? 'active' : 'after-active';

              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1, duration: 0.3 }}
                  className="flex"
                >
                  {/* Left column - icon + connector */}
                  <div className="flex flex-col items-center mr-3">
                    <StatusIcon status={step.status} />
                    {!isLast && (
                      <div className="h-6 py-0.5">
                        <ConnectorLine status={connectorStatus} />
                      </div>
                    )}
                  </div>

                  {/* Right column - content */}
                  <div className="flex-1 pb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-medium ${
                        step.status === 'completed' ? 'text-emerald-400/70' :
                        step.status === 'active' ? 'text-cyan-400' :
                        'text-slate-600'
                      }`}>
                        {step.label}
                      </span>
                      {step.duration && (
                        <span className="text-[9px] text-[#64748B] font-mono flex items-center gap-0.5">
                          <Timer className="h-2.5 w-2.5" />
                          {step.duration}
                        </span>
                      )}
                    </div>
                    <span className={`text-[10px] ${
                      step.status === 'completed' ? 'text-emerald-500/40' :
                      step.status === 'active' ? 'text-cyan-400/50' :
                      'text-[#64748B]'
                    }`}>
                      {step.description}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
