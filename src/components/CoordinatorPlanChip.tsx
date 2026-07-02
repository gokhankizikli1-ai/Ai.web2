// CoordinatorPlanChip — Phase 9 small "Plan" preview chip.
//
// Renders ABOVE the composer (between asset chips and the textarea
// border) when:
//   - VITE_ENABLE_COORDINATOR_PREVIEW=true is set in the build
//   - the coordinator returns a real plan with confidence > 0.5
//   - the user hasn't dismissed it for the current draft
//
// The chip is honest about routing: shows "rule-based" label so users
// know this is intent classification, not an LLM-decided plan. When
// the supervisor leads (multi-agent), the chip says "Supervisor + N
// specialists"; for a single specialist match it just names the agent.
//
// Deliberately NO interactivity beyond dismiss — clicking the chip
// does NOT execute the plan. Execution wiring is a follow-up PR.
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Code, BarChart3, ShoppingBag, Sparkles,
  Globe, Layout, X, Network, type LucideIcon,
} from 'lucide-react';
import type { PlanView } from '@/hooks/useCoordinatorPlan';

interface CoordinatorPlanChipProps {
  plan:        PlanView | null;
  onDismiss?:  () => void;
}

// Short, human-readable label per agent id. Falls back to the raw id
// (title-cased) for project-defined custom agents.
const AGENT_LABELS: Record<string, string> = {
  supervisor:         'Supervisor',
  researcher:         'Research',
  coder:              'Coder',
  trader:             'Trader',
  marketer:           'Marketer',
  strategist:         'Strategist',
  ux_designer:        'UX Designer',
  brand_designer:     'Brand',
  copywriter:         'Copy',
  product_strategist: 'Product Strategist',
};

const AGENT_ICONS: Record<string, LucideIcon> = {
  supervisor:         Network,
  researcher:         Brain,
  coder:              Code,
  trader:             BarChart3,
  marketer:           ShoppingBag,
  strategist:         Sparkles,
  ux_designer:        Layout,
  brand_designer:     Sparkles,
  copywriter:         Sparkles,
  product_strategist: Globe,
};

function labelFor(id: string): string {
  return AGENT_LABELS[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function iconFor(id: string): LucideIcon {
  return AGENT_ICONS[id] ?? Sparkles;
}


export default function CoordinatorPlanChip({ plan, onDismiss }: CoordinatorPlanChipProps) {
  // Confidence threshold — match the coordinator's own "is the
  // signal worth surfacing?" bar. Below this we'd be telling the user
  // about a guess, which is noisier than helpful.
  const show = !!plan && plan.confidence >= 0.5 && plan.agents.length > 0;

  return (
    <AnimatePresence>
      {show && plan && (
        <motion.div
          initial={{ opacity: 0, y: 4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.96 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-xl border bg-white/[0.02] hover:bg-white/[0.03] transition-colors"
          style={{
            borderColor:    'rgba(59, 130, 246,0.10)',
            backdropFilter: 'blur(8px)',
          }}
          aria-label="Coordinator plan preview"
        >
          {/* Title — honest about routing method so users know it's
              not an LLM decision. */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Network className="h-3 w-3 text-[#3B82F6]/70" />
            <span className="text-[10px] font-medium text-slate-300 uppercase tracking-wider">
              Plan
            </span>
            <span className="text-[9px] text-[#94A3B8]">rule-based</span>
          </div>

          {/* Agent chain — small icon + label per invocation. The
              supervisor (when present) is always first; followers
              render in plan order. Truncates at 4 to keep the chip
              from wrapping on iPad narrow layouts. */}
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
            {plan.agents.slice(0, 4).map((a, i) => {
              const Icon = iconFor(a.agent_id);
              return (
                <div key={`${a.agent_id}-${i}`} className="flex items-center gap-1 shrink-0">
                  {i > 0 && (
                    <span className="text-[9px] text-slate-700">→</span>
                  )}
                  <Icon className="h-2.5 w-2.5 text-[#3B82F6]/60 shrink-0" />
                  <span
                    className="text-[10px] text-[#CBD5E1] leading-none whitespace-nowrap"
                    title={a.reason}
                  >
                    {labelFor(a.agent_id)}
                  </span>
                </div>
              );
            })}
            {plan.agents.length > 4 && (
              <span className="text-[9px] text-[#94A3B8] shrink-0">
                +{plan.agents.length - 4}
              </span>
            )}
          </div>

          {/* Dismiss */}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 h-4 w-4 flex items-center justify-center rounded text-[#94A3B8] hover:text-slate-300 hover:bg-white/[0.04] transition-colors"
              aria-label="Dismiss plan preview"
              title="Dismiss"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
