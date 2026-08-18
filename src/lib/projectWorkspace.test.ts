import { describe, it, expect } from 'vitest';
import {
  askSuggestions,
  attentionReasonKey,
  changeKindKey,
  changesCountKey,
  changesTitleKey,
  connectorSummary,
  freshnessKey,
  freshnessRelative,
  knowledgeKindKey,
  newProjectChatUrl,
  normalizeKnowledgeItem,
  normalizeTask,
  normalizeWorkspace,
  openProjectChatUrl,
  openTaskCount,
  openTasks,
  productBuildType,
  productOpenTarget,
  productStatusKey,
  recommendationActionKey,
  recommendationAskKey,
  recommendationReasonKey,
  relativeTime,
  relativeTimeKey,
  renderableActions,
  seenThrough,
  severityTone,
  sourceLabel,
  taskStatusKey,
  toggledTaskStatus,
  KNOWLEDGE_KIND_ORDER,
  TASK_STATUS_ORDER,
  type ProjectTask,
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

/* ══════════════════════════════════════════════════════════════════════════
   Project Workspace V2 — Today, Tasks, Knowledge, Since your last visit.

   The presentation rules that keep the page HONEST live here, so this is where
   they are pinned: a payload that cannot prove a visit must not print one, an
   action code the bundle cannot render must not become a button, and every
   stable code the backend can emit must resolve to a real shipped locale key
   in every shipped language.
   ══════════════════════════════════════════════════════════════════════════ */

const task = (over: Partial<ProjectTask> = {}): ProjectTask => ({
  id: 't1', title: 'Review pricing', details: '', status: 'todo', priority: 2,
  source: 'user', origin_ref: '', created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z', completed_at: '', ...over,
});

describe('normalizeWorkspace — the V2 blocks', () => {
  it('defaults every new block when the backend omits it', () => {
    const w = normalizeWorkspace({ project: { id: 'p1' } })!;
    expect(w.today).toEqual({ attention: null, recommendation: null });
    expect(w.tasks).toEqual({ items: [], counts: {} });
    expect(w.knowledge).toEqual({ items: [], counts: {} });
    expect(w.changes.items).toEqual([]);
    expect(w.changes.count).toBe(0);
  });

  it('defaults an unknown change mode to the WEAKER claim', () => {
    // A payload that cannot prove a visit must never print "since your last
    // visit" — anything but the exact mode falls back to `recent`.
    for (const mode of [undefined, '', 'anything', 'SINCE_LAST_VISIT', 42]) {
      const w = normalizeWorkspace({ project: { id: 'p1' }, changes: { mode } })!;
      expect(w.changes.mode).toBe('recent');
    }
    const real = normalizeWorkspace({
      project: { id: 'p1' }, changes: { mode: 'since_last_visit' },
    })!;
    expect(real.changes.mode).toBe('since_last_visit');
  });

  it('never claims fewer changes than it is about to render', () => {
    const w = normalizeWorkspace({
      project: { id: 'p1' },
      changes: {
        mode: 'recent', count: 0,
        items: [{ key: 'a', title: 'One' }, { key: 'b', title: 'Two' }],
      },
    })!;
    expect(w.changes.count).toBe(2);
  });

  it('drops a change row with no dedup key', () => {
    const w = normalizeWorkspace({
      project: { id: 'p1' },
      changes: { items: [{ key: '', title: 'Ghost' }, { key: 'k', title: 'Real' }] },
    })!;
    expect(w.changes.items.map((c) => c.title)).toEqual(['Real']);
  });

  it('normalizes today, passing the recommendation through verbatim', () => {
    const w = normalizeWorkspace({
      project: { id: 'p1' },
      today: {
        attention: { id: 'a1', severity: 'blocking', reason: 'deploy_failed',
                     source: 'vercel', title: 'Production deployment failed' },
        recommendation: { reason: 'investigate_failed_deploy', source: 'attention',
                          ref_id: 'a1', title: 'Production deployment failed',
                          context: 'Acme', actions: ['ask_korvix', 'create_task'] },
      },
    })!;
    expect(w.today.attention?.id).toBe('a1');
    expect(w.today.recommendation?.title).toBe('Production deployment failed');
    expect(w.today.recommendation?.actions).toEqual(['ask_korvix', 'create_task']);
  });

  it('treats a recommendation with no reason as no recommendation', () => {
    const w = normalizeWorkspace({
      project: { id: 'p1' }, today: { recommendation: { title: 'Hmm' } },
    })!;
    expect(w.today.recommendation).toBeNull();
  });

  it('drops a task with no id or no title rather than rendering a blank row', () => {
    expect(normalizeTask({ id: '', title: 'x' })).toBeNull();
    expect(normalizeTask({ id: 't', title: '' })).toBeNull();
    expect(normalizeTask({ id: 't', title: 'x' })?.status).toBe('todo');
    expect(normalizeTask({ id: 't', title: 'x', status: 'archived' })?.status).toBe('todo');
  });

  it('drops a knowledge item whose kind this bundle does not know', () => {
    // Rendering it under a made-up heading would misrepresent what it is.
    expect(normalizeKnowledgeItem({ id: 'k', kind: 'epic', text: 'x' })).toBeNull();
    expect(normalizeKnowledgeItem({ id: 'k', kind: 'decision', text: '' })).toBeNull();
    const ok = normalizeKnowledgeItem({ id: 'memory:k', kind: 'constraint',
                                        text: 'Read-only', removable: true });
    expect(ok?.kind).toBe('constraint');
    expect(ok?.removable).toBe(true);
  });

  it('never treats a missing `removable` as permission to delete', () => {
    expect(normalizeKnowledgeItem({ id: 'k', kind: 'fact', text: 'x' })?.removable)
      .toBe(false);
    expect(normalizeKnowledgeItem({ id: 'k', kind: 'fact', text: 'x',
                                    removable: 'yes' })?.removable).toBe(false);
  });
});

describe('today — labels and actions', () => {
  it('resolves every recommendation reason the backend can emit', () => {
    // Mirrors `backend/services/project_brain/today.py`.
    const reasons = [
      'investigate_failed_deploy', 'investigate_failed_preview_deploy',
      'fix_failing_checks', 'fix_failed_build', 'review_open_pull_request',
      'prepare_for_meeting', 'review_calendar_change', 'review_signal',
      'continue_task', 'start_task', 'unblock_task', 'continue_goal',
    ];
    for (const reason of reasons) {
      const key = recommendationReasonKey(reason);
      expect(key).not.toBe('projectTodayRecoGeneric');
      for (const locale of ['en', 'tr', 'de'] as const) {
        expect(LOCALES[locale][key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });

  it('falls back to a neutral key for a reason this bundle predates', () => {
    expect(recommendationReasonKey('reason_from_the_future'))
      .toBe('projectTodayRecoGeneric');
    expect(LOCALES.en.projectTodayRecoGeneric).toBeTruthy();
  });

  it('drops an action code it cannot render rather than showing a dead button', () => {
    const reco = {
      reason: 'review_signal', source: 'attention', ref_id: 'a1', title: '',
      context: '', actions: ['ask_korvix', 'launch_the_missiles', 'create_task'],
    };
    expect(renderableActions(reco)).toEqual(['ask_korvix', 'create_task']);
    expect(recommendationActionKey('launch_the_missiles')).toBeNull();
    expect(renderableActions(null)).toEqual([]);
  });

  it('resolves every renderable action label in every shipped locale', () => {
    for (const action of ['ask_korvix', 'create_task', 'open_tasks']) {
      const key = recommendationActionKey(action)!;
      expect(key).toBeTruthy();
      for (const locale of ['en', 'tr', 'de'] as const) {
        expect(LOCALES[locale][key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });

  it('asks about the same thing the recommendation names', () => {
    const base = { reason: 'x', ref_id: '', title: '', context: '', actions: [] };
    expect(recommendationAskKey({ ...base, source: 'task' }))
      .toBe('projectTodayAskTaskPrompt');
    expect(recommendationAskKey({ ...base, source: 'goal' }))
      .toBe('projectTodayAskGoalPrompt');
    expect(recommendationAskKey({ ...base, source: 'attention' }))
      .toBe('projectTodayAskSignalPrompt');
    expect(recommendationAskKey(null)).toBeNull();
  });
});

describe('tasks — presentation', () => {
  it('labels all four states in every shipped locale', () => {
    expect(TASK_STATUS_ORDER).toEqual(['todo', 'doing', 'waiting', 'done']);
    for (const status of TASK_STATUS_ORDER) {
      const key = taskStatusKey(status);
      for (const locale of ['en', 'tr', 'de'] as const) {
        expect(LOCALES[locale][key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });

  it('the completion toggle only ever touches the completion axis', () => {
    // Reopening returns to `todo` rather than guessing which open state a task
    // used to be in — a checkbox must not make a choice the user did not.
    expect(toggledTaskStatus('todo')).toBe('done');
    expect(toggledTaskStatus('doing')).toBe('done');
    expect(toggledTaskStatus('waiting')).toBe('done');
    expect(toggledTaskStatus('done')).toBe('todo');
  });

  it('openTasks keeps the backend order and drops only what is finished', () => {
    const rows = [task({ id: 'a', status: 'doing' }), task({ id: 'b', status: 'done' }),
                  task({ id: 'c', status: 'waiting' })];
    expect(openTasks(rows).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('the open count comes from the backend total, not the bounded slice', () => {
    const w = normalizeWorkspace({
      project: { id: 'p1' },
      tasks: { items: [{ id: 't1', title: 'One' }], counts: { open: 17 } },
    })!;
    expect(w.tasks.items).toHaveLength(1);
    expect(openTaskCount(w)).toBe(17);
    expect(openTaskCount(null)).toBe(0);
  });
});

describe('knowledge — presentation', () => {
  it('labels every kind in every shipped locale', () => {
    expect(KNOWLEDGE_KIND_ORDER).toEqual(
      ['decision', 'requirement', 'constraint', 'fact', 'note']);
    for (const kind of KNOWLEDGE_KIND_ORDER) {
      const key = knowledgeKindKey(kind);
      for (const locale of ['en', 'tr', 'de'] as const) {
        expect(LOCALES[locale][key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });
});

describe('changes — the title is the claim', () => {
  it('only a real marker may say "since your last visit"', () => {
    expect(changesTitleKey({ mode: 'since_last_visit', since: '', last_viewed_at: '',
                             items: [], count: 0, truncated: false }))
      .toBe('projectChangesSinceTitle');
    expect(changesTitleKey({ mode: 'recent', since: '', last_viewed_at: '',
                             items: [], count: 0, truncated: false }))
      .toBe('projectChangesRecentTitle');
    // No payload at all → the weaker claim, never the stronger one.
    expect(changesTitleKey(null)).toBe('projectChangesRecentTitle');
    expect(changesTitleKey(undefined)).toBe('projectChangesRecentTitle');
  });

  it('counts are singular-aware in every shipped locale', () => {
    expect(changesCountKey(1)).toBe('projectChangesCountOne');
    expect(changesCountKey(0)).toBe('projectChangesCountMany');
    expect(changesCountKey(4)).toBe('projectChangesCountMany');
    for (const locale of ['en', 'tr', 'de'] as const) {
      expect(LOCALES[locale].projectChangesCountOne).toBeTruthy();
      expect(LOCALES[locale].projectChangesCountMany).toContain('{count}');
    }
  });

  it('labels every change kind the backend can emit', () => {
    for (const change of ['connector', 'chat', 'build', 'task', 'knowledge']) {
      const key = changeKindKey(change)!;
      expect(key).toBeTruthy();
      for (const locale of ['en', 'tr', 'de'] as const) {
        expect(LOCALES[locale][key], `${locale}:${key}`).toBeTruthy();
      }
    }
    expect(changeKindKey('something_new')).toBeNull();
  });
});

describe('visit acknowledgement', () => {
  it('acknowledges with the snapshot instant, never a guess', () => {
    const w = normalizeWorkspace({
      project: { id: 'p1' },
      freshness: { generated_at: '2026-06-01T12:00:00Z' },
    })!;
    expect(seenThrough(w)).toBe('2026-06-01T12:00:00Z');
  });

  it('does not acknowledge at all when the snapshot carries no instant', () => {
    // Falling back to "now" would swallow anything that arrived while the read
    // was in flight, so the correct answer is to skip the acknowledgement.
    expect(seenThrough(normalizeWorkspace({ project: { id: 'p1' } })!)).toBeNull();
    expect(seenThrough(null)).toBeNull();
  });
});

describe('activity sources', () => {
  it('labels the two new internal sources without inventing a provider', () => {
    expect(sourceLabel('task')).toEqual({ kind: 'i18n', key: 'projectSourceTask' });
    expect(sourceLabel('knowledge'))
      .toEqual({ kind: 'i18n', key: 'projectSourceKnowledge' });
    for (const locale of ['en', 'tr', 'de'] as const) {
      expect(LOCALES[locale].projectSourceTask).toBeTruthy();
      expect(LOCALES[locale].projectSourceKnowledge).toBeTruthy();
    }
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   MERGE-SAFETY — the regressions this change is most able to cause.

   The Project page is the entry point to chat, builds and connectors, so the
   ways it can break other people's features are: losing the project binding on
   "Ask Korvix", losing the originating chat on a product, or letting a big
   project render an unbounded list.
   ══════════════════════════════════════════════════════════════════════════ */

describe('merge safety — chat + product routing survives', () => {
  it('Ask Korvix still carries the project id, seeded and unseeded', () => {
    // The binding is what makes it a PROJECT chat rather than a standalone one.
    const plain = newProjectChatUrl('p-123');
    expect(plain).toContain('newChatForProject=p-123');
    const seeded = newProjectChatUrl('p-123', 'What should I look at first?');
    expect(seeded).toContain('newChatForProject=p-123');
    expect(seeded).toContain('prefill=');
    // …and every Today recommendation seeds a prompt that resolves to real copy.
    for (const source of ['attention', 'task', 'goal']) {
      const key = recommendationAskKey({
        reason: 'review_signal', source, ref_id: '', title: '', context: '',
        actions: [],
      })!;
      for (const locale of ['en', 'tr', 'de'] as const) {
        expect(LOCALES[locale][key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });

  it('a project id needing encoding is escaped, not injected', () => {
    const url = newProjectChatUrl('a b&c=d');
    expect(url).toContain('newChatForProject=a%20b%26c%3Dd');
    expect(url.split('?')[1].split('&').length).toBe(1);
  });

  it('a product still opens the chat it was generated in', () => {
    expect(productOpenTarget({ thread_id: 'th-9' })).toBe(openProjectChatUrl('th-9'));
    // …and a product with no recorded thread offers NO link rather than a dead one.
    expect(productOpenTarget({})).toBeNull();
    expect(productOpenTarget({ thread_id: '' })).toBeNull();
    expect(productOpenTarget({ thread_id: '   ' })).toBeNull();
  });

  it('chat rows key off the SERVER thread id, never a local session id', () => {
    const w = normalizeWorkspace({
      project: { id: 'p1' },
      chats: [{ thread_id: 'srv-1', title: 'A' }, { title: 'no id' }],
    })!;
    // A row without a server thread id is dropped — it could not be opened,
    // bound or removed, so rendering it would only produce a dead control.
    expect(w.chats.map((c) => c.thread_id)).toEqual(['srv-1']);
  });
});

describe('merge safety — a large project stays bounded in the UI layer', () => {
  it('renders whatever the backend sends without re-deriving totals from it', () => {
    // 6 task rows on screen, 137 open in reality: the count must come from the
    // backend's own total, never from `items.length`, or a bounded list would
    // quietly under-report a busy project.
    const w = normalizeWorkspace({
      project: { id: 'p1' },
      tasks: {
        items: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, title: `task ${i}` })),
        counts: { open: 137, todo: 130, doing: 5, waiting: 2, done: 11 },
      },
      knowledge: {
        items: Array.from({ length: 4 }, (_, i) => ({
          id: `memory:k${i}`, kind: 'constraint', text: `c ${i}` })),
        counts: { total: 212, constraint: 200, decision: 12 },
      },
    })!;
    expect(w.tasks.items).toHaveLength(6);
    expect(openTaskCount(w)).toBe(137);
    expect(w.knowledge.items).toHaveLength(4);
    expect(w.knowledge.counts.total).toBe(212);
  });

  it('survives a huge payload without dropping or duplicating rows', () => {
    const big = normalizeWorkspace({
      project: { id: 'p1', name: 'x'.repeat(5000), description: 'y'.repeat(5000) },
      tasks: { items: Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, title: 't' })) },
      activity: Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, source: 'github' })),
      changes: { mode: 'recent', items: Array.from({ length: 500 }, (_, i) => ({ key: `k${i}` })) },
    })!;
    expect(big.tasks.items).toHaveLength(500);
    expect(new Set(big.tasks.items.map((t) => t.id)).size).toBe(500);
    // A very long name is passed through intact — truncation is the page's job
    // (CSS), not the contract's, so nothing is silently lost.
    expect(big.project.name).toHaveLength(5000);
  });

  it('an empty project normalizes to honest empties, never to null holes', () => {
    const empty = normalizeWorkspace({ project: { id: 'p1', name: 'New' } })!;
    expect(empty.tasks.items).toEqual([]);
    expect(empty.knowledge.items).toEqual([]);
    expect(empty.activity).toEqual([]);
    expect(empty.goals).toEqual([]);
    expect(empty.attention).toEqual([]);
    expect(empty.today).toEqual({ attention: null, recommendation: null });
    expect(empty.changes.items).toEqual([]);
    expect(openTaskCount(empty)).toBe(0);
    expect(askSuggestions(empty).length).toBeGreaterThan(0); // never an empty row
  });
});

describe('merge safety — localStorage is not a task authority', () => {
  it('the project store exports no task read/write API', async () => {
    // A localStorage `updateProjectTask` used to sit alongside the real one and
    // shadowed it by name. An auto-import from the wrong module would have
    // written a task to the browser and lost it silently.
    const store = await import('@/stores/projectStore');
    for (const banned of ['getProjectTasks', 'addProjectTask', 'updateProjectTask',
                          'saveTasks', 'loadTasks']) {
      expect(banned in store, `projectStore re-exported ${banned}`).toBe(false);
    }
  });

  it('the only task client is the server-authoritative one', async () => {
    const api = await import('@/lib/projectApi');
    for (const fn of ['listProjectTasks', 'createProjectTask', 'updateProjectTask',
                      'deleteProjectTask']) {
      expect(typeof (api as Record<string, unknown>)[fn]).toBe('function');
    }
  });
});
