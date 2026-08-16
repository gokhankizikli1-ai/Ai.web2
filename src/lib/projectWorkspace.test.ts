import { describe, it, expect } from 'vitest';
import {
  askSuggestions,
  attentionReasonKey,
  connectorSummary,
  freshnessKey,
  freshnessRelative,
  newProjectChatUrl,
  normalizeWorkspace,
  openProjectChatUrl,
  productBuildType,
  productOpenTarget,
  productStatusKey,
  relativeTime,
  relativeTimeKey,
  severityTone,
  sourceLabel,
  type ProjectWorkspace,
} from '@/lib/projectWorkspace';
import { LOCALES } from '@/i18n';

/**
 * The Project Workspace presentation layer.
 *
 * The page is a renderer over ONE backend read model, so every decision worth
 * testing lives here: defensive normalization of an untyped payload, relative
 * time that never prints a negative age, reason/status/source labels that
 * always resolve to a real shipped i18n key, connected-tool summaries that
 * never leak an opaque id, suggested questions gated on real state, and chat
 * URLs that reuse the existing chat entry points.
 */

const FULL: unknown = {
  project: { id: 'p1', name: 'Fitness App', description: 'Track workouts.',
             created_at: '2026-01-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' },
  summary: { text: 'A workout tracker.', source: 'brain' },
  goals: [{ id: 'g1', title: 'Ship v1', priority: 3, source: 'goals' },
          { id: '', title: 'Talk to 10 users', priority: null, source: 'memory' }],
  attention: [{ id: 'a1', severity: 'blocking', reason: 'deploy_failed', source: 'vercel',
                kind: 'vercel.deployment.error', title: 'Production deployment failed',
                context: 'Acme', observed_at: '2026-06-01T10:00:00Z', ref: '' }],
  activity: [{ id: 'o1', source: 'github', kind: 'github.commit.pushed',
               title: 'Commit abc', occurred_at: '2026-06-01T09:00:00Z', ref: '' }],
  products: [{ deliverable_id: 'd1', build_type: 'web', title: 'Landing',
               status: 'saved', thread_id: 'th-1', updated_at: '2026-05-31T00:00:00Z' }],
  chats: [{ thread_id: 'th-1', title: 'Pricing page', mode: 'chat',
            updated_at: '2026-06-01T08:00:00Z' }],
  connectors: [{ provider: 'github', label: 'GitHub', resource_kind: 'single',
                 resource_noun: 'repository', resources: ['acme/site'], resource_count: 1,
                 status: 'connected', last_sync_at: '2026-06-01T07:00:00Z' }],
  freshness: { generated_at: '2026-06-01T12:00:00Z', last_activity_at: '2026-06-01T10:00:00Z',
               last_connector_sync_at: '2026-06-01T07:00:00Z',
               last_observation_at: '2026-06-01T10:00:00Z', last_chat_at: '2026-06-01T08:00:00Z',
               last_product_at: '2026-05-31T00:00:00Z' },
  counts: { attention: 1, activity: 1 },
};

const EMPTY: ProjectWorkspace = normalizeWorkspace({
  project: { id: 'p2', name: 'Empty', description: '' },
})!;

describe('normalizeWorkspace', () => {
  it('maps a complete payload field for field', () => {
    const ws = normalizeWorkspace(FULL)!;
    expect(ws.project.name).toBe('Fitness App');
    expect(ws.summary).toEqual({ text: 'A workout tracker.', source: 'brain' });
    expect(ws.goals.map((g) => g.title)).toEqual(['Ship v1', 'Talk to 10 users']);
    expect(ws.attention[0].severity).toBe('blocking');
    expect(ws.chats[0].thread_id).toBe('th-1');
    expect(ws.connectors[0].resources).toEqual(['acme/site']);
    expect(ws.counts.attention).toBe(1);
  });

  it('returns null when the payload is not a workspace', () => {
    expect(normalizeWorkspace(null)).toBeNull();
    expect(normalizeWorkspace(undefined)).toBeNull();
    expect(normalizeWorkspace({})).toBeNull();
    expect(normalizeWorkspace({ project: {} })).toBeNull();
    expect(normalizeWorkspace('nonsense')).toBeNull();
  });

  it('fills every section so the page never null-checks a degraded field', () => {
    expect(EMPTY.goals).toEqual([]);
    expect(EMPTY.attention).toEqual([]);
    expect(EMPTY.activity).toEqual([]);
    expect(EMPTY.products).toEqual([]);
    expect(EMPTY.chats).toEqual([]);
    expect(EMPTY.connectors).toEqual([]);
    expect(EMPTY.summary).toEqual({ text: '', source: '' });
    expect(EMPTY.freshness.last_activity_at).toBe('');
  });

  it('drops malformed rows instead of rendering blanks', () => {
    const ws = normalizeWorkspace({
      project: { id: 'p3' },
      goals: [{ title: '' }, { title: 'Real goal' }, 'junk'],
      attention: [{ id: '', reason: 'x' }, { id: 'a', severity: 'nope', reason: 'y' }],
      chats: [{ thread_id: '' }, { thread_id: 't', title: 'ok' }],
      connectors: [{ provider: '' }, { provider: 'slack', label: 'Slack' }],
    })!;
    expect(ws.goals.map((g) => g.title)).toEqual(['Real goal']);
    expect(ws.attention).toHaveLength(1);
    // An unknown severity degrades to the weakest tone — it never invents urgency.
    expect(ws.attention[0].severity).toBe('waiting');
    expect(ws.chats).toHaveLength(1);
    expect(ws.connectors.map((c) => c.provider)).toEqual(['slack']);
  });
});

describe('relativeTime', () => {
  const at = Date.parse('2026-06-01T12:00:00Z');

  it('buckets by minute / hour / day', () => {
    expect(relativeTime('2026-06-01T11:59:30Z', at)).toEqual({ unit: 'now' });
    expect(relativeTime('2026-06-01T11:48:00Z', at)).toEqual({ unit: 'minutes', value: 12 });
    expect(relativeTime('2026-06-01T09:00:00Z', at)).toEqual({ unit: 'hours', value: 3 });
    expect(relativeTime('2026-05-29T12:00:00Z', at)).toEqual({ unit: 'days', value: 3 });
  });

  it('never prints a negative age for a future timestamp (clock skew)', () => {
    expect(relativeTime('2026-06-01T18:00:00Z', at)).toEqual({ unit: 'now' });
  });

  it('returns null when there is no usable timestamp', () => {
    expect(relativeTime('', at)).toBeNull();
    expect(relativeTime(null, at)).toBeNull();
    expect(relativeTime(undefined, at)).toBeNull();
    expect(relativeTime('not-a-date', at)).toBeNull();
  });
});

describe('freshness', () => {
  const at = Date.parse('2026-06-01T12:00:00Z');

  it('reports the most recent real activity', () => {
    const ws = normalizeWorkspace(FULL)!;
    expect(freshnessRelative(ws.freshness, at)).toEqual({ unit: 'hours', value: 2 });
  });

  it('says nothing at all when there is no real timestamp', () => {
    expect(freshnessRelative(EMPTY.freshness, at)).toBeNull();
    expect(freshnessRelative(null, at)).toBeNull();
  });
});

describe('label resolution', () => {
  it('every attention reason resolves to a shipped i18n key', () => {
    const reasons = ['ci_failed', 'deploy_failed', 'preview_deploy_failed', 'pr_awaiting',
                     'meeting_soon', 'meeting_cancelled', 'build_failed'];
    for (const r of reasons) {
      const key = attentionReasonKey(r);
      expect(key).not.toBe('projectAttentionReasonGeneric');
      expect(LOCALES.en[key], r).toBeTruthy();
    }
  });

  it('an unknown reason falls back to a neutral shipped key, never a raw code', () => {
    const key = attentionReasonKey('some_future_reason');
    expect(key).toBe('projectAttentionReasonGeneric');
    expect(LOCALES.en[key]).toBeTruthy();
  });

  it('provider names are returned verbatim and never translated', () => {
    expect(sourceLabel('github')).toEqual({ kind: 'provider', name: 'GitHub' });
    expect(sourceLabel('calendar')).toEqual({ kind: 'provider', name: 'Google Calendar' });
    expect(sourceLabel('slack')).toEqual({ kind: 'provider', name: 'Slack' });
  });

  it("Korvix's own sources resolve to shipped i18n keys", () => {
    for (const source of ['chat', 'build', 'something-new']) {
      const label = sourceLabel(source);
      expect(label.kind).toBe('i18n');
      if (label.kind === 'i18n') expect(LOCALES.en[label.key]).toBeTruthy();
    }
  });

  it('known statuses translate and unknown ones fall through to the raw word', () => {
    for (const s of ['queued', 'running', 'completed', 'saved', 'failed', 'cancelled', 'handoff']) {
      const key = productStatusKey(s)!;
      expect(key, s).toBeTruthy();
      expect(LOCALES.en[key], s).toBeTruthy();
    }
    expect(productStatusKey('brand_new_status')).toBeNull();
    expect(productStatusKey('')).toBeNull();
    expect(productStatusKey(undefined)).toBeNull();
  });

  it('every relative-time and freshness key ships in all locales', () => {
    const rels = [{ unit: 'now' }, { unit: 'minutes', value: 1 },
                  { unit: 'hours', value: 1 }, { unit: 'days', value: 1 }] as const;
    for (const code of ['en', 'tr', 'de'] as const) {
      for (const rel of rels) {
        expect(LOCALES[code][relativeTimeKey(rel)], `${code}/${rel.unit}`).toBeTruthy();
        expect(LOCALES[code][freshnessKey(rel)], `${code}/${rel.unit}`).toBeTruthy();
      }
    }
  });

  it('severity maps to a tone without inventing a severity', () => {
    expect(severityTone('blocking')).toBe('critical');
    expect(severityTone('time_sensitive')).toBe('warning');
    expect(severityTone('waiting')).toBe('info');
  });

  it('build type is read from the backend, never guessed from the title', () => {
    expect(productBuildType({ build_type: 'app', title: 'A website' })).toBe('app');
    expect(productBuildType({ build_type: 'APP' })).toBe('app');
    expect(productBuildType({ title: 'My App' })).toBe('web');
    expect(productBuildType({})).toBe('web');
  });
});

describe('connectorSummary', () => {
  const base = { provider: 'github', label: 'GitHub', resource_kind: 'single',
                 resource_noun: 'repository', resources: [] as string[], resource_count: 0,
                 status: 'connected', last_sync_at: '' };

  it('names resources and counts the rest', () => {
    expect(connectorSummary({ ...base, resources: ['a/one', 'b/two', 'c/three'],
                              resource_count: 5 }))
      .toEqual({ kind: 'resources', named: ['a/one', 'b/two'], extra: 3 });
  });

  it('an account-cardinality provider reads as enabled, not as a fake resource', () => {
    expect(connectorSummary({ ...base, provider: 'gmail', label: 'Gmail',
                              resource_kind: 'account' }))
      .toEqual({ kind: 'enabled' });
  });

  it('surfaces the states the user can act on', () => {
    expect(connectorSummary({ ...base, status: 'pending_selection' })).toEqual({ kind: 'pending' });
    expect(connectorSummary({ ...base, status: 'revoked' })).toEqual({ kind: 'revoked' });
  });

  it('never negative extra when the count disagrees with the named list', () => {
    const s = connectorSummary({ ...base, resources: ['a', 'b'], resource_count: 1 });
    expect(s).toEqual({ kind: 'resources', named: ['a', 'b'], extra: 0 });
  });
});

describe('askSuggestions', () => {
  it('only offers questions whose concept exists in this project', () => {
    const ids = askSuggestions(EMPTY).map((s) => s.id);
    expect(ids).toEqual(['about']);   // always answerable, never an empty row
  });

  it('adds attention / activity / goals questions when those exist', () => {
    const ws = normalizeWorkspace(FULL)!;
    expect(askSuggestions(ws).map((s) => s.id)).toEqual(['attention', 'changed', 'goals', 'about']);
  });

  it('is empty without a workspace (nothing is guessed before the read lands)', () => {
    expect(askSuggestions(null)).toEqual([]);
  });

  it('every suggestion label and prompt ships in all locales', () => {
    const ws = normalizeWorkspace(FULL)!;
    for (const s of askSuggestions(ws)) {
      for (const code of ['en', 'tr', 'de'] as const) {
        expect(LOCALES[code][s.labelKey], `${code}/${s.id}`).toBeTruthy();
        expect(LOCALES[code][s.promptKey], `${code}/${s.id}`).toBeTruthy();
      }
    }
  });
});

describe('chat + product routing', () => {
  it('reuses the existing project-chat entry point', () => {
    expect(newProjectChatUrl('p 1')).toBe('/chat?newChatForProject=p%201');
    expect(openProjectChatUrl('th 1')).toBe('/chat?openSession=th%201');
  });

  it('seeds a question without changing the entry point', () => {
    expect(newProjectChatUrl('p1', 'What changed?'))
      .toBe('/chat?newChatForProject=p1&prefill=What%20changed%3F');
  });

  it('an empty or whitespace prefill is omitted entirely', () => {
    expect(newProjectChatUrl('p1', '   ')).toBe('/chat?newChatForProject=p1');
    expect(newProjectChatUrl('p1', '')).toBe('/chat?newChatForProject=p1');
  });

  it('a product opens in the chat it was generated in', () => {
    expect(productOpenTarget({ thread_id: 'th-1' })).toBe('/chat?openSession=th-1');
  });

  it('a product with no recorded chat offers no open link (never a dead link)', () => {
    expect(productOpenTarget({ deliverable_id: 'd1', artifact_ref: 'artifact://x' })).toBeNull();
    expect(productOpenTarget({ thread_id: '  ' })).toBeNull();
    expect(productOpenTarget({})).toBeNull();
  });
});
