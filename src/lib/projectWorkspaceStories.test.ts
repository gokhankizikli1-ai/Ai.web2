import { describe, it, expect } from 'vitest';
import {
  adjacentClaims,
  changeStories,
  claimKey,
  establishedClaims,
  evidenceClassKey,
  evidenceCount,
  evidenceOutcomeKey,
  evidenceTone,
  findProjectState,
  hasFocus,
  hasGrounding,
  hasProjectMemory,
  alarmIsFocusStory,
  hasVisitChanges,
  knowledgeGapKeys,
  knowledgeGroups,
  normalizeGrounding,
  normalizeWorkspace,
  notEstablishedClaims,
  providerText,
  storyOutcomes,
  storyTimeline,
  workspaceFocus,
  PROVIDER_TEXT_MAX,
  type ProjectWorkspace,
} from '@/lib/projectWorkspace';
import { LOCALES } from '@/i18n';

/**
 * CORRELATED STORIES, EVIDENCE AND PROVIDER TEXT — the presentation rules the
 * Project Workspace's character depends on.
 *
 * The page is a renderer over one backend read model, so every decision worth
 * testing lives in this module: which subject a change belongs to (the
 * backend's), what a story's evidence establishes (the grounding authority's),
 * how a chronology is ordered, and — the security-relevant one — what happens
 * to a string a stranger wrote into a connected tool before it reaches a
 * screen.
 *
 * The invariants under test are all of the form "the frontend does not decide
 * this". A test here failing usually means the page has started inferring
 * something it is supposed to be rendering.
 */

const NOW = '2026-06-10T12:00:00Z';

function evidence(over: Record<string, unknown> = {}) {
  return {
    observation_id: 'o1',
    source: 'vercel',
    kind: 'vercel.deployment.error',
    semantic_type: 'deploy_failed',
    polarity: 'negative',
    environment: 'production',
    title: 'Production deployment failed',
    observed_at: '2026-06-10T10:00:00Z',
    ...over,
  };
}

function claim(over: Record<string, unknown> = {}) {
  return {
    claim: 'deployment',
    support: 'direct',
    basis: 'structural',
    sources: ['vercel'],
    evidence_count: 2,
    single_source: true,
    missing: [],
    ...over,
  };
}

function subject(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    subject: 'Release / PR #656',
    entity_type: 'pull_request',
    state: 'unresolved',
    confidence: { score: 0.6, level: 'medium' },
    sources: ['github', 'vercel'],
    evidence_count: 3,
    member_count: 4,
    corroborated: true,
    supporting: [evidence({
      observation_id: 'g1', source: 'github', kind: 'github.pull_request.merged',
      semantic_type: 'change_landed', polarity: 'positive', environment: '',
      title: 'PR #656 merged', observed_at: '2026-06-10T09:00:00Z',
    })],
    contradicting: [evidence()],
    context: [],
    first_seen: '2026-06-10T09:00:00Z',
    last_seen: '2026-06-10T10:00:00Z',
    understanding: {
      id: 's1',
      areas: [{ area: 'deployment', basis: 'structural' }],
      change_kind: { kind: 'deployment', basis: 'structural' },
      environments: ['production'],
      implications: [{ code: 'production_broken' }],
      uncertainty: [{ code: 'single_source' }],
      blockers: [],
      last_meaningful_change: null,
    },
    grounding: {
      claims: [
        claim(),
        claim({ claim: 'code_change', support: 'direct', sources: ['github'] }),
        claim({ claim: 'functionality', support: 'indirect', basis: 'textual',
                sources: ['slack'], missing: ['person_stating_it'] }),
        claim({ claim: 'users', support: 'none', basis: '', sources: [],
                evidence_count: 0, single_source: false,
                missing: ['person_stating_it', 'recorded_customer_fact'] }),
        claim({ claim: 'goal_progress', support: 'none', basis: '', sources: [],
                evidence_count: 0, single_source: false,
                missing: ['recorded_project_goal'] }),
      ],
      sources: ['github', 'vercel'],
      observations: 4,
      single_source: false,
    },
    ...over,
  };
}

function payload(over: Record<string, unknown> = {}) {
  return {
    project: { id: 'p1', name: 'Acme', description: '', created_at: '', updated_at: '' },
    summary: { text: '', source: '' },
    today: { attention: null, recommendation: null },
    goals: [],
    attention: [],
    project_state: [subject()],
    project_understanding: {
      generated_at: NOW, window_days: 14, state: 'unresolved',
      coverage: { observations: 4, sources: ['github', 'vercel'], source_count: 2,
                  subjects: 1, single_source: false, oldest_observed_at: '',
                  newest_observed_at: '', recent: true, window_days: 14 },
      open: [], resolved_recently: [], uncertain: [], blockers: [],
      meaningful_changes: [], gaps: [{ code: 'production_unverified' }],
      relationships: [], counts: {},
    },
    focus: {
      top: {
        subject_id: 's1', subject: 'Release / PR #656', project_state: 'unresolved',
        unresolved: true, areas: ['deployment'], priority_basis: 'production_broken',
        why_now: ['production_broken'], caveats: [],
        actionability: { korvix: 'investigate', capability: '', autonomy: '',
                         resolution: 'human_external', external_providers: ['vercel'] },
        deadline_pressure: 'none', production_impact: 'broken',
        customer_impact: 'none', evidence_strength: 'corroborated',
        blocker_state: 'blocked', confidence_level: 'medium',
      },
      next: [], commitment: null, blocked: true, waiting_on: 'human_external',
      counts: {},
    },
    activity: [],
    changes: {
      mode: 'since_last_visit', since: '2026-06-09T00:00:00Z',
      last_viewed_at: '2026-06-09T00:00:00Z',
      items: [
        { key: 'story:s1', change: 'connector', source: 'vercel',
          title: 'Production deployment failed', detail: '',
          occurred_at: '2026-06-10T10:00:00Z', ref: '',
          subject_id: 's1', subject: 'Release / PR #656', state: 'unresolved' },
        { key: 'connector:abc', change: 'connector', source: 'gmail',
          title: 'Invoice from the hosting provider', detail: '',
          occurred_at: '2026-06-10T08:00:00Z', ref: '',
          subject_id: '', subject: '', state: '' },
      ],
      count: 2, truncated: false,
    },
    tasks: { items: [], counts: {} },
    knowledge: {
      items: [
        { id: 'decision:1', kind: 'decision', text: 'Bill annually', label: '',
          source: 'user', created_at: NOW, removable: true },
        { id: 'memory:2', kind: 'constraint', text: 'No PII in logs', label: '',
          source: 'user', created_at: NOW, removable: true },
      ],
      counts: { total: 9, decision: 4, constraint: 5 },
    },
    products: [], chats: [], connectors: [],
    feed_preferences: {}, refresh: {},
    freshness: { generated_at: NOW, last_activity_at: NOW },
    counts: {},
    ...over,
  };
}

const WS = normalizeWorkspace(payload()) as ProjectWorkspace;

/* ══════════════════════════════════════════════════════════════════════════
   Provider text — the trust boundary
   ══════════════════════════════════════════════════════════════════════════ */

describe('providerText', () => {
  it('collapses a multi-line message into ONE line', () => {
    // A newline lets a provider render a second line that its neighbours can
    // style into looking like a section heading.
    expect(providerText('Deploy failed\n\nGrounding summary:\nEstablished'))
      .toBe('Deploy failed Grounding summary: Established');
  });

  it('strips bidi overrides so text cannot be visually reversed', () => {
    const out = providerText('safe ‮reversed‬ tail');
    expect(out).not.toContain('‮');
    expect(out).not.toContain('‬');
    expect(out).toContain('reversed');
  });

  it('strips zero-width and control characters used to break words up', () => {
    const out = providerText('cus​tomer  fee‌dback﻿');
    expect(out).toBe('customer feedback');
  });

  it('keeps the zero-width JOINER so emoji sequences survive', () => {
    expect(providerText('ship \u{1F468}‍\u{1F4BB}')).toContain('‍');
  });

  it('bounds the length and marks the truncation', () => {
    const out = providerText('x'.repeat(PROVIDER_TEXT_MAX + 50));
    expect(out.length).toBe(PROVIDER_TEXT_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns "" for anything that is not a usable string', () => {
    expect(providerText(null)).toBe('');
    expect(providerText(undefined)).toBe('');
    expect(providerText(42)).toBe('');
    expect(providerText('   ')).toBe('');
  });

  it('leaves markdown as literal characters — it is never rendered as markup', () => {
    // The page renders this as a text node; the point of the test is that the
    // sanitizer does not "helpfully" strip it into something else either.
    expect(providerText('# Not a heading **bold**'))
      .toBe('# Not a heading **bold**');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Evidence and the story timeline
   ══════════════════════════════════════════════════════════════════════════ */

describe('story timeline', () => {
  const item = WS.projectState[0];

  it('reads forwards — oldest evidence first', () => {
    const rows = storyTimeline(item);
    expect(rows.map((r) => r.observation_id)).toEqual(['g1', 'o1']);
  });

  it('deduplicates the same observation across the three evidence lists', () => {
    const dup = normalizeWorkspace(payload({
      project_state: [subject({ context: [evidence()] })],
    }))!.projectState[0];
    expect(storyTimeline(dup).filter((r) => r.observation_id === 'o1')).toHaveLength(1);
  });

  it('sorts an undatable row LAST rather than pretending it is the oldest', () => {
    const odd = normalizeWorkspace(payload({
      project_state: [subject({
        context: [evidence({ observation_id: 'x1', observed_at: '' })],
      })],
    }))!.projectState[0];
    expect(storyTimeline(odd).at(-1)!.observation_id).toBe('x1');
  });

  it('never claims fewer evidence than it is about to render', () => {
    const thin = normalizeWorkspace(payload({
      project_state: [subject({ evidence_count: 0 })],
    }))!.projectState[0];
    expect(evidenceCount(thin)).toBe(storyTimeline(thin, 99).length);
  });
});

describe('storyOutcomes', () => {
  const item = WS.projectState[0];

  it('gives one row per source, environment and polarity', () => {
    const rows = storyOutcomes(item);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source).sort()).toEqual(['github', 'vercel']);
  });

  it('NEVER collapses a passing preview into a failing production deploy', () => {
    const both = normalizeWorkspace(payload({
      project_state: [subject({
        context: [evidence({
          observation_id: 'p1', semantic_type: 'deploy_succeeded',
          polarity: 'positive', environment: 'preview',
          title: 'Preview ready', observed_at: '2026-06-10T09:30:00Z',
        })],
      })],
    }))!.projectState[0];
    const vercel = storyOutcomes(both, 9).filter((r) => r.source === 'vercel');
    expect(vercel).toHaveLength(2);
    expect(vercel.map((r) => r.environment).sort()).toEqual(['preview', 'production']);
  });

  it('carries the backend polarity through untouched', () => {
    expect(evidenceTone('negative')).toBe('negative');
    expect(evidenceTone('positive')).toBe('positive');
    expect(evidenceTone('pending')).toBe('pending');
    // An unrecognised polarity gets NO mark rather than an invented one.
    expect(evidenceTone('' as never)).toBe('neutral');
  });
});

describe('label vocabularies resolve to real shipped strings', () => {
  it('every semantic type maps to a key English actually has', () => {
    for (const type of ['change_landed', 'ci_passed', 'deploy_failed',
      'deploy_succeeded', 'issue_opened', 'discussion', 'mail', 'meeting']) {
      const key = evidenceOutcomeKey(type)!;
      expect(key, type).toBeTruthy();
      expect(LOCALES.en[key], key).toBeTruthy();
    }
  });

  it('an unknown semantic type renders NO word rather than a raw code', () => {
    expect(evidenceOutcomeKey('something_new')).toBeNull();
  });

  it('every claim and evidence class maps to a shipped string', () => {
    for (const c of ['deployment', 'code_change', 'tests', 'coordination',
      'functionality', 'users', 'feedback', 'goal_progress', 'business_outcome']) {
      expect(LOCALES.en[claimKey(c)!], c).toBeTruthy();
    }
    for (const e of ['deployment_event', 'code_change_event', 'ci_or_test_report',
      'meeting_or_message', 'person_stating_it', 'recorded_customer_fact',
      'recorded_metric_or_business_fact', 'recorded_project_goal']) {
      expect(LOCALES.en[evidenceClassKey(e)!], e).toBeTruthy();
    }
    expect(claimKey('brand_new_claim')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Grounding — what may and may not be said
   ══════════════════════════════════════════════════════════════════════════ */

describe('grounding bands', () => {
  const g = WS.projectState[0].grounding;

  it('ESTABLISHED is `direct` support and nothing weaker', () => {
    expect(establishedClaims(g).map((c) => c.claim)).toEqual(['deployment', 'code_change']);
  });

  it('adjacent evidence is reported as adjacent, never as the claim', () => {
    expect(adjacentClaims(g).map((c) => c.claim)).toEqual(['functionality']);
    expect(establishedClaims(g).map((c) => c.claim)).not.toContain('functionality');
  });

  it('NOT ESTABLISHED names what this evidence does not support', () => {
    expect(notEstablishedClaims(g).map((c) => c.claim)).toEqual(['users', 'goal_progress']);
  });

  it('the three bands are disjoint', () => {
    const all = [...establishedClaims(g, 9), ...adjacentClaims(g, 9),
                 ...notEstablishedClaims(g, 9)].map((c) => c.claim);
    expect(new Set(all).size).toBe(all.length);
  });

  it('carries the single-source and textual-basis riders', () => {
    expect(establishedClaims(g)[0].singleSource).toBe(true);
    expect(adjacentClaims(g)[0].basis).toBe('textual');
  });

  it('names what WOULD establish an unestablished claim', () => {
    const users = notEstablishedClaims(g).find((c) => c.claim === 'users')!;
    expect(users.missingKeys.length).toBeGreaterThan(0);
    for (const key of users.missingKeys) expect(LOCALES.en[key]).toBeTruthy();
  });

  it('an unrecognised support level degrades to the WEAKEST reading', () => {
    const odd = normalizeGrounding({
      claims: [{ claim: 'deployment', support: 'probably', sources: [], missing: [] }],
    })!;
    expect(odd.claims[0].support).toBe('none');
  });

  it('carries no score, percentage or health number anywhere', () => {
    const blob = JSON.stringify(g);
    for (const banned of ['health', 'percent', '%']) {
      expect(blob.toLowerCase()).not.toContain(banned);
    }
  });

  it('a subject with no grounding still opens if it has evidence', () => {
    const bare = normalizeWorkspace(payload({
      project_state: [subject({ grounding: {} })],
    }))!.projectState[0];
    expect(bare.grounding).toBeNull();
    expect(hasGrounding(bare)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Focus — a join, never a re-ranking
   ══════════════════════════════════════════════════════════════════════════ */

describe('workspaceFocus', () => {
  it('resolves the backend focus subject to its correlated story BY ID', () => {
    const focus = workspaceFocus(WS);
    expect(focus.item!.subject_id).toBe('s1');
    expect(focus.story!.id).toBe('s1');
    expect(hasFocus(focus)).toBe(true);
  });

  it('leaves the story null when the focus subject is not in the payload', () => {
    const ws = normalizeWorkspace(payload({ project_state: [] }))!;
    expect(workspaceFocus(ws).story).toBeNull();
  });

  it('a quiet project focuses on nothing rather than promoting its calmest row', () => {
    const ws = normalizeWorkspace(payload({ focus: {}, project_state: [] }))!;
    const focus = workspaceFocus(ws);
    expect(focus.item).toBeNull();
    expect(hasFocus(focus)).toBe(false);
  });

  it('falls back to the backend-chosen alarm when there is no focus item', () => {
    const ws = normalizeWorkspace(payload({
      focus: {},
      today: {
        attention: { id: 'a1', severity: 'blocking', reason: 'deploy_failed',
                     source: 'vercel', kind: 'vercel.deployment.error',
                     title: 'Production deployment failed', context: '',
                     observed_at: NOW, ref: '' },
        recommendation: null,
      },
    }))!;
    const focus = workspaceFocus(ws);
    expect(focus.item).toBeNull();
    expect(focus.attention!.id).toBe('a1');
    expect(hasFocus(focus)).toBe(true);
  });

  it('folds the alarm into the headline ONLY when the backend joined them', () => {
    const alarm = (stateId: string) => ({
      id: 'a1', severity: 'blocking', reason: 'deploy_failed', source: 'vercel',
      kind: 'vercel.deployment.error', title: 'Production deployment failed',
      context: '', observed_at: NOW, ref: '',
      state_id: stateId, state: 'unresolved', state_subject: 'Release / PR #656',
      state_evidence_count: 3,
    });
    const same = normalizeWorkspace(payload({
      today: { attention: alarm('s1'), recommendation: null },
    }))!;
    expect(alarmIsFocusStory(workspaceFocus(same))).toBe(true);

    const other = normalizeWorkspace(payload({
      today: { attention: alarm('s2'), recommendation: null },
    }))!;
    expect(alarmIsFocusStory(workspaceFocus(other))).toBe(false);

    // No story on either side is the WEAKER claim: the alarm keeps its own line
    // rather than being folded into a headline that may be about something else.
    const unlinked = normalizeWorkspace(payload({
      today: { attention: alarm(''), recommendation: null },
    }))!;
    expect(alarmIsFocusStory(workspaceFocus(unlinked))).toBe(false);
  });

  it('carries the backend attention-to-story enrichment through normalization', () => {
    const ws = normalizeWorkspace(payload({
      attention: [{ id: 'a1', severity: 'blocking', reason: 'deploy_failed',
                    source: 'vercel', kind: 'k', title: 'x', context: '',
                    observed_at: NOW, ref: '', state_id: 's1',
                    state: 'unresolved', state_subject: 'Release / PR #656',
                    state_evidence_count: 3 }],
    }))!;
    expect(ws.attention[0].state_subject).toBe('Release / PR #656');
    expect(ws.attention[0].state_evidence_count).toBe(3);
  });

  it('defaults the enrichment when an older backend omits it', () => {
    const ws = normalizeWorkspace(payload({
      attention: [{ id: 'a1', severity: 'blocking', reason: 'deploy_failed',
                    source: 'vercel', kind: 'k', title: 'x', context: '',
                    observed_at: NOW, ref: '' }],
    }))!;
    expect(ws.attention[0].state_id).toBe('');
    expect(ws.attention[0].state_evidence_count).toBe(0);
  });

  it('finds nothing for a foreign subject id', () => {
    expect(findProjectState(WS, 'not-mine')).toBeNull();
    expect(findProjectState(null, 's1')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Changes as stories
   ══════════════════════════════════════════════════════════════════════════ */

describe('changeStories', () => {
  it('attaches the correlated story the BACKEND put the change in', () => {
    const rows = changeStories(WS, WS.changes);
    expect(rows[0].story!.id).toBe('s1');
  });

  it('leaves an uncorrelated change standing alone rather than inventing a group', () => {
    const rows = changeStories(WS, WS.changes);
    expect(rows[1].change.subject_id).toBe('');
    expect(rows[1].story).toBeNull();
  });

  it('never fabricates a story for a subject the payload does not carry', () => {
    const ws = normalizeWorkspace(payload({ project_state: [] }))!;
    expect(changeStories(ws, ws.changes)[0].story).toBeNull();
  });

  it('only claims a visit when a real marker AND changes exist', () => {
    expect(hasVisitChanges(WS.changes)).toBe(true);
    const first = normalizeWorkspace(payload({
      changes: { mode: 'recent', since: '', last_viewed_at: '', items: [],
                 count: 0, truncated: false },
    }))!;
    expect(hasVisitChanges(first.changes)).toBe(false);
    const quiet = normalizeWorkspace(payload({
      changes: { mode: 'since_last_visit', since: NOW, last_viewed_at: NOW,
                 items: [], count: 0, truncated: false },
    }))!;
    expect(hasVisitChanges(quiet.changes)).toBe(false);
  });

  it('an unprovable mode never prints the stronger claim', () => {
    const ws = normalizeWorkspace(payload({
      changes: { mode: 'whatever', items: [], count: 3 },
    }))!;
    expect(ws.changes.mode).toBe('recent');
    expect(hasVisitChanges(ws.changes)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Project memory
   ══════════════════════════════════════════════════════════════════════════ */

describe('project memory', () => {
  it('groups knowledge by kind in the vocabulary order, omitting empty kinds', () => {
    const groups = knowledgeGroups(WS.knowledge);
    expect(groups.map((g) => g.kind)).toEqual(['decision', 'constraint']);
  });

  it('reports the AUTHORITY total per kind, not the bounded slice length', () => {
    const groups = knowledgeGroups(WS.knowledge);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].total).toBe(4);
  });

  it('carries the synthesis gaps as memory of what cannot be seen', () => {
    const gaps = knowledgeGapKeys(WS.understanding);
    expect(gaps.map((g) => g.code)).toEqual(['production_unverified']);
    for (const g of gaps) expect(LOCALES.en[g.key]).toBeTruthy();
  });

  it('a project with a summary, an item or a gap has memory to show', () => {
    expect(hasProjectMemory(WS)).toBe(true);
  });

  it('an empty project honestly has none', () => {
    const bare = normalizeWorkspace(payload({
      summary: { text: '', source: '' },
      knowledge: { items: [], counts: {} },
      project_understanding: {},
    }))!;
    expect(hasProjectMemory(bare)).toBe(false);
    expect(knowledgeGroups(bare.knowledge)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Defensive normalization of the new fields
   ══════════════════════════════════════════════════════════════════════════ */

describe('normalization of the new payload fields', () => {
  it('defaults the story fields on a change from an older backend', () => {
    const ws = normalizeWorkspace(payload({
      changes: {
        mode: 'recent', items: [{ key: 'k1', change: 'connector', source: 'github',
                                  title: 'x', occurred_at: NOW }],
        count: 1,
      },
    }))!;
    expect(ws.changes.items[0].subject_id).toBe('');
    expect(ws.changes.items[0].subject).toBe('');
  });

  it('defaults evidence polarity and environment rather than guessing', () => {
    const ws = normalizeWorkspace(payload({
      project_state: [subject({
        supporting: [{ observation_id: 'z', source: 'github', kind: 'k',
                       semantic_type: 'change_landed', title: 'x',
                       observed_at: NOW }],
        contradicting: [], context: [],
      })],
    }))!;
    const row = ws.projectState[0].supporting[0];
    expect(row.polarity).toBe('');
    expect(row.environment).toBe('');
  });

  it('drops a grounding block with no usable claims', () => {
    expect(normalizeGrounding({ claims: [{ support: 'direct' }] })).toBeNull();
    expect(normalizeGrounding({})).toBeNull();
    expect(normalizeGrounding(null)).toBeNull();
  });

  it('survives a malformed payload without throwing', () => {
    const ws = normalizeWorkspace(payload({
      project_state: [null, 'nope', subject()],
      changes: { items: [null, 'x'], count: 'many' },
      knowledge: { items: [{ id: 'x' }], counts: 'nope' },
    }))!;
    expect(ws.projectState).toHaveLength(1);
    expect(ws.changes.items).toEqual([]);
    expect(ws.knowledge.items).toEqual([]);
  });
});
