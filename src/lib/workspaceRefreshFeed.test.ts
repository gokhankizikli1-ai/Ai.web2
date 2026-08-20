import { describe, it, expect } from 'vitest';
import {
  customizableSources,
  feedPreferenceKey,
  feedPreferenceOf,
  normalizeFeedPreference,
  normalizeFeedPreferences,
  normalizeRefresh,
  normalizeWorkspace,
  refreshPending,
  type ProjectWorkspace,
} from '@/lib/projectWorkspace';

/**
 * The two blocks the Project Workspace snapshot grew, and the pure decisions
 * the page makes from them.
 *
 * `refresh` is COORDINATION metadata: it answers one question — "is anything
 * coming, and how long should I wait before looking again?" — and the page must
 * be incapable of turning it into a polling loop. `feed_preferences` is a
 * PRESENTATION choice, and the page must be incapable of inventing one the
 * backend did not store.
 *
 * So the assertions here are mostly about what the frontend REFUSES to do with
 * a hostile or malformed payload.
 */

describe('normalizeRefresh — coordination metadata, defensively', () => {
  it('an absent block means nothing is happening', () => {
    expect(normalizeRefresh(undefined)).toEqual({
      started: [], inFlight: [], stale: [], recheckInMs: 0,
    });
  });

  it('an older backend that sends no block leaves the page never re-reading', () => {
    // The whole rollback story: with the feature off, `refresh` is absent and
    // `refreshPending` is false, so the page behaves exactly as it did before.
    const ws = normalizeWorkspace({ project: { id: 'p1' } })!;
    expect(ws.refresh.recheckInMs).toBe(0);
    expect(refreshPending(ws.refresh)).toBe(false);
  });

  it('reads the backend block', () => {
    expect(normalizeRefresh({
      started: ['github'], in_flight: ['vercel'],
      stale: ['github', 'vercel', 'gmail'], recheck_in_ms: 6000,
    })).toEqual({
      started: ['github'], inFlight: ['vercel'],
      stale: ['github', 'vercel', 'gmail'], recheckInMs: 6000,
    });
  });

  it('clamps the interval so a hostile value cannot become a tight loop', () => {
    expect(normalizeRefresh({ recheck_in_ms: 1 }).recheckInMs).toBe(1000);
    expect(normalizeRefresh({ recheck_in_ms: -5 }).recheckInMs).toBe(0);
    expect(normalizeRefresh({ recheck_in_ms: 9_999_999 }).recheckInMs).toBe(60_000);
    expect(normalizeRefresh({ recheck_in_ms: 'soon' }).recheckInMs).toBe(0);
  });

  it('drops non-string entries rather than rendering them', () => {
    expect(normalizeRefresh({ started: ['github', 42, null, ''] }).started)
      .toEqual(['github']);
  });
});

describe('refreshPending — the ONLY reason the page ever re-reads', () => {
  it('is false when nothing is running, even if something is stale', () => {
    // Stale-but-not-acted-on is the back-off case: the backend deliberately did
    // NOT start a refresh, so re-reading would show the same snapshot.
    expect(refreshPending(normalizeRefresh({
      stale: ['github'], recheck_in_ms: 6000,
    }))).toBe(false);
  });

  it('is false when a refresh is named but no interval is given', () => {
    expect(refreshPending(normalizeRefresh({
      started: ['github'], recheck_in_ms: 0,
    }))).toBe(false);
  });

  it('is true only when something is actually coming', () => {
    expect(refreshPending(normalizeRefresh({
      started: ['github'], recheck_in_ms: 6000,
    }))).toBe(true);
    expect(refreshPending(normalizeRefresh({
      in_flight: ['vercel'], recheck_in_ms: 6000,
    }))).toBe(true);
  });

  it('is false for a missing block', () => {
    expect(refreshPending(null)).toBe(false);
    expect(refreshPending(undefined)).toBe(false);
  });
});

describe('feed preferences — explicit choices only', () => {
  it('an uncustomised project normalizes to no choices at all', () => {
    expect(normalizeFeedPreferences(undefined)).toEqual({});
    expect(normalizeFeedPreferences({})).toEqual({});
  });

  it('never stores the default as a choice', () => {
    // `normal` is the absence of a preference. Round-tripping it would make an
    // untouched project look configured.
    expect(normalizeFeedPreferences({ github: 'normal' })).toEqual({});
  });

  it('drops a value it does not understand', () => {
    expect(normalizeFeedPreferences({
      github: 'highlight', vercel: 'obliterate', gmail: 42, slack: null,
    })).toEqual({ github: 'highlight' });
  });

  it('resolves an unknown or missing value to the default', () => {
    expect(normalizeFeedPreference('nonsense')).toBe('normal');
    expect(normalizeFeedPreference(undefined)).toBe('normal');
    expect(feedPreferenceOf({ github: 'hidden' }, 'github')).toBe('hidden');
    expect(feedPreferenceOf({ github: 'hidden' }, 'gmail')).toBe('normal');
    expect(feedPreferenceOf(null, 'gmail')).toBe('normal');
  });

  it('maps each value to a translated label key, never English prose', () => {
    expect(feedPreferenceKey('highlight')).toBe('projectFeedPrefHighlight');
    expect(feedPreferenceKey('normal')).toBe('projectFeedPrefNormal');
    expect(feedPreferenceKey('hidden')).toBe('projectFeedPrefHidden');
  });

  it('reads the snapshot block through the workspace normalizer', () => {
    const ws = normalizeWorkspace({
      project: { id: 'p1' },
      feed_preferences: { vercel: 'hidden', gmail: 'highlight', slack: 'normal' },
    })!;
    expect(ws.feedPreferences).toEqual({ vercel: 'hidden', gmail: 'highlight' });
  });
});

function workspaceWith(
  parts: { connectors?: string[]; activity?: string[]; prefs?: Record<string, string> },
): ProjectWorkspace {
  return normalizeWorkspace({
    project: { id: 'p1' },
    connectors: (parts.connectors || []).map((provider) => ({ provider })),
    activity: (parts.activity || []).map((source, i) => ({ id: `a${i}`, source })),
    feed_preferences: parts.prefs || {},
  })!;
}

describe('customizableSources — offer what this project actually uses', () => {
  it('offers nothing before the workspace has loaded', () => {
    expect(customizableSources(null)).toEqual([]);
  });

  it('offers a connected source even before it has produced anything', () => {
    const ws = workspaceWith({ connectors: ['github'] });
    expect(customizableSources(ws)).toEqual(['github']);
  });

  it('offers a source that has appeared in the feed without a connector row', () => {
    // Chat, builds, tasks and knowledge are real feed sources with no connector.
    const ws = workspaceWith({ activity: ['chat', 'build'] });
    expect(customizableSources(ws).sort()).toEqual(['build', 'chat']);
  });

  it('still offers a source the user already has a preference for', () => {
    // Otherwise a choice could become impossible to undo the moment the source
    // went quiet — the user would be stuck with a hidden source forever.
    const ws = workspaceWith({ prefs: { slack: 'hidden' } });
    expect(customizableSources(ws)).toEqual(['slack']);
  });

  it('never offers the same source twice', () => {
    const ws = workspaceWith({
      connectors: ['github'], activity: ['github', 'github'],
      prefs: { github: 'highlight' },
    });
    expect(customizableSources(ws)).toEqual(['github']);
  });

  it("follows the backend's order when it supplies one", () => {
    const ws = workspaceWith({ connectors: ['slack', 'github'], activity: ['chat'] });
    expect(customizableSources(ws, ['gmail', 'github', 'slack', 'chat']))
      .toEqual(['github', 'slack', 'chat']);
  });

  it('keeps a source the backend vocabulary does not know, rather than losing it', () => {
    const ws = workspaceWith({ activity: ['github', 'future_tool'] });
    expect(customizableSources(ws, ['github'])).toEqual(['github', 'future_tool']);
  });

  it('offers nothing for a project with no tools and no activity', () => {
    expect(customizableSources(workspaceWith({}))).toEqual([]);
  });
});
