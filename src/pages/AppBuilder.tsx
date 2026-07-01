import { useState } from 'react';
import { motion } from 'framer-motion';
import { Cpu, Wand2, Loader2 } from 'lucide-react';
import Navigation from '@/components/Navigation';
import PreviewResult from '@/components/PreviewResult';
import AppPreviewShell from '@/components/builder/AppPreviewShell';
import { useOrchestrateResult } from '@/hooks/useOrchestrateResult';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

// Sprint 1.6 — the first real end-to-end "Plan → Run → Result" surface.
// The page is only a host: it sends the prompt to the backend and renders
// whatever the Deliverable Result resolver returns. It imposes NO vertical —
// Product Intelligence classifies the prompt server-side — so the same wiring
// works for any future module without change. Nothing here is mocked.
export default function AppBuilder() {
  const [idea, setIdea] = useState('');
  const { phase, label, payload, error, disabledReason, disabledPrerequisites, isBusy, run } =
    useOrchestrateResult();

  const handleGenerate = () => {
    if (!idea.trim() || isBusy) return;
    run(idea);
  };

  const showResult = phase !== 'idle';

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          <motion.div {...fadeUp(0)} className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/[0.1] border border-indigo-500/15">
                <Cpu className="h-4 w-4 text-indigo-400" />
              </div>
              <h1 className="text-2xl font-semibold text-white tracking-tight">App Builder</h1>
            </div>
            <p className="text-[13px] text-slate-500 ml-11">Describe what you want to build — it plans, runs, and shows the result</p>
          </motion.div>

          {/* Input */}
          <motion.div {...fadeUp(0.05)} className="mb-6">
            <div className="flex gap-2">
              <input
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="Describe what you want to build..."
                className="flex-1 h-12 px-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[14px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/20 focus:bg-white/[0.03] transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              />
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerate}
                disabled={isBusy || !idea.trim()}
                className="h-12 px-6 rounded-xl bg-indigo-500/[0.1] border border-indigo-500/15 text-indigo-400 font-medium text-[13px] hover:bg-indigo-500/[0.15] transition-colors disabled:opacity-40 flex items-center gap-2"
              >
                {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {isBusy ? label : 'Plan'}
              </motion.button>
            </div>
          </motion.div>

          {/* Result — driven entirely by the backend PreviewPayload, wrapped
              in a premium app-shell frame (topbar/sidebar/stat cards). */}
          {showResult && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <AppPreviewShell idea={idea} phase={phase}>
                <PreviewResult
                  phase={phase}
                  label={label}
                  payload={payload}
                  error={error}
                  disabledReason={disabledReason}
                  disabledPrerequisites={disabledPrerequisites}
                  onRetry={handleGenerate}
                />
              </AppPreviewShell>
            </motion.div>
          )}

          {/* Empty state */}
          {phase === 'idle' && (
            <motion.div {...fadeUp(0.1)} className="text-center py-16">
              <Cpu className="w-12 h-12 text-[#64748B] mx-auto mb-4" />
              <h3 className="text-sm font-medium text-white mb-1">Describe what you want to build</h3>
              <p className="text-[12px] text-slate-500">Your prompt is planned, run by the orchestrator, and the result is shown here</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
