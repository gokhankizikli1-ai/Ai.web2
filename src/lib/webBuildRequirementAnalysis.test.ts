import { describe, it, expect } from 'vitest';
import { analyzeBindingAcceptance } from '@/lib/webBuildRequirementAnalysis';
import type { FrontendGeneratedFile, FrontendBindingRequirements } from '@/lib/webBuildAgents';

function file(path: string, content: string): FrontendGeneratedFile {
  return { path, language: 'tsx', content, charCount: content.length, lineCount: content.split('\n').length };
}
function binding(requirements: FrontendBindingRequirements['requirements']): FrontendBindingRequirements {
  return {
    version: 'binding-requirements-v1',
    requirements,
    counts: { total: requirements.length, section: 0, interaction: 1, control: 1, dynamicOutcome: 1, behavior: 0, media: 0 },
  } as unknown as FrontendBindingRequirements;
}

/* A real multi-step calculator: control → state (income) → afterTax → savings → summary (rendered).
 * Only the final, two-hops-removed derived value is rendered; the state var is NOT rendered directly. */
const CHAINED_CALC = file('BudgetPlanner.tsx', `
import { useState } from 'react';
export function BudgetPlanner() {
  const [income, setIncome] = useState(3000);
  const taxRate = 0.2;
  const afterTax = income * (1 - taxRate);
  const savings = afterTax * 0.15;
  const summary = savings * 12;
  return (
    <section aria-label="budget planner">
      <h2>Budget planner</h2>
      <label htmlFor="inc">Monthly income</label>
      <input id="inc" type="range" min="0" max="10000" onChange={(e) => setIncome(Number(e.target.value))} />
      <p>Projected yearly savings: {summary.toFixed(0)}</p>
    </section>
  );
}
`);

describe('webBuildRequirementAnalysis — transitive derived-chain evidence (Phase 6)', () => {
  it('credits a multi-hop calculation chain (control → state → derived → derived → rendered) as a real interactive experience', () => {
    const b = binding([
      { id: 'r1', kind: 'interactive-experience', label: 'budget planner', required: true, strength: 'explicit', evidence: 'x',
        controls: [{ id: 'c1', label: 'income', aliases: ['income'] }], dynamicOutcome: 'projected savings' } as never,
    ]);
    const r = analyzeBindingAcceptance([CHAINED_CALC], b);
    expect(r.status).not.toBe('fail');
    expect(r.satisfiedCount).toBeGreaterThanOrEqual(1);
    expect(r.issues.some((i) => i.code === 'binding-interaction-missing')).toBe(false);
  });

  it('credits the same chain as a satisfied dynamic outcome (output tied to the control through the chain)', () => {
    const b = binding([
      { id: 'r1', kind: 'interactive-experience', label: 'budget planner', required: true, strength: 'explicit', evidence: 'x',
        controls: [{ id: 'c1', label: 'income', aliases: ['income'] }] } as never,
      { id: 'r2', kind: 'dynamic-outcome', label: 'projected savings summary', required: true, strength: 'explicit', evidence: 'x' } as never,
    ]);
    const r = analyzeBindingAcceptance([CHAINED_CALC], b);
    expect(r.issues.some((i) => i.code === 'binding-dynamic-outcome-missing')).toBe(false);
  });

  it('does NOT over-credit: a rendered value that never reaches a control-driven state stays a missing dynamic outcome', () => {
    const constants = file('PriceViewer.tsx', `
import { useState } from 'react';
export function PriceViewer() {
  const [qty, setQty] = useState(1);
  const base = 5;
  const shown = base * 3;
  return (
    <section aria-label="estimated total">
      <h2>Estimated total</h2>
      <input aria-label="quantity" type="range" onChange={(e) => setQty(Number(e.target.value))} />
      <p>{shown}</p>
    </section>
  );
}
`);
    const b = binding([
      { id: 'r1', kind: 'dynamic-outcome', label: 'estimated total', required: true, strength: 'explicit', evidence: 'x' } as never,
    ]);
    const r = analyzeBindingAcceptance([constants], b);
    expect(r.issues.some((i) => i.code === 'binding-dynamic-outcome-missing')).toBe(true);
    expect(r.status).toBe('fail');
  });

  it('matches camelCase state vars in a derived chain (loanAmount → monthly → total)', () => {
    const camel = file('LoanCalculator.tsx', `
import { useState } from 'react';
export function LoanCalculator() {
  const [loanAmount, setLoanAmount] = useState(10000);
  const monthlyRate = 0.005;
  const monthly = loanAmount * monthlyRate;
  const total = monthly + loanAmount;
  return (
    <section aria-label="loan calculator">
      <h2>Loan calculator</h2>
      <label htmlFor="amt">Loan amount</label>
      <input id="amt" type="range" onChange={(e) => setLoanAmount(Number(e.target.value))} />
      <p>Total repayable: {total.toFixed(2)}</p>
    </section>
  );
}
`);
    const b = binding([
      { id: 'r1', kind: 'interactive-experience', label: 'loan calculator', required: true, strength: 'explicit', evidence: 'x',
        controls: [{ id: 'c1', label: 'loan amount', aliases: ['loan amount', 'amount'] }], dynamicOutcome: 'total repayable' } as never,
    ]);
    const r = analyzeBindingAcceptance([camel], b);
    expect(r.status).not.toBe('fail');
    expect(r.satisfiedCount).toBeGreaterThanOrEqual(1);
  });

  it('fails open (never throws) on garbage input', () => {
    expect(() => analyzeBindingAcceptance(undefined, undefined)).not.toThrow();
    // No binding contract → legacy result (legacyContractUsed reflects an absent binding object).
    expect(analyzeBindingAcceptance([file('x.tsx', 'const a =')], undefined).legacyContractUsed).toBe(true);
    // An empty-requirements binding object is still a non-throwing, passing analysis.
    expect(analyzeBindingAcceptance([file('x.tsx', 'const a =')], binding([])).status).toBe('pass');
  });
});
