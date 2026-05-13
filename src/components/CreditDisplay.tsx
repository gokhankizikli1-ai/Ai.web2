import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router';
import { Coins, TrendingUp, Clock, Zap, Crown, ArrowRight } from 'lucide-react';

export default function CreditDisplay() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Demo credit state — will come from AppContext when backend is connected
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
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/[0.05] border border-amber-500/8 hover:bg-amber-500/[0.08] hover:border-amber-500/12 transition-colors"
      >
        <Coins className="w-3 h-3 text-amber-400/70" />
        <span className="text-[11px] font-medium text-amber-400/80 tabular-nums">{creditsRemaining}</span>
        <span className="text-[9px] text-amber-400/40">/ {creditsTotal}</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-white/[0.06] bg-[#0e0e14]/98 backdrop-blur-xl shadow-2xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/[0.03]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-slate-500 uppercase tracking-wider">Credits</span>
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/[0.06]">
                  <Crown className="w-3 h-3 text-amber-400" />
                  <span className="text-[9px] text-amber-400 font-medium">Pro</span>
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-white tabular-nums">{creditsRemaining}</span>
                <span className="text-[11px] text-slate-600">/ {creditsTotal} remaining</span>
              </div>
              {/* Mini progress */}
              <div className="w-full h-1 bg-white/[0.03] rounded-full mt-2 overflow-hidden">
                <div className="h-full rounded-full bg-cyan-400/40" style={{ width: `${usagePercent}%` }} />
              </div>
              <p className="text-[10px] text-slate-600 mt-1">{usagePercent}% used — Resets in 12 days</p>
            </div>

            {/* Quick stats */}
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-emerald-400/50" />
                  <span className="text-[11px] text-slate-400">Casual chat</span>
                </div>
                <span className="text-[10px] text-emerald-400/60">Free</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-cyan-400/50" />
                  <span className="text-[11px] text-slate-400">Advanced used today</span>
                </div>
                <span className="text-[10px] text-cyan-400/60">24 cr</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-purple-400/50" />
                  <span className="text-[11px] text-slate-400">Rollover</span>
                </div>
                <span className="text-[10px] text-purple-400/60">47 cr</span>
              </div>
            </div>

            {/* CTA */}
            <div className="p-3 border-t border-white/[0.03]">
              <button
                onClick={() => { navigate('/credits'); setOpen(false); }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/10 text-[11px] font-medium text-cyan-400 hover:bg-cyan-500/[0.1] transition-colors"
              >
                Manage Credits <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
