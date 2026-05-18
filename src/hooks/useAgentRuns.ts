import { useState, useEffect, useCallback } from 'react';
import type { AgentRun, AgentStep, AgentStepStatus } from '@/types';

/**
 * Agent Run Engine — Phase 4 #4A/4B. localStorage only (no backend / DB /
 * env / secrets). The planner is DETERMINISTIC structuring of the user's
 * own goal — it never invents market/competitor data. analyze/draft steps
 * route a structured prompt into the normal chat; compute steps capture the
 * user's own numbers; research/act steps are honest "requires approval"
 * placeholders because no external-data or execution gate is open.
 */
const LS_KEY = 'korvix.agent.runs.v1';
const MAX_RUNS = 50;

function rid(prefix: string): string {
  return crypto.randomUUID
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadRuns(): AgentRun[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const a = JSON.parse(raw);
      if (Array.isArray(a)) return a as AgentRun[];
    }
  } catch { /* ignore */ }
  return [];
}

type StepSeed = Omit<AgentStep, 'id' | 'status'> & Partial<Pick<AgentStep, 'status'>>;

/**
 * Pure planner: turns a goal into a typed, dependency-ordered task graph.
 * No data is fabricated — research/act steps are explicitly blocked with an
 * honest reason rather than pretending to have live data or execution.
 */
export function planRun(goalRaw: string): AgentStep[] {
  const goal = goalRaw.trim();
  const g = goal.toLowerCase();
  const wantsResearch = /(market|competitor|trend|pricing|audience|demand|seo|keyword|industry|research)/.test(g);
  const wantsBuild = /(launch|build|store|site|website|app|product|campaign|content|ad|ads|funnel|email|publish|post)/.test(g);

  const seeds: StepSeed[] = [];

  seeds.push({
    kind: 'analyze',
    title: 'Clarify goal & success criteria',
    detail: 'Restate the goal precisely and define what "done" looks like.',
    prompt: `Act as an autonomous operator. Restate this goal precisely, list 3–5 measurable success criteria, the key unknowns, and the single clarifying question (if any) that would materially change the plan. Goal: "${goal}". Do not fabricate data — explicitly flag where real research is required.`,
  });

  seeds.push({
    kind: 'analyze',
    title: 'Decompose into a strategy',
    detail: 'Break the goal into a sequenced, dependency-aware strategy.',
    prompt: `Decompose this goal into a sequenced strategy: ordered steps with dependencies, which steps are AI-doable vs. need human approval, and the single riskiest assumption to test first. Goal: "${goal}". Be concrete and honest about what needs live data.`,
  });

  if (wantsResearch) {
    seeds.push({
      kind: 'research',
      title: 'Gather live market / competitor data',
      detail: 'Pull current market, competitor and demand data to ground the plan.',
      blockedReason: 'Live research connectors are not connected. Enabling external data requires an explicit approval gate (not open).',
    });
  }

  seeds.push({
    kind: 'draft',
    title: wantsBuild ? 'Draft the execution assets' : 'Draft the execution plan',
    detail: wantsBuild
      ? 'Produce first-draft assets (structure, copy, checklist).'
      : 'Produce a concrete, step-by-step execution plan.',
    prompt: `Produce ${wantsBuild
      ? 'a concrete set of first-draft execution assets (structure, copy, checklist)'
      : 'a concrete step-by-step execution plan'} for this goal: "${goal}". Mark any item that depends on live data as "needs verification" instead of inventing numbers.`,
  });

  seeds.push({
    kind: 'compute',
    title: 'Define & record success metrics',
    detail: 'Enter the concrete target metrics you will track (your own numbers).',
  });

  if (wantsBuild) {
    seeds.push({
      kind: 'act',
      title: 'Execute the first side-effect action',
      detail: 'Perform the first real action (publish / send / order / charge).',
      blockedReason: 'Side-effect execution is not enabled. Assisted mode requires explicit human approval per action and the execution gate is closed.',
    });
  }

  seeds.push({
    kind: 'analyze',
    title: 'Review & propose next 3 actions',
    detail: 'Critique progress and output the next 3 prioritized actions.',
    prompt: `Review the plan and any outputs gathered so far for the goal "${goal}". Give a brutally honest critique, the top remaining risk, and the next 3 prioritized actions. Do not fabricate progress or data.`,
  });

  return seeds.map(({ status, ...rest }) => ({
    ...rest,
    id: rid('st'),
    status: (status ?? 'pending') as AgentStepStatus,
  }));
}

export function useAgentRuns() {
  const [runs, setRuns] = useState<AgentRun[]>(loadRuns);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(runs.slice(0, MAX_RUNS))); } catch { /* ignore */ }
  }, [runs]);

  const createRun = useCallback((goal: string): string => {
    const now = new Date().toISOString();
    const run: AgentRun = {
      id: rid('run'),
      goal: goal.trim(),
      createdAt: now,
      updatedAt: now,
      status: 'planned',
      steps: planRun(goal),
    };
    setRuns((prev) => [run, ...prev].slice(0, MAX_RUNS));
    return run.id;
  }, []);

  const patchRun = useCallback((id: string, patch: Partial<AgentRun>) => {
    setRuns((prev) => prev.map((r) => (
      r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r
    )));
  }, []);

  const updateStep = useCallback((runId: string, stepId: string, patch: Partial<AgentStep>) => {
    setRuns((prev) => prev.map((r) => {
      if (r.id !== runId) return r;
      const steps = r.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
      const allTerminal = steps.every((s) => s.status === 'done' || s.status === 'skipped' || s.status === 'blocked');
      const anyActive = steps.some((s) => s.status === 'running');
      const status: AgentRun['status'] = allTerminal
        ? 'completed'
        : (anyActive || steps.some((s) => s.status === 'done')) ? 'running' : 'planned';
      return { ...r, steps, status, updatedAt: new Date().toISOString() };
    }));
  }, []);

  const replayRun = useCallback((id: string) => {
    setRuns((prev) => prev.map((r) => (
      r.id === id
        ? {
            ...r,
            status: 'planned',
            updatedAt: new Date().toISOString(),
            steps: r.steps.map((s) => ({
              ...s,
              status: 'pending' as AgentStepStatus,
              output: undefined,
              confidence: undefined,
              needsRealData: undefined,
              approval: undefined,
            })),
          }
        : r
    )));
  }, []);

  const removeRun = useCallback((id: string) => {
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { runs, createRun, patchRun, updateStep, replayRun, removeRun };
}
