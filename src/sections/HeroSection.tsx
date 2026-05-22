import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, TrendingUp, Bot, Activity, Zap, BarChart3, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
});

/* ─── Floating Workspace Preview Card ─── */
function WorkspacePreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.25, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full max-w-[460px] mx-auto lg:mx-0"
    >
      {/* Soft ambient shadow */}
      <div className="absolute -inset-4 bg-slate-900/[0.04] rounded-3xl blur-2xl pointer-events-none" />
      <div className="absolute -inset-8 bg-cyan-500/[0.02] rounded-[40px] blur-3xl pointer-events-none" />

      <div className="relative rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08),0_2px_8px_-2px_rgba(0,0,0,0.04)] overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
          </div>
          <div className="flex items-center gap-1.5 ml-3">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-slate-500 font-medium">KorvixAI Workspace</span>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* AI Message */}
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-50 border border-cyan-100">
              <Sparkles className="h-3.5 w-3.5 text-cyan-600" />
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 font-semibold">KorvixAI</span>
                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-600 border border-cyan-100 font-medium">Pro</span>
              </div>
              <div className="rounded-xl rounded-tl-sm bg-slate-50 border border-slate-100 px-3 py-2.5">
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Startup idea validated. Market score: <span className="text-emerald-600 font-semibold">87/100</span>. TAM $4.2B. Ready for pitch deck?
                </p>
                <div className="flex gap-1 mt-2">
                  <div className="w-1 h-1 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1 h-1 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1 h-1 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Widgets Row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-1 mb-1.5">
                <TrendingUp className="w-3 h-3 text-emerald-500" />
                <span className="text-[9px] text-slate-500 font-medium">AAPL</span>
              </div>
              <p className="text-[13px] font-bold text-slate-500">$187.42</p>
              <p className="text-[9px] text-emerald-600 font-semibold">+2.34%</p>
              <div className="flex items-end gap-px h-5 mt-1.5">
                {[40,55,45,60,50,70,65,75,68,80].map((h,i) => (
                  <div key={i} className="flex-1 rounded-sm bg-emerald-400/30" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-1 mb-1.5">
                <Bot className="w-3 h-3 text-violet-500" />
                <span className="text-[9px] text-slate-500 font-medium">Agents</span>
              </div>
              <p className="text-[13px] font-bold text-slate-500">5 Active</p>
              <div className="flex -space-x-1 mt-1.5">
                {['bg-orange-400','bg-emerald-400','bg-blue-400','bg-violet-400','bg-cyan-400'].map((c,i) => (
                  <div key={i} className={`w-4 h-4 rounded-full ${c} border-2 border-white`} />
                ))}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-1 mb-1.5">
                <Activity className="w-3 h-3 text-amber-500" />
                <span className="text-[9px] text-slate-500 font-medium">Tasks</span>
              </div>
              <p className="text-[13px] font-bold text-slate-500">12 Done</p>
              <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                <motion.div className="h-full bg-amber-400 rounded-full" initial={{ width: 0 }} animate={{ width: '78%' }} transition={{ delay: 0.8, duration: 1 }} />
              </div>
            </div>
          </div>

          {/* Insight Strip */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-violet-50/80 border border-violet-100">
            <Zap className="w-3 h-3 text-violet-500 shrink-0" />
            <p className="text-[10px] text-slate-500 truncate">
              Ecommerce opportunity: <span className="text-violet-700 font-semibold">Smart Garden Hub</span> — Virality 87%
            </p>
          </div>
        </div>
      </div>

      {/* Floating accent pills */}
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-2 -right-2 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50/90 backdrop-blur-sm shadow-sm"
      >
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[9px] text-emerald-700 font-semibold">Signal Live</span>
        </div>
      </motion.div>

      <motion.div
        animate={{ y: [0, 4, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute -bottom-2 -left-2 px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50/90 backdrop-blur-sm shadow-sm"
      >
        <div className="flex items-center gap-1.5">
          <Bot className="w-3 h-3 text-violet-500" />
          <span className="text-[9px] text-violet-700 font-semibold">3 agents on</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Social Proof ─── */
const AVATARS = [
  { initials: 'SC', gradient: 'from-cyan-400 to-blue-400', shadow: '0 2px 8px rgba(34,211,238,0.25)', text: 'text-white' },
  { initials: 'MJ', gradient: 'from-emerald-400 to-teal-400', shadow: '0 2px 8px rgba(52,211,153,0.25)', text: 'text-white' },
  { initials: 'ER', gradient: 'from-violet-400 to-purple-400', shadow: '0 2px 8px rgba(167,139,250,0.25)', text: 'text-white' },
  { initials: 'AK', gradient: 'from-sky-400 to-indigo-400', shadow: '0 2px 8px rgba(96,165,250,0.25)', text: 'text-white' },
  { initials: 'DL', gradient: 'from-teal-400 to-cyan-400', shadow: '0 2px 8px rgba(45,212,191,0.25)', text: 'text-white' },
];

function SocialProof() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-1.5">
        {AVATARS.map((a, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.08, duration: 0.3 }}
            className={`flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br ${a.gradient} border-[1.5px] border-white text-[10px] font-bold ${a.text} shadow-sm`}
            style={{ boxShadow: a.shadow, zIndex: AVATARS.length - i }}
          >
            {a.initials}
          </motion.div>
        ))}
      </div>
      <p className="text-[12px] text-slate-500">
        Trusted by{' '}
        <span className="font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-600 to-blue-600">
          10,000+
        </span>{' '}
        builders and founders
      </p>
    </div>
  );
}

/* ─── Feature Pills ─── */
function FeaturePills() {
  const features = [
    { icon: CheckCircle2, text: 'Startup validation' },
    { icon: CheckCircle2, text: 'AI code generation' },
    { icon: CheckCircle2, text: 'Live trading signals' },
    { icon: CheckCircle2, text: 'Ecommerce automation' },
  ];

  return (
    <motion.div {...fadeUp(0.3)} className="flex flex-wrap gap-2 mt-6">
      {features.map((f, i) => (
        <div
          key={i}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-[11px] text-slate-600"
        >
          <f.icon className="w-3 h-3 text-emerald-500" />
          {f.text}
        </div>
      ))}
    </motion.div>
  );
}

/* ─── Main Hero Section ─── */
export default function HeroSection() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();

  return (
    <section className="relative pt-20 sm:pt-24 md:pt-28 lg:pt-32 pb-16 sm:pb-20 md:pb-24 overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-cyan-400/[0.04] rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-400/[0.03] rounded-full blur-[120px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">

          {/* LEFT — Copy */}
          <div className="text-center lg:text-left">
            {/* Badge */}
            <motion.div {...fadeUp(0)} className="mb-5 inline-block">
              <button
                onClick={() => navigate('/workspace')}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50/80 backdrop-blur-sm px-4 py-1.5 hover:border-cyan-300 hover:bg-cyan-50 transition-all duration-300"
              >
                <Sparkles className="h-3 w-3 text-cyan-500" />
                <span className="text-[11px] font-semibold text-cyan-700">Introducing KorvixAI Workspace</span>
              </button>
            </motion.div>

            {/* Headline */}
            <motion.h1
              {...fadeUp(0.08)}
              className="text-3xl sm:text-4xl md:text-5xl lg:text-[56px] font-bold tracking-tight text-slate-900 mb-4 sm:mb-5 leading-[1.1]"
            >
              Your AI{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 to-blue-600">
                Operating
              </span>{' '}
              System
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              {...fadeUp(0.16)}
              className="text-sm sm:text-base text-slate-500 max-w-lg mx-auto lg:mx-0 mb-7 leading-relaxed"
            >
              Code, research, launch startups, run ecommerce, deploy AI agents, trade, and automate — all from one intelligent workspace.
            </motion.p>

            {/* CTAs */}
            <motion.div
              {...fadeUp(0.24)}
              className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3"
            >
              {isAuthenticated ? (
                <>
                  <Button
                    size="lg"
                    className="text-white hover:-translate-y-px font-semibold px-6 h-11 text-[13px] w-full sm:w-auto rounded-xl transition-all duration-300 border border-white/[0.08]"
                    style={{
                      background: 'linear-gradient(180deg, #1B2230 0%, #11151C 100%)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)',
                    }}
                    onClick={() => navigate('/workspace')}
                  >
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Go to Workspace
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 font-medium px-6 h-11 text-[13px] w-full sm:w-auto rounded-xl transition-all duration-300"
                    onClick={() => navigate('/chat')}
                  >
                    Open Chat
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="lg"
                    className="text-white hover:-translate-y-px font-semibold px-6 h-11 text-[13px] w-full sm:w-auto rounded-xl transition-all duration-300 border border-white/[0.08]"
                    style={{
                      background: 'linear-gradient(180deg, #1B2230 0%, #11151C 100%)',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06)',
                    }}
                    onClick={() => navigate('/signup')}
                  >
                    Get Started Free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 font-medium px-6 h-11 text-[13px] w-full sm:w-auto rounded-xl transition-all duration-300"
                    onClick={() => navigate('/login')}
                  >
                    Sign In
                  </Button>
                </>
              )}
            </motion.div>

            {/* Feature Pills */}
            <FeaturePills />

            {/* Social Proof */}
            <motion.div {...fadeUp(0.38)} className="mt-8 flex justify-center lg:justify-start">
              <SocialProof />
            </motion.div>
          </div>

          {/* RIGHT — Workspace Preview */}
          <div className="flex justify-center lg:justify-end">
            <WorkspacePreview />
          </div>
        </div>
      </div>
    </section>
  );
}
