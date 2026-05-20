import { motion } from 'framer-motion';
import { Zap, Globe, Rocket, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { useAuthStore } from '@/stores/authStore';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
});

export default function FinalCTASection() {
  // Real signed-in users only — guests stay on the marketing CTAs.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      {/* Large background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-cyan-500/[0.03] rounded-full blur-[180px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[200px] bg-violet-500/[0.02] rounded-full blur-[100px]" />
      </div>

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <motion.div {...fadeUp(0)}>
          {/* Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-500/[0.06] border border-cyan-500/10 text-cyan-400/70 text-[11px] mb-6">
            <Zap className="h-3 w-3" />
            <span>Start building with AI today</span>
          </div>

          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-5 tracking-tight leading-tight">
            Ready to{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-400 to-violet-400">
              Build the Future
            </span>
            ?
          </h2>

          <p className="text-[15px] sm:text-base text-slate-500 max-w-lg mx-auto leading-relaxed mb-10">
            Join founders, traders, and creators using KorvixAI to turn ideas into reality. Casual chat is free — advanced features use credits.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
            {isAuthenticated ? (
              <Link
                to="/chat"
                className="group inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white/[0.08] text-white border border-white/[0.1] text-[14px] hover:bg-white/[0.12] transition-all shadow-[0_0_20px_-4px_rgba(34,211,238,0.1)] hover:shadow-[0_0_30px_-4px_rgba(34,211,238,0.15)]"
              >
                <Rocket className="h-4 w-4" /> Open Workspace
                <ArrowUpRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-white transition-colors" />
              </Link>
            ) : (
              <>
                <Link
                  to="/signup"
                  className="group inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white/[0.08] text-white border border-white/[0.1] text-[14px] hover:bg-white/[0.12] transition-all shadow-[0_0_20px_-4px_rgba(34,211,238,0.1)] hover:shadow-[0_0_30px_-4px_rgba(34,211,238,0.15)]"
                >
                  <Rocket className="h-4 w-4" /> Create Account
                </Link>
                <Link
                  to="/login"
                  className="group inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white/[0.02] text-slate-400 border border-white/[0.04] text-[14px] hover:bg-white/[0.04] hover:text-slate-200 transition-all"
                >
                  Sign In
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                </Link>
              </>
            )}
          </div>

          {/* Trust indicators */}
          <motion.div {...fadeUp(0.15)} className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-[11px] text-slate-700">
            <span className="flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-slate-600" /> Chat is free
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-800" />
            <span className="flex items-center gap-1.5">
              <Rocket className="h-3 w-3 text-slate-600" /> No credit card
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-800" />
            <span className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-slate-600" /> Instant access
            </span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
