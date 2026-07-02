import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router';
import { Coins, Crown, ArrowRight, Zap } from 'lucide-react';

export default function CreditDisplay() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const creditsRemaining = 153;
  const creditsTotal = 300;
  const usagePercent = Math.round((creditsTotal - creditsRemaining) / creditsTotal * 100);

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
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#A68A5B]/[0.04] border border-[#A68A5B]/6 hover:bg-[#A68A5B]/[0.07] transition-colors"
      >
        <Coins className="w-3 h-3 text-[#A68A5B]/60" />
        <span className="text-[10px] font-medium text-[#A68A5B]/70 tabular-nums">{creditsRemaining}</span>
        <span className="text-[9px] text-[#A68A5B]/30">/{creditsTotal}</span>
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
                <span className="text-[10px] text-slate-500 uppercase tracking-wider">Credits</span>
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#A68A5B]/[0.06]">
                  <Crown className="w-2.5 h-2.5 text-[#A68A5B]" />
                  <span className="text-[9px] text-[#A68A5B] font-medium">Pro</span>
                </div>
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-white tabular-nums">{creditsRemaining}</span>
                <span className="text-[10px] text-slate-600">/ {creditsTotal}</span>
              </div>

              {/* Progress */}
              <div className="w-full h-1 bg-white/[0.03] rounded-full mt-2 overflow-hidden">
                <div className="h-full rounded-full bg-[#52677A]/40" style={{ width: `${usagePercent}%` }} />
              </div>
              <p className="text-[9px] text-[#64748B] mt-1">{usagePercent}% used · Resets in 12d</p>
            </div>

            {/* Free chat badge */}
            <div className="mx-3 mt-2.5 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#6F8F7A]/[0.04] border border-[#6F8F7A]/8">
              <Zap className="w-3 h-3 text-[#6F8F7A]/50" />
              <span className="text-[10px] text-[#6F8F7A]/60">Casual chat is free</span>
            </div>

            {/* CTA */}
            <div className="p-3">
              <button
                onClick={() => { navigate('/credits'); setOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#52677A]/[0.05] border border-[#52677A]/8 text-[11px] font-medium text-[#52677A] hover:bg-[#52677A]/[0.08] transition-colors"
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
