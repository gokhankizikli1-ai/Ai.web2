import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { ArrowRight, Radar, MessageSquare, FolderKanban, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/stores/authStore';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
});

/* ─── Workspace preview ───
   Calm, generic mock that mirrors the real app's visual language
   (neutral surfaces, muted slate accent). Deliberately no numbers,
   scores, tickers, or avatars — nothing that implies real metrics. */
function WorkspacePreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.25, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full max-w-[460px] mx-auto lg:mx-0"
    >
      <div className="absolute -inset-6 bg-slate-900/[0.03] rounded-[40px] blur-2xl pointer-events-none" />

      <div className="relative rounded-2xl border border-[#DDE3EA] bg-white shadow-[0_8px_40px_-12px_rgba(16,24,39,0.1),0_2px_8px_-2px_rgba(16,24,39,0.04)] overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-[#F7F8FA]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
          </div>
          <span className="text-[10px] text-slate-500 font-medium ml-3">Korvix Workspace</span>
        </div>

        <div className="p-4 space-y-3">
          {/* Prompt line */}
          <div className="rounded-xl border border-slate-200 bg-[#F7F8FA] px-3 py-2.5">
            <p className="text-[11px] text-slate-600">Validate an idea for AI customer support tools</p>
          </div>

          {/* Assistant reply — plain text, no fabricated metrics */}
          <div className="flex gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#EEF1F4] border border-[#DDE3EA]">
              <MessageSquare className="h-3.5 w-3.5 text-[#52677A]" />
            </div>
            <div className="flex-1 rounded-xl rounded-tl-sm bg-white border border-slate-100 px-3 py-2.5">
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Scanning public discussions and clustering the loudest complaints into
                startup wedges…
              </p>
              <div className="flex gap-1 mt-2">
                <div className="w-1 h-1 rounded-full bg-[#7890A3] animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1 h-1 rounded-full bg-[#7890A3] animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1 h-1 rounded-full bg-[#7890A3] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>

          {/* Neutral section rows — structure only, no data claims */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Radar, label: 'Radar' },
              { icon: MessageSquare, label: 'Chat' },
              { icon: FolderKanban, label: 'Projects' },
            ].map((w) => (
              <div key={w.label} className="p-2.5 rounded-xl bg-[#F7F8FA] border border-slate-100">
                <w.icon className="w-3.5 h-3.5 text-[#52677A] mb-2" />
                <div className="h-1.5 w-3/4 rounded-full bg-slate-200" />
                <div className="h-1.5 w-1/2 rounded-full bg-slate-100 mt-1.5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function FeaturePills() {
  const features = ['Startup research', 'Market complaint radar', 'Focused AI chat', 'Project workspace'];
  return (
    <motion.div {...fadeUp(0.3)} className="flex flex-wrap gap-2 mt-6 justify-center lg:justify-start">
      {features.map((text) => (
        <div
          key={text}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#DDE3EA] text-[11px] text-slate-600"
        >
          <CheckCircle2 className="w-3 h-3 text-[#6F8F7A]" />
          {text}
        </div>
      ))}
    </motion.div>
  );
}

export default function HeroSection() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();

  return (
    <section className="relative pt-20 sm:pt-24 md:pt-28 lg:pt-32 pb-16 sm:pb-20 md:pb-24 overflow-hidden">
      {/* Single, very soft ambient wash — no neon glows */}
      <div className="absolute top-0 right-0 w-[520px] h-[520px] bg-[#52677A]/[0.04] rounded-full blur-[150px] pointer-events-none" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">

          {/* LEFT — Copy */}
          <div className="text-center lg:text-left">
            <motion.div {...fadeUp(0)} className="mb-5 inline-block">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#DDE3EA] bg-white px-4 py-1.5">
                <Radar className="h-3 w-3 text-[#52677A]" />
                <span className="text-[11px] font-semibold text-slate-600">Korvix Workspace</span>
              </span>
            </motion.div>

            <motion.h1
              {...fadeUp(0.08)}
              className="text-3xl sm:text-4xl md:text-5xl lg:text-[54px] font-bold tracking-tight text-[#101827] mb-4 sm:mb-5 leading-[1.1]"
            >
              Build and research from one AI workspace.
            </motion.h1>

            <motion.p
              {...fadeUp(0.16)}
              className="text-sm sm:text-base text-[#334155] max-w-lg mx-auto lg:mx-0 mb-7 leading-relaxed"
            >
              Korvix helps you validate startup ideas, research markets, plan products,
              and move work into focused AI workflows.
            </motion.p>

            <motion.div
              {...fadeUp(0.24)}
              className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3"
            >
              <Button
                size="lg"
                className="text-white hover:-translate-y-px font-semibold px-6 h-11 text-[13px] w-full sm:w-auto rounded-xl transition-all duration-300 border border-white/[0.08]"
                style={{
                  background: 'linear-gradient(180deg, #161C23 0%, #0B0E12 100%)',
                  boxShadow: '0 4px 16px rgba(16,24,39,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
                }}
                onClick={() => navigate(isAuthenticated ? '/workspace' : '/signup')}
              >
                Open Workspace
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="border-[#DDE3EA] text-slate-700 hover:bg-[#EEF1F4] hover:border-slate-400 hover:text-slate-900 font-medium px-6 h-11 text-[13px] w-full sm:w-auto rounded-xl transition-all duration-300"
                onClick={() => navigate('/tools/startup')}
              >
                Explore Startup Radar
              </Button>
            </motion.div>

            <FeaturePills />
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
