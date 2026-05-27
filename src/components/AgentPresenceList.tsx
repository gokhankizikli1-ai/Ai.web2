// AgentPresenceList — Phase 9 part 2 live presence display.
//
// Renders one compact chip per agent active on a panel. Each chip
// shows the agent label, its current state (with a colored dot), the
// "current task" label when present, and "active for Ns" since the
// state was entered.
//
// Self-contained — pulls data from useAgentPresence; the parent only
// needs to pass `panelId`. No props for state — this is a pure
// presence-of-others UI. When the backend flag is off the component
// renders nothing (zero layout impact).
//
// This component is intentionally NOT auto-wired into ChatView in
// this PR. The full workspace UX (split-pane, scratchpad timeline,
// activity feed) needs careful design and is the next PR.
// AgentPresenceList is the building block.
import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Code, Search as SearchIcon, Layout, Sparkles,
  BarChart3, ShoppingBag, Globe, Network, Loader2,
  CheckCircle2, AlertCircle, type LucideIcon,
} from 'lucide-react';
import useAgentPresence, { type AgentPresenceView } from '@/hooks/useAgentPresence';


interface AgentPresenceListProps {
  panelId:     string | null | undefined;
  /** Optional cap so a runaway panel can't fill the sidebar. */
  maxRows?:    number;
  /** Section heading shown above the chips. */
  title?:      string;
}


// Agent label / icon — matches CoordinatorPlanChip so the user sees
// consistent visual identity between "Plan" and "Live" surfaces.
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
  return AGENT_ICONS[id] ?? SearchIcon;
}


// State styling — dot color + ring color + optional spinner. The
// spinner is reserved for active-work states (thinking / researching /
// coding / analyzing) so the user reads "this agent is busy" at a
// glance.
interface StateStyle {
  dotClass:  string;
  ringClass: string;
  spinning:  boolean;
  label:     string;
}

const STATE_STYLES: Record<string, StateStyle> = {
  idle:        { dotClass: 'bg-slate-500',   ringClass: 'border-slate-500/20',   spinning: false, label: 'Idle' },
  thinking:    { dotClass: 'bg-cyan-400',    ringClass: 'border-cyan-400/30',    spinning: true,  label: 'Thinking' },
  researching: { dotClass: 'bg-cyan-400',    ringClass: 'border-cyan-400/30',    spinning: true,  label: 'Researching' },
  coding:      { dotClass: 'bg-violet-400',  ringClass: 'border-violet-400/30',  spinning: true,  label: 'Coding' },
  analyzing:   { dotClass: 'bg-amber-400',   ringClass: 'border-amber-400/30',   spinning: true,  label: 'Analyzing' },
  waiting:     { dotClass: 'bg-amber-300',   ringClass: 'border-amber-300/30',   spinning: false, label: 'Waiting' },
  blocked:     { dotClass: 'bg-orange-400',  ringClass: 'border-orange-400/30',  spinning: false, label: 'Blocked' },
  completed:   { dotClass: 'bg-emerald-400', ringClass: 'border-emerald-400/30', spinning: false, label: 'Completed' },
  failed:      { dotClass: 'bg-red-400',     ringClass: 'border-red-400/30',     spinning: false, label: 'Failed' },
};

function styleFor(state: string): StateStyle {
  return STATE_STYLES[state] ?? STATE_STYLES.idle;
}


// "active for 12s" — only rendered for non-terminal states so a
// completed agent doesn't keep counting forever.
function formatActiveFor(startedAtMs: number, now: number): string | null {
  if (!startedAtMs) return null;
  const sec = Math.max(0, Math.round((now - startedAtMs) / 1000));
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}


export default function AgentPresenceList({
  panelId,
  maxRows = 8,
  title = 'Agents on this panel',
}: AgentPresenceListProps) {
  const { rows, isAvailable } = useAgentPresence(panelId);

  // Compute "active for Ns" against a single now() per render so the
  // chips don't disagree with each other within one paint.
  const now = useMemo(() => Date.now(), [rows]);

  if (!isAvailable || rows.length === 0) {
    return null;
  }

  const visible = rows.slice(0, maxRows);
  const hidden  = rows.length - visible.length;

  return (
    <div className="flex flex-col gap-1.5">
      {title && (
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 px-1">
          {title}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <AnimatePresence initial={false}>
          {visible.map((row) => (
            <Chip key={`${row.panel_id}:${row.agent_id}`} row={row} now={now} />
          ))}
        </AnimatePresence>
        {hidden > 0 && (
          <div className="text-[10px] text-slate-600 px-1">
            +{hidden} more…
          </div>
        )}
      </div>
    </div>
  );
}


function Chip({ row, now }: { row: AgentPresenceView; now: number }) {
  const Icon  = iconFor(row.agent_id);
  const style = styleFor(row.state);
  const active = formatActiveFor(row.started_at_ms, now);
  const isTerminal = row.state === 'completed' || row.state === 'failed';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 4 }}
      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border bg-white/[0.015] hover:bg-white/[0.03] transition-colors ${style.ringClass}`}
    >
      {/* Avatar + state dot */}
      <div className="relative shrink-0 flex items-center justify-center h-5 w-5 rounded-md bg-white/[0.03] border border-white/[0.04]">
        <Icon className="h-2.5 w-2.5 text-slate-400" />
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ${style.dotClass}`}
          aria-hidden
        />
      </div>

      {/* Label + current task */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-slate-200 truncate">
            {labelFor(row.agent_id)}
          </span>
          {style.spinning && !isTerminal && (
            <Loader2 className="h-2.5 w-2.5 text-slate-500 animate-spin shrink-0" />
          )}
          {row.state === 'completed' && (
            <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400/80 shrink-0" />
          )}
          {row.state === 'failed' && (
            <AlertCircle className="h-2.5 w-2.5 text-red-400/80 shrink-0" />
          )}
        </div>
        {/* second line: state · current_task · active for Ns */}
        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 leading-tight truncate">
          <span>{style.label}</span>
          {row.current_task && (
            <>
              <span className="text-slate-700">·</span>
              <span className="truncate" title={row.current_task}>
                {row.current_task}
              </span>
            </>
          )}
          {active && !isTerminal && (
            <>
              <span className="text-slate-700">·</span>
              <span className="tabular-nums">{active}</span>
            </>
          )}
        </div>
      </div>

      {/* Progress bar — only when the agent reports a numeric % */}
      {typeof row.progress === 'number' && (
        <div className="shrink-0 text-[10px] text-slate-500 tabular-nums" aria-label="progress">
          {row.progress}%
        </div>
      )}
    </motion.div>
  );
}
