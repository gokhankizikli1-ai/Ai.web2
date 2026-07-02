import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, X, AlertTriangle } from 'lucide-react';

export interface CreditCost {
  label: string;
  minCredits: number;
  maxCredits: number;
}

/* ═══════════════════════════════════════════
   CREDIT COST MAP
   ═══════════════════════════════════════════ */
export const CREDIT_COSTS: Record<string, CreditCost> = {
  // FREE — 0 credits
  'chat':            { label: 'Normal chat', minCredits: 0, maxCredits: 0 },
  'fast':            { label: 'Fast answer', minCredits: 0, maxCredits: 0 },
  'explain':         { label: 'Explain', minCredits: 0, maxCredits: 0 },
  'summarize':       { label: 'Summarize', minCredits: 0, maxCredits: 0 },
  'file-upload':     { label: 'File upload', minCredits: 0, maxCredits: 0 },
  'browse':          { label: 'Browse workspace', minCredits: 0, maxCredits: 0 },

  // PAID — requires credits
  'deep-think':      { label: 'Deep Think', minCredits: 1, maxCredits: 2 },
  'deep-think-pro':  { label: 'Deep Think Pro', minCredits: 3, maxCredits: 5 },
  'web-research':    { label: 'Web Research', minCredits: 5, maxCredits: 20 },
  'file-analysis-sm': { label: 'Small doc analysis', minCredits: 0, maxCredits: 1 },
  'file-analysis-md': { label: 'Medium doc analysis', minCredits: 3, maxCredits: 5 },
  'file-analysis-lg': { label: 'Large doc analysis', minCredits: 5, maxCredits: 15 },
  'trading-intel':   { label: 'Trading Intel', minCredits: 2, maxCredits: 10 },
  'agent-workflow':  { label: 'AI Agent workflow', minCredits: 5, maxCredits: 50 },
  'premium-long':    { label: 'Premium long context', minCredits: 5, maxCredits: 30 },
};

export function getCreditCost(key: string): CreditCost {
  return CREDIT_COSTS[key] || { label: 'Advanced operation', minCredits: 1, maxCredits: 3 };
}

export function isFree(key: string): boolean {
  const cost = getCreditCost(key);
  return cost.maxCredits === 0;
}

export function formatCost(cost: CreditCost): string {
  if (cost.maxCredits === 0) return 'Free';
  if (cost.minCredits === cost.maxCredits) return `${cost.minCredits} credit`;
  return `${cost.minCredits}–${cost.maxCredits} credits`;
}

/* ═══════════════════════════════════════════
   DIALOG
   ═══════════════════════════════════════════ */
interface CreditConfirmationProps {
  open: boolean;
  costKey: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CreditConfirmation({ open, costKey, onConfirm, onCancel }: CreditConfirmationProps) {
  const cost = getCreditCost(costKey);
  if (cost.maxCredits === 0) return null; // Free — no dialog

  const [loading, setLoading] = useState(false);

  const handleConfirm = () => {
    setLoading(true);
    onConfirm();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0a0f1a]/60 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-[340px] max-w-[90vw] rounded-2xl border border-white/[0.06] bg-[#171C24] p-5 shadow-2xl"
          >
            {/* Icon */}
            <div className="flex items-center justify-center mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#A68A5B]/[0.06] border border-[#A68A5B]/10">
                <Coins className="h-5 w-5 text-[#A68A5B]/70" />
              </div>
            </div>

            {/* Title */}
            <h3 className="text-[14px] font-semibold text-white text-center mb-1">
              Advanced Operation
            </h3>
            <p className="text-[12px] text-[#7F8FA3] text-center mb-4">
              {cost.label} requires credits
            </p>

            {/* Cost */}
            <div className="flex items-center justify-center gap-2 mb-4 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.03]">
              <Coins className="h-4 w-4 text-[#A68A5B]/60" />
              <span className="text-[13px] font-semibold text-[#A68A5B]/80">
                ~{cost.minCredits === cost.maxCredits ? cost.minCredits : `${cost.minCredits}–${cost.maxCredits}`} credit{cost.maxCredits > 1 ? 's' : ''}
              </span>
            </div>

            {/* Note */}
            <div className="flex items-start gap-2 mb-4 px-2.5 py-2 rounded-lg bg-[#6F8F7A]/[0.02] border border-[#6F8F7A]/6">
              <AlertTriangle className="h-3 w-3 text-[#6F8F7A]/40 shrink-0 mt-0.5" />
              <p className="text-[10px] text-[#6F8F7A]/50 leading-relaxed">
                Normal casual chat is always free. Credits are only used for advanced operations.
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="flex-1 h-9 rounded-xl border border-white/[0.06] bg-white/[0.02] text-[12px] text-[#7F8FA3] hover:text-slate-300 hover:bg-white/[0.04] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                className="flex-1 h-9 rounded-xl bg-[#7EA6BF]/[0.08] border border-[#7EA6BF]/12 text-[12px] font-medium text-[#7EA6BF] hover:bg-[#7EA6BF]/[0.12] transition-all disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Continue'}
              </button>
            </div>

            {/* Close */}
            <button
              onClick={onCancel}
              className="absolute top-3 right-3 p-1 rounded text-[#7F8FA3] hover:text-[#A9B7C6] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
