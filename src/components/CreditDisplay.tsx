import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router';
import { Coins, Crown, ArrowRight, Zap } from 'lucide-react';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { useCredits } from '@/hooks/useCredits';

export default function CreditDisplay() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // Same authoritative, account-scoped source as the plan badge / account card
  // (useBillingPlan → /v2/billing/me). null while loading → neutral (no label).
  const { label: planLabel } = useBillingPlan();

  // Server-authoritative balance (Phase 1). `balance` is null while loading /
  // unknown / on failure → render a neutral placeholder, NEVER a fabricated
  // number. No monthly limit is invented, so there is no "/ total".
  const { balance } = useCredits();
  const balanceLabel = balance === null ? '—' : balance.toLocaleString();

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div ref={ref} className="relative">
      {/* Trigger — compact */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#FACC15]/[0.04] border border-[#FACC15]/6 hover:bg-[#FACC15]/[0.07] transition-colors"
      >
        <Coins className="w-3 h-3 text-[#FACC15]/60" />
        <span className="text-[10px] font-medium text-[#FACC15]/70 tabular-nums">{balanceLabel}</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-white/[0.06] bg-[#171C24]/98 backdrop-blur-xl shadow-2xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="p-3.5 border-b border-white/[0.03]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider">Credits</span>
                {planLabel && (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FACC15]/[0.06]">
                    <Crown className="w-2.5 h-2.5 text-[#FACC15]" />
                    <span className="text-[9px] text-[#FACC15] font-medium">{planLabel}</span>
                  </div>
                )}
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-white tabular-nums">{balanceLabel}</span>
                <span className="text-[10px] text-[#94A3B8]">credits</span>
              </div>
              {/* No monthly limit is invented in Phase 1 — the balance is the
                  authoritative figure; plan-specific allowances come later. */}
              {balance === null && (
                <p className="text-[9px] text-[#94A3B8] mt-1">Balance unavailable right now</p>
              )}
            </div>

            {/* Free chat badge */}
            <div className="mx-3 mt-2.5 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#4ADE80]/[0.04] border border-[#4ADE80]/8">
              <Zap className="w-3 h-3 text-[#4ADE80]/50" />
              <span className="text-[10px] text-[#4ADE80]/60">Casual chat is free</span>
            </div>

            {/* CTA */}
            <div className="p-3">
              <button
                onClick={() => { navigate('/credits'); setOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#3B82F6]/[0.05] border border-[#3B82F6]/8 text-[11px] font-medium text-[#3B82F6] hover:bg-[#3B82F6]/[0.08] transition-colors"
              >
                Manage <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
