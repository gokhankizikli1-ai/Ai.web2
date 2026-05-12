import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, TrendingUp, Clock, Zap } from 'lucide-react';

export default function CreditDisplay() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const credits = 847;

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
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/[0.06] border border-amber-500/10 hover:bg-amber-500/[0.1] transition-colors"
      >
        <Coins className="w-3 h-3 text-amber-400" />
        <span className="text-[11px] font-medium text-amber-400">{credits}</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-white/[0.06] bg-[#111111]/95 backdrop-blur-xl shadow-2xl overflow-hidden z-50"
          >
            {/* Header */}
            <div className="p-4 border-b border-white/[0.03]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-medium text-white">Credits</span>
                <span className="text-[14px] font-semibold text-amber-400">{credits}</span>
              </div>
              <p className="text-[11px] text-slate-500">Resets in 12 days</p>
            </div>

            {/* Stats */}
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-[11px] text-slate-400">Used today</span>
                </div>
                <span className="text-[11px] font-medium text-white">153</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-[11px] text-slate-400">Avg per agent</span>
                </div>
                <span className="text-[11px] font-medium text-white">12</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-[11px] text-slate-400">Deep research</span>
                </div>
                <span className="text-[11px] font-medium text-white">45/req</span>
              </div>
            </div>

            {/* CTA */}
            <div className="p-3 border-t border-white/[0.03]">
              <button className="w-full py-2 rounded-xl bg-amber-500/[0.08] border border-amber-500/15 text-[11px] font-medium text-amber-400 hover:bg-amber-500/[0.12] transition-colors">
                Upgrade for More
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
