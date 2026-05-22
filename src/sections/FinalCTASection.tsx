import { motion } from 'framer-motion';
import { Zap, Globe, Rocket, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
});

export default function FinalCTASection() {
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
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-500/[0.06] border border-cyan-100 text-cyan-600 text-[11px] mb-6">
            <Zap className="h-3 w-3" />
            <span>Start building with AI today</span>
          </div>

          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[#111827] mb-5 tracking-tight leading-tight">
            Ready to{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-600 via-blue-400 to-violet-400">
              Build the Future
            </span>
            ?
          </h2>

          <p className="text-[15px] sm:text-base text-slate-600 max-w-lg mx-auto leading-relaxed mb-10">
            Join founders, traders, and creators using KorvixAI to turn ideas into reality. Casual chat is free — advanced features use credits.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
            <Link
              to="/signup"
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-white text-[14px] transition-all border border-white/[0.08]"
              style={{
                background: 'linear-gradient(180deg, #1B2230 0%, #11151C 100%)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}
            >
              <Rocket className="h-4 w-4" /> Create Account
            </Link>
            <Link
              to="/login"
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-[14px] transition-all duration-200"
              style={{
                background: 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(148,163,184,0.25)',
                color: '#475569',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.8)',
                backdropFilter: 'blur(12px)',
              }}
            >
              Sign In
              <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 transition-colors" />
            </Link>
          </div>

          {/* Trust indicators */}
          <motion.div {...fadeUp(0.15)} className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-slate-500" /> Chat is free
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-300" />
            <span className="flex items-center gap-1.5">
              <Rocket className="h-3 w-3 text-slate-500" /> No credit card
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-300" />
            <span className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-slate-500" /> Instant access
            </span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
