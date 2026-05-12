import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Play, Bot, TrendingUp, Zap, Activity } from 'lucide-react';
import { motion } from 'framer-motion';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.6, ease: 'easeOut' as const },
});

/* ─── Animated AI Dashboard Preview (Right Side) ─── */
function AIDashboardPreview() {
  return (
    <motion.div
      {...fadeUp(0.3)}
      className="relative w-full max-w-lg mx-auto lg:mx-0"
    >
      {/* Glow behind */}
      <div className="absolute -inset-4 bg-cyan-500/[0.03] rounded-3xl blur-2xl pointer-events-none" />

      {/* Main Panel */}
      <div className="relative rounded-2xl border border-white/[0.08] bg-[#0d0d14]/90 backdrop-blur-xl overflow-hidden shadow-2xl">
        {/* Header bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.05]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
          </div>
          <div className="ml-3 flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] text-slate-500 font-medium">KorvixAI Workspace</span>
          </div>
        </div>

        {/* Panel Content */}
        <div className="p-4 space-y-3">
          {/* AI Chat bubble */}
          <div className="flex gap-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
              <Sparkles className="h-3 w-3 text-cyan-400" />
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-medium">KorvixAI</span>
                <span className="text-[8px] px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-400">Pro</span>
              </div>
              <div className="rounded-xl rounded-tl-none bg-white/[0.04] border border-white/[0.04] px-3 py-2">
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Startup idea validated. Market score: <span className="text-emerald-400 font-medium">87/100</span>. TAM $4.2B. Ready for pitch deck?
                </p>
                {/* Typing indicator */}
                <div className="flex items-center gap-1 mt-1.5">
                  <div className="w-1 h-1 rounded-full bg-cyan-400 animate-typing-dot" />
                  <div className="w-1 h-1 rounded-full bg-cyan-400 animate-typing-dot" style={{ animationDelay: '0.15s' }} />
                  <div className="w-1 h-1 rounded-full bg-cyan-400 animate-typing-dot" style={{ animationDelay: '0.3s' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Mini widgets row */}
          <div className="grid grid-cols-3 gap-2">
            {/* Signal widget */}
            <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center gap-1 mb-1.5">
                <TrendingUp className="w-3 h-3 text-emerald-400" />
                <span className="text-[9px] text-slate-500">AAPL</span>
              </div>
              <p className="text-[13px] font-semibold text-white">$187.42</p>
              <p className="text-[9px] text-emerald-400">+2.34%</p>
              {/* Mini sparkline */}
              <div className="flex items-end gap-px h-5 mt-1.5">
                {[40,55,45,60,50,70,65,75,68,80].map((h,i) => (
                  <div key={i} className="flex-1 rounded-sm bg-emerald-500/30" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>

            {/* Agents widget */}
            <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center gap-1 mb-1.5">
                <Bot className="w-3 h-3 text-violet-400" />
                <span className="text-[9px] text-slate-500">Agents</span>
              </div>
              <p className="text-[13px] font-semibold text-white">5 Active</p>
              <div className="flex -space-x-1 mt-1.5">
                {['bg-orange-400','bg-emerald-400','bg-blue-400','bg-violet-400','bg-cyan-400'].map((c,i) => (
                  <div key={i} className={`w-4 h-4 rounded-full ${c} border border-[#0d0d14]`} />
                ))}
              </div>
            </div>

            {/* Activity widget */}
            <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center gap-1 mb-1.5">
                <Activity className="w-3 h-3 text-amber-400" />
                <span className="text-[9px] text-slate-500">Tasks</span>
              </div>
              <p className="text-[13px] font-semibold text-white">12 Done</p>
              <div className="w-full h-1 bg-white/[0.04] rounded-full mt-2 overflow-hidden">
                <motion.div
                  className="h-full bg-amber-400/60 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: '78%' }}
                  transition={{ delay: 0.8, duration: 1 }}
                />
              </div>
            </div>
          </div>

          {/* Notification strip */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/[0.04] border border-purple-500/10">
            <Zap className="w-3 h-3 text-purple-400 shrink-0" />
            <p className="text-[10px] text-slate-400 truncate">
              Ecommerce opportunity detected: <span className="text-purple-300">Smart Garden Hub</span> — Virality 87%
            </p>
          </div>
        </div>
      </div>

      {/* Floating accent cards */}
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-3 -right-3 p-2.5 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] backdrop-blur-sm shadow-lg"
      >
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] text-emerald-400 font-medium">Signal Live</span>
        </div>
      </motion.div>

      <motion.div
        animate={{ y: [0, 5, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute -bottom-3 -left-3 p-2.5 rounded-xl border border-violet-500/15 bg-violet-500/[0.06] backdrop-blur-sm shadow-lg"
      >
        <div className="flex items-center gap-1.5">
          <Bot className="w-3 h-3 text-violet-400" />
          <span className="text-[9px] text-violet-400 font-medium">3 agents on</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Social Proof Avatars ─── */
function SocialProof() {
  const avatars = [
    { initials: 'SC', bg: 'bg-cyan-500' },
    { initials: 'MJ', bg: 'bg-violet-500' },
    { initials: 'ER', bg: 'bg-emerald-500' },
    { initials: 'AK', bg: 'bg-orange-500' },
    { initials: 'DL', bg: 'bg-pink-500' },
  ];

  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {avatars.map((a, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.08 }}
            className={`flex h-7 w-7 items-center justify-center rounded-full ${a.bg} border-2 border-[#0a0a0f] text-[10px] font-bold text-white`}
          >
            {a.initials}
          </motion.div>
        ))}
      </div>
      <p className="text-[12px] text-slate-500">
        Trusted by <span className="text-slate-300 font-medium">10,000+</span> builders, founders, and creators
      </p>
    </div>
  );
}

/* ─── Main Hero Section ─── */
export default function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="relative pt-28 pb-16 md:pt-36 md:pb-24 lg:pt-40 lg:pb-32 overflow-hidden">
      {/* ==== Animated Background ==== */}
      {/* Radial gradient orbs */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-cyan-500/[0.04] rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-500/[0.05] rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-blue-500/[0.03] rounded-full blur-[120px] pointer-events-none" />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Floating particles */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-cyan-400/20 pointer-events-none"
          style={{
            left: `${15 + i * 15}%`,
            top: `${20 + (i % 3) * 25}%`,
          }}
          animate={{
            y: [0, -30, 0],
            opacity: [0.1, 0.4, 0.1],
          }}
          transition={{
            duration: 5 + i,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.7,
          }}
        />
      ))}

      {/* ==== Content ==== */}
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">

          {/* LEFT SIDE */}
          <div className="text-center lg:text-left">
            {/* Badge */}
            <motion.div {...fadeUp(0)} className="mb-6">
              <button
                onClick={() => navigate('/workspace')}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-500/15 bg-cyan-500/[0.05] backdrop-blur-sm px-4 py-1.5 hover:border-cyan-500/25 hover:bg-cyan-500/[0.08] transition-all duration-300"
              >
                <Sparkles className="h-3 w-3 text-cyan-400" />
                <span className="text-[12px] font-medium text-cyan-300/80">Introducing KorvixAI Workspace</span>
              </button>
            </motion.div>

            {/* Headline */}
            <motion.h1
              {...fadeUp(0.08)}
              className="text-4xl sm:text-5xl md:text-6xl lg:text-[64px] font-bold tracking-tight text-white mb-5 leading-[1.08]"
            >
              Your AI{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400">
                Operating
              </span>{' '}
              System
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              {...fadeUp(0.16)}
              className="text-base sm:text-lg text-slate-500 max-w-lg mx-auto lg:mx-0 mb-8 leading-relaxed"
            >
              Code, research, launch startups, run ecommerce, deploy AI agents, trade, and automate — all from one intelligent workspace.
            </motion.p>

            {/* CTAs */}
            <motion.div
              {...fadeUp(0.24)}
              className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 mb-8"
            >
              <Button
                size="lg"
                className="bg-white text-slate-950 hover:bg-slate-200 font-semibold px-7 h-12 text-[14px] group w-full sm:w-auto rounded-xl transition-all duration-300 hover:shadow-[0_0_30px_-8px_rgba(255,255,255,0.2)]"
                onClick={() => navigate('/chat')}
              >
                Launch Workspace
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="border-white/10 text-white hover:bg-white/[0.04] hover:border-white/15 font-semibold px-7 h-12 text-[14px] w-full sm:w-auto rounded-xl backdrop-blur-sm transition-all duration-300"
                onClick={() => navigate('/features')}
              >
                <Play className="mr-2 h-3.5 w-3.5" />
                Explore Ecosystem
              </Button>
            </motion.div>

            {/* Social Proof */}
            <motion.div {...fadeUp(0.32)} className="flex justify-center lg:justify-start">
              <SocialProof />
            </motion.div>
          </div>

          {/* RIGHT SIDE — Dashboard Preview */}
          <div className="flex justify-center lg:justify-end">
            <AIDashboardPreview />
          </div>

        </div>
      </div>
    </section>
  );
}
