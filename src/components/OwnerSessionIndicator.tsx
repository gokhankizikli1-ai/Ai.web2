/**
 * OwnerSessionIndicator — small subtle "Owner Session Active" chip
 * that renders in the workspace top bar (or activity feed) only when
 * the current session has owner privileges granted.
 *
 * Reads from useOwnerMode(). Renders NOTHING for non-owners.
 *
 * Hover / tap opens a tiny popover listing the active orchestration
 * permissions ("frontend modification", "autonomous architectural
 * edits", …) so the operator can confirm at a glance what's unlocked.
 *
 * Design notes:
 *   - Pulsing dot to signal a live elevated state (distinct from the
 *     static AdminBadge which only opens the AdminPanel).
 *   - Amber → fuchsia gradient matches the AdminBadge so the two
 *     read as "the same elevated owner UI family".
 *   - All capability labels are surfaced from the hook (no hardcoded
 *     list here) so adding a backend capability flows through.
 */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap } from 'lucide-react';
import { useOwnerMode, type OrchestrationCapability } from '@/hooks/useOwnerMode';

/* Human labels for each orchestration capability id. Kept colocated
 * so a new backend capability shows up as the raw id (loud but not
 * broken) until someone adds a label below. */
const LABELS: Record<OrchestrationCapability, string> = {
  frontend_modification:             'Frontend modifications',
  ui_layout_styles:                  'UI / layout / styles',
  frontend_refactor:                 'Frontend refactors',
  page_component_crud:               'Page / component CRUD',
  project_structure_changes:         'Project structure changes',
  internal_orchestration_tools:      'Internal orchestration tools',
  autonomous_architectural_edits:    'Autonomous architectural edits',
  reduced_confirmation_friction:     'Reduced confirmation friction',
};

export default function OwnerSessionIndicator() {
  const { isOwner, orchestrationCapabilities } = useOwnerMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, [open]);

  // Hide entirely for non-owners — admin mode is invisible to them.
  if (!isOwner) return null;

  const grantedCount = orchestrationCapabilities.length;

  return (
    <div ref={ref} className="relative">
      <motion.button
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-500/[0.10] to-fuchsia-500/[0.08] border border-amber-500/25 hover:border-amber-500/45 transition-all"
        title={`Owner Session Active — ${grantedCount} permissions granted (click to view)`}
        data-testid="owner-session-indicator"
      >
        {/* Pulsing dot signals "live elevated state". */}
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-300" />
        </span>
        <Zap className="h-3 w-3 text-amber-300" />
        <span className="text-[10px] font-semibold tracking-wide text-amber-200">
          Owner Session
        </span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-amber-500/20 bg-[#0e0e14]/95 shadow-2xl shadow-amber-500/5 z-[55] overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-white/[0.05] bg-gradient-to-r from-amber-500/[0.05] to-transparent">
              <div className="text-[11px] font-semibold text-amber-200">
                Owner Session Active
              </div>
              <div className="text-[10px] text-amber-300/60 mt-0.5">
                Authenticated for autonomous development work.
              </div>
            </div>
            <ul className="p-2 space-y-0.5 max-h-72 overflow-y-auto scrollbar-thin">
              {orchestrationCapabilities.length === 0 ? (
                <li className="px-2 py-1.5 text-[10px] text-slate-600">
                  No orchestration capabilities granted.
                </li>
              ) : (
                orchestrationCapabilities.map((cap) => (
                  <li
                    key={cap}
                    className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.025]"
                  >
                    <span className="mt-1 h-1 w-1 rounded-full bg-amber-400/70 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-200 leading-tight">
                        {LABELS[cap] ?? cap}
                      </div>
                      <div className="text-[9px] text-slate-600 font-mono mt-0.5">
                        {cap}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
            <div className="px-3 py-2 border-t border-white/[0.04] text-[9px] text-slate-600">
              Safety: malware / credential theft / exploit dev still blocked.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
