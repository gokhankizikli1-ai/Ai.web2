import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Bot, Play, Check, Lock, SkipForward, Trash2, RotateCcw, Info,
  Loader2, Search, Zap, Calculator, PencilLine, Sparkles, ListChecks,
} from 'lucide-react';
import { useAgentRuns, critiqueStep } from '@/hooks/useAgentRuns';
import type { AgentRun, AgentStep, AgentStepKind } from '@/types';

/**
 * Autopilot — Phase 4 #4A/4B. A dry-run agent run engine: a deterministic
 * planner turns the goal into a typed task graph; analyze/draft steps route
 * a structured prompt into the normal chat, compute steps capture the user's
 * own numbers, and research/act steps are honest "requires approval"
 * placeholders (no external-data or execution gate is open). Runs persist to
 * localStorage only — nothing is fabricated or executed.
 */
const KIND: Record<AgentStepKind, { label: string; icon: typeof Bot; tint: string }> = {
  analyze: { label: 'Analyze', icon: Sparkles, tint: 'text-sky-400' },
  draft: { label: 'Draft', icon: PencilLine, tint: 'text-sky-400' },
  compute: { label: 'Compute', icon: Calculator, tint: 'text-cyan-400' },
  research: { label: 'Research', icon: Search, tint: 'text-amber-400' },
  act: { label: 'Act', icon: Zap, tint: 'text-amber-400' },
};

function StatusDot({ status }: { status: AgentStep['status'] }) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />;
  if (status === 'done') return <Check className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'blocked') return <Lock className="w-3.5 h-3.5 text-amber-400/80" />;
  if (status === 'skipped') return <SkipForward className="w-3.5 h-3.5 text-slate-600" />;
  return <span className="h-2 w-2 rounded-full bg-slate-600" />;
}

export default function AutopilotPanel({ onRunPrompt }: { onRunPrompt?: (p: string) => void }) {
  const { runs, createRun, updateStep, replayRun, removeRun } = useAgentRuns();
  const [goal, setGoal] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const active: AgentRun | null = useMemo(() => {
    const id = activeId ?? runs[0]?.id ?? null;
    return runs.find((r) => r.id === id) ?? null;
  }, [runs, activeId]);

  const plan = () => {
    const g = goal.trim();
    if (!g) return;
    const id = createRun(g);
    setActiveId(id);
    setGoal('');
  };

  const runStep = (step: AgentStep) => {
    if (!active) return;
    if (step.prompt) onRunPrompt?.(step.prompt);
    updateStep(active.id, step.id, { status: 'running' });
  };

  const completeStep = (step: AgentStep, output?: string) => {
    if (!active) return;
    const next: AgentStep = { ...step, output: output ?? step.output };
    const c = critiqueStep(next);
    updateStep(active.id, step.id, {
      status: 'done',
      output: next.output,
      confidence: c.confidence,
      needsRealData: c.needsRealData,
    });
  };

  const done = active ? active.steps.filter((s) => s.status === 'done').length : 0;
  const total = active ? active.steps.length : 0;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Bot className="w-3.5 h-3.5 text-sky-400" />
        <span className="text-[12px] font-medium text-slate-300">Autopilot — dry-run agent runs</span>
      </div>

      {/* Goal → plan */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4 space-y-2.5">
        <div className="flex items-center gap-2">
          <ListChecks className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-[12px] font-medium text-slate-300">Goal</span>
        </div>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={2}
          placeholder="e.g. Launch a landing page for a home-fitness coaching offer and get the first 10 signups."
          className="w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-sky-500/20 transition-all resize-none"
        />
        <button
          onClick={plan}
          disabled={!goal.trim()}
          className={`h-8 px-3 flex items-center gap-1.5 rounded-lg text-[11px] font-medium transition-all ${
            goal.trim()
              ? 'bg-sky-500/[0.1] border border-sky-500/20 text-sky-300 hover:bg-sky-500/[0.16]'
              : 'bg-white/[0.02] border border-white/[0.04] text-slate-600 cursor-default'
          }`}
        >
          <Bot className="w-3 h-3" /> Plan run
        </button>
      </div>

      {/* Active run */}
      {active && (
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wide text-slate-600 mb-0.5">Active run</p>
              <p className="text-[12px] text-slate-300 leading-relaxed break-words">{active.goal}</p>
            </div>
            <span className="shrink-0 text-[10px] text-slate-500 tabular-nums">{done}/{total}</span>
          </div>
          <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
            <div
              className="h-full bg-sky-500/40 transition-all"
              style={{ width: total ? `${(done / total) * 100}%` : '0%' }}
            />
          </div>

          <div className="space-y-2">
            {active.steps.map((step, i) => {
              const meta = KIND[step.kind];
              const Icon = meta.icon;
              const locked = step.kind === 'research' || step.kind === 'act';
              const terminal = step.status === 'done' || step.status === 'skipped' || step.status === 'blocked';
              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className={`rounded-lg border p-3 ${
                    step.status === 'running'
                      ? 'border-sky-500/20 bg-sky-500/[0.03]'
                      : 'border-white/[0.04] bg-white/[0.01]'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 items-center justify-center shrink-0">
                      <StatusDot status={step.status} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Icon className={`w-3 h-3 ${meta.tint} shrink-0`} />
                        <span className="text-[9px] uppercase tracking-wide text-slate-600">{meta.label}</span>
                        <span className="text-[12px] font-medium text-slate-200">{step.title}</span>
                        {typeof step.confidence === 'number' && step.status === 'done' && (
                          <span className="text-[9px] text-slate-500">· {step.confidence}% conf</span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-600 leading-relaxed mt-0.5">{step.detail}</p>

                      {step.needsRealData && step.status === 'done' && (
                        <p className="mt-1 text-[10px] text-amber-400/70">
                          ⚠ Quality depends on live data not connected — verify before relying on it.
                        </p>
                      )}

                      {locked ? (
                        <div className="mt-2 rounded-md border border-amber-500/15 bg-amber-500/[0.04] px-2.5 py-2">
                          <p className="text-[10px] text-amber-400/80 leading-relaxed">{step.blockedReason}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              disabled
                              title="Execution gate is closed"
                              className="h-6 px-2 flex items-center gap-1 rounded-md bg-white/[0.02] border border-white/[0.05] text-[10px] text-slate-600 cursor-not-allowed"
                            >
                              <Lock className="w-2.5 h-2.5" /> Approve & run (locked)
                            </button>
                            {!terminal && (
                              <button
                                onClick={() => updateStep(active.id, step.id, { status: 'skipped' })}
                                className="h-6 px-2 flex items-center gap-1 rounded-md bg-white/[0.02] border border-white/[0.05] text-[10px] text-slate-400 hover:text-slate-200 transition-colors"
                              >
                                <SkipForward className="w-2.5 h-2.5" /> Skip & continue
                              </button>
                            )}
                          </div>
                        </div>
                      ) : step.kind === 'compute' ? (
                        step.status === 'done' ? (
                          <p className="mt-2 text-[11px] text-slate-400 whitespace-pre-wrap">{step.output}</p>
                        ) : (
                          <div className="mt-2 space-y-1.5">
                            <textarea
                              value={drafts[step.id] ?? ''}
                              onChange={(e) => setDrafts((d) => ({ ...d, [step.id]: e.target.value }))}
                              rows={2}
                              placeholder="Your own target metrics (e.g. 10 signups in 14 days, CAC < $8)"
                              className="w-full px-2.5 py-1.5 rounded-md bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-cyan-500/20 transition-all resize-none"
                            />
                            <button
                              onClick={() => completeStep(step, (drafts[step.id] ?? '').trim())}
                              disabled={!(drafts[step.id] ?? '').trim()}
                              className={`h-6 px-2 flex items-center gap-1 rounded-md text-[10px] transition-colors ${
                                (drafts[step.id] ?? '').trim()
                                  ? 'bg-cyan-500/[0.1] border border-cyan-500/20 text-cyan-300 hover:bg-cyan-500/[0.16]'
                                  : 'bg-white/[0.02] border border-white/[0.05] text-slate-600 cursor-default'
                              }`}
                            >
                              <Check className="w-2.5 h-2.5" /> Save & complete
                            </button>
                          </div>
                        )
                      ) : (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          {step.status !== 'done' && (
                            <button
                              onClick={() => runStep(step)}
                              className="h-6 px-2 flex items-center gap-1 rounded-md bg-sky-500/[0.1] border border-sky-500/20 text-[10px] text-sky-300 hover:bg-sky-500/[0.16] transition-colors"
                            >
                              <Play className="w-2.5 h-2.5" />
                              {step.status === 'running' ? 'Re-run in chat' : 'Run in chat'}
                            </button>
                          )}
                          {step.status === 'running' && (
                            <button
                              onClick={() => completeStep(step)}
                              className="h-6 px-2 flex items-center gap-1 rounded-md bg-emerald-500/[0.1] border border-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/[0.16] transition-colors"
                            >
                              <Check className="w-2.5 h-2.5" /> Mark complete
                            </button>
                          )}
                          {step.status === 'done' && (
                            <span className="text-[10px] text-emerald-400/70 flex items-center gap-1">
                              <Check className="w-2.5 h-2.5" /> Routed to chat
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {active.status === 'completed' && (
            <p className="text-[10px] text-emerald-400/70">Run complete — replay it below to run again.</p>
          )}
        </div>
      )}

      {/* Run history (localStorage only) */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
        <p className="text-[9px] uppercase tracking-wide text-slate-600 mb-2">Run history</p>
        {runs.length === 0 ? (
          <p className="text-[11px] text-slate-600">No runs yet — set a goal above and plan a run.</p>
        ) : (
          <div className="space-y-1.5">
            {runs.map((r) => {
              const d = r.steps.filter((s) => s.status === 'done').length;
              return (
                <div
                  key={r.id}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                    active?.id === r.id ? 'border-sky-500/20 bg-sky-500/[0.03]' : 'border-white/[0.04] bg-white/[0.01]'
                  }`}
                >
                  <button onClick={() => setActiveId(r.id)} className="min-w-0 flex-1 text-left">
                    <p className="text-[11px] text-slate-300 truncate">{r.goal}</p>
                    <p className="text-[9px] text-slate-600">
                      {r.status} · {d}/{r.steps.length} · {new Date(r.updatedAt).toLocaleDateString()}
                    </p>
                  </button>
                  <button
                    onClick={() => { replayRun(r.id); setActiveId(r.id); }}
                    title="Replay run"
                    className="h-6 w-6 flex items-center justify-center rounded-md text-slate-600 hover:text-sky-300 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => { removeRun(r.id); if (active?.id === r.id) setActiveId(null); }}
                    title="Delete run"
                    className="h-6 w-6 flex items-center justify-center rounded-md text-slate-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
        <Info className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
        <p className="text-[10px] text-slate-600 leading-relaxed">
          Dry-run only. Analyze/draft steps route a structured prompt into the normal chat; compute
          steps record your own numbers. Research &amp; side-effect (act) steps are not executed —
          they require an approval gate that is not open. Runs are saved locally in this browser only.
        </p>
      </div>
    </div>
  );
}
