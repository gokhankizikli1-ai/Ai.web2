import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Sparkles } from 'lucide-react';
import PreviewResult from '@/components/PreviewResult';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import BuilderPromptCard from '@/components/builder/BuilderPromptCard';
import AppPreviewShell from '@/components/builder/AppPreviewShell';
import DesignInterview from '@/components/builder/DesignInterview';
import { promptHasDesignDetail } from '@/lib/designBrief';
import { useOrchestrateResult } from '@/hooks/useOrchestrateResult';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const EXAMPLE_PROMPTS = [
  'Build a premium Shopify analytics dashboard for a fashion store',
  'Build a CRM dashboard for a sales team',
  'Design an internal ops console for support requests',
  'Build a crypto trading dashboard',
];

// Sprint 1.6 — the first real end-to-end "Plan → Run → Result" surface.
// The page is only a host: it sends the prompt to the backend and renders
// whatever the Deliverable Result resolver returns. It imposes NO vertical —
// Product Intelligence classifies the prompt server-side — so the same wiring
// works for any future module without change. Nothing here is mocked; only
// the chrome around the result (sidebar/module cards/metrics/activity) is
// decorative, prompt-derived UI — the artifact itself stays fully driven by
// the backend result payload.
export default function AppBuilder() {
  const [idea, setIdea] = useState('');
  const [briefPrompt, setBriefPrompt] = useState<string | null>(null);
  const { phase, label, payload, error, disabledReason, disabledPrerequisites, isBusy, run } =
    useOrchestrateResult();

  const handleGenerate = () => {
    if (!idea.trim() || isBusy) return;
    if (promptHasDesignDetail(idea)) { run(idea); return; }
    setBriefPrompt(idea);
  };

  const showResult = phase !== 'idle';
  const showInterview = !!briefPrompt;

  return (
    <BuilderWorkspaceFrame
      icon={<Cpu className="h-4 w-4 text-indigo-400" />}
      title="App Builder"
      subtitle="Describe what you want to build — Korvix locks a design direction, then plans, runs, and shows a real product workspace"
      accent="#818cf8"
      maxWidth="max-w-5xl"
    >
      {/* Input */}
      <motion.div {...fadeUp(0.05)} className="mb-6">
        <BuilderPromptCard
          value={idea}
          onChange={setIdea}
          onSubmit={handleGenerate}
          placeholder="Describe what you want to build…"
          ctaLabel="Plan"
          busyLabel={label}
          busy={isBusy}
          accent="#818cf8"
          accent2="#22d3ee"
          examples={EXAMPLE_PROMPTS}
          onExampleSelect={setIdea}
        />
      </motion.div>

      {/* Design Interview — Korvix asks the design questions as chat
          messages inline in the page, never a floating modal. Only the
          hidden enhanced prompt (built once "Build now" fires) carries
          the DESIGN_BRIEF block to the backend. */}
      <AnimatePresence mode="wait">
        {showInterview && (
          <motion.div
            key="interview"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-6 max-w-2xl mx-auto rounded-2xl border border-white/[0.05] bg-white/[0.012] p-4 sm:p-5"
          >
            <DesignInterview
              prompt={briefPrompt || ''}
              onBuild={(enhanced) => { setBriefPrompt(null); run(enhanced); }}
              onCancel={() => setBriefPrompt(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result — driven entirely by the backend PreviewPayload, wrapped
          in a premium app-shell frame (sidebar/topbar/module cards/metrics/
          activity panel). */}
      {showResult && !showInterview && (
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
      {phase === 'idle' && !showInterview && (
        <motion.div {...fadeUp(0.1)} className="max-w-lg mx-auto text-center py-14">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
            <Sparkles className="w-6 h-6 text-indigo-300/70" />
          </div>
          <h3 className="text-[15px] font-medium text-white mb-2">Describe what you want to build</h3>
          <p className="text-[12px] text-slate-500 leading-relaxed mb-6">
            Korvix locks a design direction, plans the build, runs it through the orchestrator, and shows the
            result inside a real product workspace — sidebar, module cards, metrics and activity included.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {['Dashboard', 'CRM', 'Analytics', 'Internal Tool', 'AI Product'].map((c) => (
              <span key={c} className="px-2.5 py-1 rounded-full bg-white/[0.02] border border-white/[0.05] text-[10px] text-slate-500">{c}</span>
            ))}
          </div>
        </motion.div>
      )}
    </BuilderWorkspaceFrame>
  );
}
