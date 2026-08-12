import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Sparkles, Plus } from 'lucide-react';
import BuilderWorkspaceFrame from '@/components/builder/BuilderWorkspaceFrame';
import BuilderPromptCard from '@/components/builder/BuilderPromptCard';
import DesignInterview from '@/components/builder/DesignInterview';
import ChatWebBuild from '@/components/ChatWebBuild';
import { buildEnhancedPrompt, promptHasDesignDetail, resolveBriefAnswers, smartDefaultsFromPrompt } from '@/lib/designBrief';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const EXAMPLE_PROMPTS = [
  'Build a CRM for a small sales team',
  'Build a fitness coaching app with programs, progress tracking and a schedule',
  'Build a personal productivity task manager',
  'Build a booking management app',
  'Build a SaaS analytics dashboard',
];

// PRODUCTION App Build surface. This page is now a THIN entry point onto the
// canonical, shared Build spine — the SAME mature frontend-files-v1 pipeline the
// "App" chip on chat home uses (planning → app screen/navigation contracts →
// multi-file React/Vite generation → static validation → review → single repair →
// acceptance → model-native preview → persistence). It carries buildType='app' so
// the shared spine and its analyzers branch on a real build type rather than
// re-inferring "app vs website" from prompt text.
//
// It intentionally NO LONGER routes through the legacy `/v2/intelligence/orchestrate`
// single-file HTML prototype (that orchestrator remains available for generic Korvix
// Core orchestration work, but it is not the production App Build artifact anymore).
export default function AppBuilder() {
  const [idea, setIdea] = useState('');
  const [briefPrompt, setBriefPrompt] = useState<string | null>(null);
  // When set, the mature embedded Build pipeline (ChatWebBuild) takes over the
  // surface with build context = app. `key` forces a clean remount per build.
  const [building, setBuilding] = useState<{ prompt: string; key: string } | null>(null);

  const startBuild = useCallback((finalPrompt: string) => {
    const trimmed = finalPrompt.trim();
    if (!trimmed) return;
    setBriefPrompt(null);
    setBuilding({ prompt: trimmed, key: `app-build-${Date.now().toString(36)}` });
  }, []);

  const handleGenerate = () => {
    if (!idea.trim() || building) return;
    // Rich prompts go straight to the pipeline; thin prompts get the inline
    // Design Interview first (same enhanced-prompt contract the web builder uses).
    if (promptHasDesignDetail(idea)) {
      // Resolve smart defaults so the enhanced prompt still carries a design brief.
      startBuild(buildEnhancedPrompt(idea, resolveBriefAnswers(idea) || smartDefaultsFromPrompt(idea)));
      return;
    }
    setBriefPrompt(idea);
  };

  const resetToNew = () => {
    setBuilding(null);
    setIdea('');
    setBriefPrompt(null);
  };

  const showInterview = !!briefPrompt && !building;

  return (
    <BuilderWorkspaceFrame
      icon={<Cpu className="h-4 w-4 text-[#3B82F6]" />}
      title="App Builder"
      subtitle="Describe the app you want — Korvix plans the screens, navigation and flows, then builds a real multi-screen React application through the production pipeline"
      accent="#3B82F6"
      maxWidth="max-w-5xl"
    >
      {/* Active build — the REAL generated multi-file project, its model-native
          preview, save/reopen and refine all owned by the shared spine. */}
      {building ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={resetToNew}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-[11px] text-[#94A3B8] hover:text-white hover:border-white/[0.16] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> New app
            </button>
          </div>
          <div className="rounded-2xl border border-white/[0.05] bg-white/[0.012] overflow-hidden min-h-[70vh] flex flex-col">
            <ChatWebBuild key={building.key} initialPrompt={building.prompt} initialMode="app" />
          </div>
        </motion.div>
      ) : (
        <>
          {/* Input */}
          <motion.div {...fadeUp(0.05)} className="mb-6">
            <BuilderPromptCard
              value={idea}
              onChange={setIdea}
              onSubmit={handleGenerate}
              placeholder="Describe the app you want to build…"
              ctaLabel="Build app"
              busyLabel="Building…"
              busy={false}
              accent="#3B82F6"
              accent2="#60A5FA"
              examples={EXAMPLE_PROMPTS}
              onExampleSelect={setIdea}
            />
          </motion.div>

          {/* Design Interview — Korvix asks the design questions inline; only the
              hidden enhanced prompt (built on "Build now") carries the brief. */}
          <AnimatePresence mode="wait">
            {showInterview && (
              <motion.div
                key="interview"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="mb-6 max-w-2xl mx-auto rounded-2xl border border-white/[0.05] bg-white/[0.012] p-4 sm:p-5"
              >
                <DesignInterview
                  prompt={briefPrompt || ''}
                  onBuild={startBuild}
                  onCancel={() => setBriefPrompt(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Empty state */}
          {!showInterview && (
            <motion.div {...fadeUp(0.1)} className="max-w-lg mx-auto text-center py-14">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
                <Sparkles className="w-6 h-6 text-[#60A5FA]/70" />
              </div>
              <h3 className="text-[15px] font-medium text-white mb-2">Describe the app you want to build</h3>
              <p className="text-[12px] text-[#94A3B8] leading-relaxed mb-6">
                Korvix plans a credible screen architecture and navigation for your product, then generates a real,
                validated multi-screen React application — the same production pipeline behind every Korvix build.
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {['Dashboard', 'CRM', 'Fitness', 'Booking', 'Productivity', 'Utility'].map((c) => (
                  <span key={c} className="px-2.5 py-1 rounded-full bg-white/[0.02] border border-white/[0.05] text-[10px] text-[#94A3B8]">{c}</span>
                ))}
              </div>
            </motion.div>
          )}
        </>
      )}
    </BuilderWorkspaceFrame>
  );
}
