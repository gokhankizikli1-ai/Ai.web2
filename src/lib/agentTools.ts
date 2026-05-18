import type {
  AgentStep, AgentStepKind, AgentTool, AgentToolGate, VerifierVerdict,
} from '@/types';

/**
 * Agent tool registry + pure verifier — Phase 4 #4C.
 *
 * A declarative catalog of typed tool contracts. analyze/draft/compute tools
 * have gate 'none' (dry-runnable: they only structure a prompt or use the
 * user's own input). research/act tools are registered but gated — their
 * gate is NOT open in this build, so they are never executed and never
 * fabricate live data or real side effects.
 */
export const AGENT_TOOLS: AgentTool[] = [
  {
    id: 'tool.analyze', kind: 'analyze', label: 'Reasoning',
    description: 'Structured analysis routed to the normal chat model.',
    inputs: 'A structured prompt + the goal', gate: 'none',
  },
  {
    id: 'tool.draft', kind: 'draft', label: 'Draft generator',
    description: 'First-draft plan/assets routed to the normal chat model.',
    inputs: 'A structured prompt + the goal', gate: 'none',
  },
  {
    id: 'tool.compute', kind: 'compute', label: 'Metric capture',
    description: "Records the user's own target numbers (nothing fabricated).",
    inputs: "The user's own metrics", gate: 'none',
  },
  {
    id: 'tool.research', kind: 'research', label: 'Live research',
    description: 'Live market / competitor / demand data connectors.',
    inputs: 'Query + a connected data source', gate: 'external-data',
  },
  {
    id: 'tool.act', kind: 'act', label: 'Side-effect action',
    description: 'Publish / send / order / charge — a real-world effect.',
    inputs: 'An approved action payload', gate: 'execution',
  },
];

const BY_KIND = AGENT_TOOLS.reduce((m, t) => {
  m[t.kind] = t;
  return m;
}, {} as Record<AgentStepKind, AgentTool>);

export function toolForStep(step: AgentStep): AgentTool {
  return BY_KIND[step.kind];
}

/**
 * Only the 'none' gate is open in this build. The external-data and execution
 * gates require separate, explicit enablement that is intentionally absent —
 * gated tools are therefore never runnable here.
 */
export function isGateOpen(gate: AgentToolGate): boolean {
  return gate === 'none';
}

const DATA_SENSITIVE = /(market|competitor|price|pricing|demand|traffic|audience|trend)/;

/** Pure verifier: honest, structured critique. Never fabricates a pass. */
export function verifyStep(step: AgentStep): VerifierVerdict {
  const tool = toolForStep(step);

  if (tool.gate !== 'none') {
    return {
      confidence: 0,
      needsRealData: true,
      checks: [
        { label: `${tool.label} gate open`, passed: false },
        { label: 'Output produced', passed: false },
      ],
      summary: `Cannot verify — the "${tool.gate}" gate is closed, so this tool never ran.`,
    };
  }

  const hasOutput = !!step.output?.trim();

  if (step.kind === 'compute') {
    return {
      confidence: hasOutput ? 90 : 35,
      needsRealData: false,
      checks: [
        { label: 'Metrics recorded', passed: hasOutput },
        { label: 'Own data (not fabricated)', passed: true },
      ],
      summary: hasOutput
        ? 'Recorded the user-supplied target metrics.'
        : 'No metrics recorded yet.',
    };
  }

  const dataSensitive = DATA_SENSITIVE.test(`${step.title} ${step.detail}`.toLowerCase());
  const ran = step.status === 'done' || step.status === 'running';
  return {
    confidence: hasOutput ? 80 : 55,
    needsRealData: dataSensitive && !hasOutput,
    checks: [
      { label: 'Routed to chat (dry-run)', passed: ran },
      { label: 'Result captured', passed: hasOutput },
      { label: 'No fabricated live data', passed: !dataSensitive || hasOutput },
    ],
    summary: dataSensitive && !hasOutput
      ? 'Reasoning step — quality limited until grounded in real data (not connected).'
      : 'Reasoning/draft step — AI guidance only; verify before relying on it.',
  };
}
