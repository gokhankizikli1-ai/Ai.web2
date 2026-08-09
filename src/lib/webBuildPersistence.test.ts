import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveWebBuildSession, getWebBuildSession, getActiveWebBuildSession,
  listWebBuildSessions, sessionIdOf,
} from '@/lib/webBuildSession';
import { upsertWebBuildChatSession } from '@/lib/webBuildChatSession';
import { currentUserScope } from '@/lib/userScope';
import type { WebBuildPayload } from '@/lib/webBuildPayload';

/**
 * Persistence round-trip + quota-resilience regression suite.
 *
 * Bug: the Web Build payload (contents) and the sidebar title row are two separate localStorage
 * stores. The payload writer swallowed QuotaExceededError, so once the shared payload blob exceeded
 * the browser quota the LARGE payload write failed silently while the TINY title row still
 * persisted — "title survives in Recent, but reopening shows the contents are gone." These tests
 * pin that the payload now survives a reload (eviction keeps the current + recent builds), that the
 * title and content stay tied to the same conversation id, and that acceptanceGate and other
 * artifacts survive the persistence round-trip.
 */

/** In-memory localStorage. `byteBudget` simulates the browser quota: once the TOTAL stored bytes
 *  would exceed it, setItem throws QuotaExceededError (exactly like a real browser). */
function installStorage(byteBudget = Infinity) {
  const m = new Map<string, string>();
  const totalBytesIf = (key: string, value: string) => {
    let total = 0;
    for (const [k, v] of m) { if (k !== key) total += k.length + v.length; }
    return total + key.length + value.length;
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (totalBytesIf(k, String(v)) > byteBudget) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      m.set(k, String(v));
    },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return m;
}

const asUser = (id: string) => localStorage.setItem('korvix-auth', JSON.stringify({ state: { user: { id } } }));

/** A payload whose last step carries a big generated file + optional acceptance artifact, so the
 *  serialized size is realistic enough to exercise the quota path. */
function payload(stepId: string, prompt: string, opts: { bytes?: number; acceptanceGate?: unknown } = {}): WebBuildPayload {
  const filler = 'x'.repeat(opts.bytes ?? 64);
  return {
    steps: [{
      id: stepId,
      artifacts: {
        frontendBuilderFile: { content: filler },
        ...(opts.acceptanceGate
          ? { frontendBuilderAcceptance: { version: 'frontend-acceptance-v1', status: 'manual-review-required', acceptanceGate: opts.acceptanceGate } }
          : {}),
      },
    }],
    prompt, brief: {}, sectionItems: [], files: [{ path: 'App.tsx', content: filler }], createdAt: `t-${stepId}`,
  } as unknown as WebBuildPayload;
}

describe('Web Build payload persists across reload (contents restored, not just the title)', () => {
  beforeEach(() => { installStorage(); asUser('A'); });

  it('completed build → getWebBuildSession returns the SAME payload after a simulated reload', () => {
    const p = payload('step-1', 'a fitness coaching site');
    const id = saveWebBuildSession(p, 'en');
    expect(id).toBe(sessionIdOf(p));
    // "Reload" = a fresh read from the same localStorage. The contents come back.
    const restored = getWebBuildSession(id);
    expect(restored).not.toBeNull();
    expect(restored!.prompt).toBe('a fitness coaching site');
    expect(getActiveWebBuildSession()?.prompt).toBe('a fitness coaching site');
  });

  it('acceptanceGate (and other artifacts) survive the persistence round-trip', () => {
    const gate = {
      version: 'frontend-acceptance-gate-v1', outcome: 'rejected', primaryReasonCode: 'score-not-improved',
      initialScore: 84, finalScore: 84, minRequiredScore: 82, scoreImproved: false, scoreMeetsThreshold: true,
    };
    const id = saveWebBuildSession(payload('step-2', 'ai saas', { acceptanceGate: gate }), 'en');
    const restored = getWebBuildSession(id);
    const roundTripped = (restored!.steps[0] as unknown as { artifacts: { frontendBuilderAcceptance: { acceptanceGate: unknown } } })
      .artifacts.frontendBuilderAcceptance.acceptanceGate;
    expect(roundTripped).toEqual(gate);
  });

  it('title row and payload stay tied to the SAME conversation id', () => {
    const p = payload('step-3', 'restaurant site');
    const runId = saveWebBuildSession(p, 'en');
    // The sidebar companion points webBuildRunId → the payload id (4-arg chat form).
    upsertWebBuildChatSession('chat-abc', runId, 'Website: Restaurant', p.prompt);
    const row = JSON.parse(localStorage.getItem(`korvix_sessions_${currentUserScope()}`)!)
      .find((s: { id: string }) => s.id === 'chat-abc');
    expect(row.webBuildRunId).toBe(runId);
    // The id the row points at resolves to real content — no dangling title.
    expect(getWebBuildSession(row.webBuildRunId)).not.toBeNull();
  });
});

describe('quota resilience — the large payload write no longer fails silently', () => {
  it('under quota pressure the CURRENT build is stored (old builds evicted, not the new one)', () => {
    // Budget fits only ~3 payloads of this size. Writing more must evict OLD ones and keep the new.
    installStorage(6000);
    asUser('A');
    let lastId = '';
    for (let i = 0; i < 6; i++) {
      lastId = saveWebBuildSession(payload(`step-${i}`, `build ${i}`, { bytes: 1200 }), 'en');
      // Every save must succeed (return a real id) — never the silent-drop empty string.
      expect(lastId).toBe(`step-${i}`);
    }
    // The most-recent build's contents are retrievable after the churn (the reported bug is gone).
    expect(getWebBuildSession(lastId)?.prompt).toBe('build 5');
    // The store is bounded — it did not grow unbounded and did not keep every old build.
    expect(listWebBuildSessions().length).toBeLessThanOrEqual(8);
    // The oldest build was evicted to make room (expected trade-off), but never the newest.
    expect(getWebBuildSession('step-0')).toBeNull();
  });

  it('switching A → B → A preserves A within the retained window', () => {
    installStorage();
    asUser('A');
    const aId = saveWebBuildSession(payload('step-A', 'A prompt'), 'en');
    saveWebBuildSession(payload('step-B', 'B prompt'), 'en');
    // Reopen A: still fully restorable.
    expect(getWebBuildSession(aId)?.prompt).toBe('A prompt');
  });
});

describe('user isolation and owner/non-owner parity', () => {
  it('one account never sees another account\'s build (isolation preserved by the fix)', () => {
    installStorage();
    asUser('A');
    saveWebBuildSession(payload('step-A', 'A prompt'), 'en');
    asUser('B');
    expect(getActiveWebBuildSession()).toBeNull();
    expect(listWebBuildSessions()).toHaveLength(0);
    const bId = saveWebBuildSession(payload('step-B', 'B prompt'), 'en');
    expect(getWebBuildSession(bId)?.prompt).toBe('B prompt');
    // A is untouched.
    asUser('A');
    expect(getWebBuildSession('step-A')?.prompt).toBe('A prompt');
    expect(getWebBuildSession('step-B')).toBeNull();
  });

  it('persistence path has NO owner branch — identical behavior for two different users', () => {
    // The store keys on user id only; there is no isOwner/admin branch anywhere in the save/load
    // path, so an owner and a normal user persist and restore their own builds identically.
    installStorage();
    for (const uid of ['owner-1', 'normal-2']) {
      asUser(uid);
      const id = saveWebBuildSession(payload(`step-${uid}`, `${uid} prompt`), 'en');
      expect(id).toBe(`step-${uid}`);
      expect(getWebBuildSession(id)?.prompt).toBe(`${uid} prompt`);
    }
  });
});
