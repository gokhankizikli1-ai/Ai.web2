/**
 * projectSendResolve — race-free resolution of the project id an AI request
 * carries (the fix for "frontend never sends project_id, so Project Brain
 * never activates on the live path").
 *
 * These are the frontend request-payload tests A–F. They prove the exact
 * decision useChat makes just before building the /v2/chat/stream and legacy
 * /chat bodies, WITHOUT React (node-env vitest, no jsdom/RTL) — the resolver
 * is a pure function so the switch-then-send race is testable directly.
 *
 *   A. a bound chat (resolved for THIS session) → sends its project_id
 *   B. an explicitly-unbound chat (resolved, pid=null, no pending) → sends none
 *   C. switch bound A → unbound B, then send → sends NOTHING (no A leak)
 *   D. switch bound A → bound B, then send → sends B's project (not A's)
 *   E. new-from-project chat, no server thread yet → first turn carries pending
 *   F. brand-new project chat resolved with null cache but a pending target
 *      → pending fills the null (first turn still gets context)
 *
 * Plus defensive cases: getThreadProject failure and server-disabled both
 * degrade to the pending target (or null), never to a stale/foreign id.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveSendProjectId, type SendProjectIdDeps } from '@/lib/projectSendResolve';

const base = (over: Partial<SendProjectIdDeps> = {}): SendProjectIdDeps => ({
  pending: null,
  cached: { sid: '', pid: null },
  session: undefined,
  serverEnabled: true,
  getThreadProject: vi.fn(async () => null),
  ...over,
});

describe('resolveSendProjectId — request payload authority (A–F)', () => {
  // ── A. bound chat resolved for THIS session → sends its project_id ─────────
  it('A: sends the resolved project_id for a bound active chat', async () => {
    const gtp = vi.fn(async () => 'should-not-be-called');
    const pid = await resolveSendProjectId('chat_A', base({
      cached: { sid: 'chat_A', pid: 'proj_1' },
      getThreadProject: gtp,
    }));
    expect(pid).toBe('proj_1');
    // Resolved-for-this-session short-circuits the network lookup.
    expect(gtp).not.toHaveBeenCalled();
  });

  // ── B. explicitly-unbound chat → sends NO project_id ───────────────────────
  it('B: sends null for a chat resolved as unbound (no pending)', async () => {
    const pid = await resolveSendProjectId('chat_B', base({
      cached: { sid: 'chat_B', pid: null },
      pending: null,
    }));
    expect(pid).toBeNull();
  });

  // ── C. switch bound A → unbound B, then send → NO leak of A's project ──────
  it('C: switching to an unbound chat sends nothing (no stale A leak)', async () => {
    // Cache still holds A's resolution; we now send for B.
    const gtp = vi.fn(async () => null); // B is unbound on the backend
    const pid = await resolveSendProjectId('chat_B', base({
      cached: { sid: 'chat_A', pid: 'proj_A' }, // stale — for A, not B
      session: { serverThreadId: 'thread_B' },
      getThreadProject: gtp,
    }));
    expect(pid).toBeNull();               // NOT 'proj_A'
    expect(gtp).toHaveBeenCalledWith('thread_B');
  });

  // ── D. switch bound A → bound B, then send → sends B's project ─────────────
  it('D: switching to another bound chat sends the new chat project (B)', async () => {
    const gtp = vi.fn(async () => 'proj_B');
    const pid = await resolveSendProjectId('chat_B', base({
      cached: { sid: 'chat_A', pid: 'proj_A' }, // stale
      session: { serverThreadId: 'thread_B' },
      getThreadProject: gtp,
    }));
    expect(pid).toBe('proj_B');           // authoritative B, not stale A
    expect(gtp).toHaveBeenCalledWith('thread_B');
  });

  // ── E. new-from-project chat, no server thread yet → pending on first turn ─
  it('E: a new-from-project chat carries its pending target on the first turn', async () => {
    const gtp = vi.fn(async () => null);
    const pid = await resolveSendProjectId('chat_new', base({
      cached: { sid: '', pid: null },        // effect hasn't resolved yet
      session: { serverThreadId: null },     // no backend thread yet
      pending: 'proj_new',
      getThreadProject: gtp,
    }));
    expect(pid).toBe('proj_new');
    expect(gtp).not.toHaveBeenCalled();      // no thread → no network lookup
  });

  // ── F. cache resolved null for this session but a pending target exists ────
  it('F: pending fills a null cache for a brand-new project chat', async () => {
    const pid = await resolveSendProjectId('chat_new', base({
      cached: { sid: 'chat_new', pid: null }, // resolved, but nothing bound yet
      pending: 'proj_new',
    }));
    expect(pid).toBe('proj_new');
  });
});

describe('resolveSendProjectId — degradation is safe, never stale/foreign', () => {
  it('getThreadProject failure degrades to pending (never the stale cache)', async () => {
    const gtp = vi.fn(async () => { throw new Error('network'); });
    const pid = await resolveSendProjectId('chat_B', base({
      cached: { sid: 'chat_A', pid: 'proj_A' }, // stale
      session: { serverThreadId: 'thread_B' },
      pending: 'proj_pending',
      getThreadProject: gtp,
    }));
    expect(pid).toBe('proj_pending');
  });

  it('getThreadProject failure with no pending degrades to null (no A leak)', async () => {
    const gtp = vi.fn(async () => { throw new Error('network'); });
    const pid = await resolveSendProjectId('chat_B', base({
      cached: { sid: 'chat_A', pid: 'proj_A' }, // stale
      session: { serverThreadId: 'thread_B' },
      pending: null,
      getThreadProject: gtp,
    }));
    expect(pid).toBeNull();
  });

  it('server disabled skips the lookup and returns the pending target only', async () => {
    const gtp = vi.fn(async () => 'proj_B');
    const pid = await resolveSendProjectId('chat_B', base({
      cached: { sid: 'chat_A', pid: 'proj_A' },
      session: { serverThreadId: 'thread_B' },
      serverEnabled: false,
      pending: null,
      getThreadProject: gtp,
    }));
    expect(pid).toBeNull();
    expect(gtp).not.toHaveBeenCalled();
  });
});
