import { describe, it, expect } from 'vitest';
import { inferWebsiteBrief } from '@/lib/webBuildBrief';
import {
  deriveLayoutSteering,
  deriveThinkingLedger,
  type ArtDirectionArtifact,
  type StrategicThinkingLedger,
} from '@/lib/webBuildAgents';

const ledgerFor = (prompt: string) => deriveThinkingLedger(
  prompt,
  { coreIdea: prompt, type: 'AI SaaS product', goal: 'Explain the product flow', audience: 'operators' },
  undefined,
  inferWebsiteBrief(prompt, 'en'),
  'en',
)!;

describe('web build agent dashboard intent', () => {
  it('keeps AI/SaaS analytics mentions on a product-flow demo unless dashboard is explicit', () => {
    expect(
      ledgerFor('Build an AI analytics product marketing site for revenue teams').demoSurfaceIntent,
    ).toBe('product-flow-demo');
    expect(
      ledgerFor('Build an AI reporting platform landing page, no dashboard please').demoSurfaceIntent,
    ).toBe('product-flow-demo');
    expect(
      ledgerFor('Build an AI analytics dashboard for support operations').demoSurfaceIntent,
    ).toBe('dashboard-demo');
  });

  it('lets an explicit dashboard request override non-dashboard layout pins', () => {
    const ledger = { demoSurfaceIntent: 'dashboard-demo' } as StrategicThinkingLedger;
    const art = {
      designArchetype: {
        key: 'marketplace',
        name: 'Marketplace',
        reason: 'Pinned catalog layout',
        avoidGenericSaas: false,
        archetypeTags: [],
      },
    } as ArtDirectionArtifact;

    expect(deriveLayoutSteering(undefined, art, undefined, ledger)).toMatchObject({
      agentHero: 'dashboard-product',
      agentModule: 'data-dashboard',
    });
  });
});
