import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Loader2, CheckCircle2, Brain, TrendingUp,
  ChevronDown, ChevronUp,
} from 'lucide-react';

interface ActivityItem {
  id: string;
  status: 'active' | 'completed' | 'queued';
  message: string;
  detail?: string;
  progress?: number;
  icon: typeof Brain;
  color: string;
}

const DEMO_ACTIVITIES: ActivityItem[] = [
  { id: 'a1', status: 'active', message: 'Deep Research on NVDA Q3 Earnings', detail: 'Analyzing financial statements...', progress: 65, icon: Brain, color: 'text-[#3B82F6]' },
  { id: 'a2', status: 'active', message: 'Market Sentiment Scan', detail: 'Processing 12K social posts...', progress: 34, icon: TrendingUp, color: 'text-[#3B82F6]' },
  { id: 'a3', status: 'completed', message: 'Portfolio Risk Analysis', detail: 'Completed with 3 alerts', icon: CheckCircle2, color: 'text-[#3B82F6]' },
  { id: 'a4', status: 'queued', message: 'Weekly Trend Forecast', detail: 'Scheduled for 2:00 PM', icon: Activity, color: 'text-[#CBD5E1]' },
  { id: 'a5', status: 'active', message: 'Startup Idea Validation', detail: 'Scoring across 10 dimensions...', progress: 78, icon: Brain, color: 'text-[#3B82F6]' },
];

function ThinkingPulse() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1 h-1 rounded-full bg-[#3B82F6]"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

function SyncIndicator() {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
    >
      <Loader2 className="w-3 h-3 text-[#3B82F6]/60" />
    </motion.div>
  );
}

function StatusDot({ status, color }: { status: string; color: string }) {
  if (status === 'active') {
    return (
      <motion.div
        className={`w-2 h-2 rounded-full ${color.replace('text-', 'bg-')}`}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      />
    );
  }
  if (status === 'completed') {
    return <CheckCircle2 className="w-3 h-3 text-[#4ADE80]" />;
  }
  return <Activity className="w-3 h-3 text-[#94A3B8]" />;
}

interface IntelligenceLayerProps {
  variant?: 'full' | 'compact';
}

export default function IntelligenceLayer({ variant = 'compact' }: IntelligenceLayerProps) {
  const [expanded, setExpanded] = useState(false);
  const [activities] = useState<ActivityItem[]>(DEMO_ACTIVITIES);
  const hasActive = activities.some((a) => a.status === 'active');

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.02] bg-[#0a0a0a]/40 backdrop-blur-sm">
        {/* Live indicator */}
        <div className="flex items-center gap-1.5">
          <motion.div
            className="w-2 h-2 rounded-full bg-[#4ADE80]"
            animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span className="text-[10px] font-medium text-[#4ADE80]/70 uppercase tracking-wider">Live</span>
        </div>

        {/* Scrolling activity pills */}
        <div className="flex-1 overflow-hidden relative">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {activities.slice(0, 3).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.03] shrink-0"
              >
                <StatusDot status={a.status} color={a.color} />
                <span className="text-[11px] text-[#CBD5E1] truncate max-w-[140px]">{a.message}</span>
                {a.status === 'active' && a.progress !== undefined && (
                  <span className="text-[10px] text-[#94A3B8]">{a.progress}%</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[#94A3B8] hover:text-slate-300 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {/* Expandable panel */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="absolute top-full left-0 right-0 z-40 bg-[#11151C]/95 backdrop-blur-xl border-b border-white/[0.04] overflow-hidden"
            >
              <div className="px-4 py-3 space-y-2">
                {activities.map((a) => (
                  <div key={a.id} className="flex items-center gap-3">
                    <StatusDot status={a.status} color={a.color} />
                    <a.icon className={`w-3.5 h-3.5 ${a.color}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-slate-300 truncate">{a.message}</p>
                      {a.detail && <p className="text-[11px] text-[#94A3B8]">{a.detail}</p>}
                    </div>
                    {a.status === 'active' && a.progress !== undefined && (
                      <div className="w-16 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-[#3B82F6]/60"
                          initial={{ width: 0 }}
                          animate={{ width: `${a.progress}%` }}
                          transition={{ duration: 1 }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Full variant for ChatDashboard overlay
  return (
    <div className="absolute top-0 left-0 right-0 z-30">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.02] bg-[#11151C]/60 backdrop-blur-xl">
        {hasActive && <ThinkingPulse />}
        {hasActive && <SyncIndicator />}
        <div className="flex items-center gap-2 overflow-x-auto">
          {activities.filter((a) => a.status === 'active').map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.02]">
              <a.icon className={`w-3 h-3 ${a.color}`} />
              <span className="text-[11px] text-[#CBD5E1]">{a.message}</span>
              {a.progress !== undefined && (
                <span className="text-[10px] text-[#94A3B8]">{a.progress}%</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
