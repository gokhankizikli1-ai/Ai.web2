import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, CheckCircle2, Clock, ChevronDown, Brain, Search, FileText, Code2, TrendingUp } from 'lucide-react';
import type { AIActivity } from '@/types';
import { eventsToActivities, type ProjectActivityEvent } from '@/hooks/useProjectActivity';

interface AIActivityFeedProps {
  activities: AIActivity[];
  /**
   * Phase 3.5 — optional realtime event stream. When provided AND
   * non-empty, replaces `activities` as the feed's data source.
   * When omitted or empty, the existing `activities` prop is used
   * (preserves the demo fallback). Components that don't pass it
   * are unaffected.
   */
  events?: ProjectActivityEvent[];
}

function StatusIcon({ status }: { status: AIActivity['status'] }) {
  if (status === 'active') {
    return (
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#7EA6BF]/50 animate-ping" style={{ animationDuration: '2s' }} />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#7EA6BF]" />
      </span>
    );
  }
  if (status === 'completed') return <CheckCircle2 className="h-3 w-3 text-[#86A88B]/60" />;
  return <Clock className="h-3 w-3 text-[#7F8FA3]" />;
}

function CategoryIcon({ message }: { message: string }) {
  const lower = message.toLowerCase();
  if (lower.includes('code') || lower.includes('debug')) return <Code2 className="h-3 w-3 text-[#7EA6BF]/50" />;
  if (lower.includes('research') || lower.includes('analysis')) return <Search className="h-3 w-3 text-[#7EA6BF]/50" />;
  if (lower.includes('write') || lower.includes('draft')) return <FileText className="h-3 w-3 text-[#7EA6BF]/50" />;
  if (lower.includes('market') || lower.includes('trade')) return <TrendingUp className="h-3 w-3 text-[#7EA6BF]/50" />;
  return <Brain className="h-3 w-3 text-[#7EA6BF]/50" />;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-10 h-[2px] bg-white/[0.03] rounded-full overflow-hidden">
      <motion.div
        className="h-full bg-[#7EA6BF]/40 rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  );
}

export default function AIActivityFeed({ activities, events }: AIActivityFeedProps) {
  const [expanded, setExpanded] = useState(false);

  // Phase 3.5 — when a non-empty realtime event stream is supplied,
  // derive the activity list from it; otherwise fall back to the
  // demo / static activities prop. Memoised so we don't re-map the
  // event buffer on every render.
  const effectiveActivities: AIActivity[] = useMemo(() => {
    if (events && events.length > 0) {
      return eventsToActivities(events).map((d) => ({
        id:        d.id,
        status:    d.status,
        message:   d.message,
        detail:    d.detail,
        progress:  d.progress,
        timestamp: d.timestamp,
      }));
    }
    return activities;
  }, [events, activities]);

  if (effectiveActivities.length === 0) return null;

  const activeCount = effectiveActivities.filter((a) => a.status === 'active').length;
  const displayActivities = expanded ? effectiveActivities : effectiveActivities.slice(0, 3);

  return (
    <div className="border-b border-white/[0.02] bg-[#0a0a0a]/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-2 hover:bg-white/[0.01] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <Activity className="h-3 w-3 text-[#7EA6BF]/50" />
            {activeCount > 0 && (
              <motion.span
                className="absolute -top-0.5 -right-0.5 h-[5px] w-[5px] rounded-full bg-[#7EA6BF]"
                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            )}
          </div>
          <span className="text-[10px] text-[#7F8FA3] font-semibold uppercase tracking-wider">Activity</span>
          {activeCount > 0 && (
            <span className="text-[10px] text-[#7EA6BF]/70 font-medium flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#7EA6BF]/40 animate-ping" style={{ animationDuration: '2s' }} />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#7EA6BF]" />
              </span>
              {activeCount} active
            </span>
          )}
        </div>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-3 w-3 text-[#7F8FA3]" />
        </motion.div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-2.5 space-y-[3px]">
              {displayActivities.map((activity) => (
                <div key={activity.id} className="flex items-center gap-2.5 py-[2px]">
                  <StatusIcon status={activity.status} />
                  <CategoryIcon message={activity.message} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[#7F8FA3] truncate">{activity.message}</span>
                      {activity.progress !== undefined && activity.status === 'active' && (
                        <span className="text-[9px] text-[#7EA6BF]/50 shrink-0 font-mono">{activity.progress}%</span>
                      )}
                    </div>
                    {activity.detail && (
                      <span className="text-[9px] text-[#7F8FA3] block truncate">{activity.detail}</span>
                    )}
                  </div>
                  {activity.progress !== undefined && (
                    <ProgressBar value={activity.progress} />
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
