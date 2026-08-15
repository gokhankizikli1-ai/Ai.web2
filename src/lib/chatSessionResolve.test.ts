/**
 * chatSessionResolve — regression tests for the live "clicking a project chat
 * opens a blank new chat" bug.
 *
 * ROOT CAUSE: the Project Overview opens a chat by its SERVER THREAD ID, but the
 * open-request resolver matched only ChatSession.id. A chat that originated
 * locally and later synced keeps a random local id while carrying
 * serverThreadId=<threadId>, so the match failed and no existing session was
 * selected — the user landed on the default blank chat. Fix: match by id OR
 * serverThreadId, and select the matched session's LOCAL id.
 */
import { describe, it, expect } from 'vitest';
import type { ChatSession } from '@/types';
import { resolveOpenTarget } from './chatSessionResolve';

function chat(over: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'local-1', title: 'Chat', messages: [], updatedAt: new Date(), ...over,
  };
}

describe('resolveOpenTarget', () => {
  // A. local id != serverThreadId → opening by serverThreadId finds the chat.
  it('matches a locally-originated synced chat by its server thread id', () => {
    const sessions = [
      chat({ id: 'local-abc', serverThreadId: 'thread-xyz', title: 'Real chat' }),
      chat({ id: 'other', serverThreadId: 'thread-other' }),
    ];
    const match = resolveOpenTarget(sessions, 'thread-xyz');
    expect(match).not.toBeNull();
    expect(match!.id).toBe('local-abc');       // select the LOCAL id, not the thread id
    expect(match!.title).toBe('Real chat');
  });

  // B. request arrives before hydration (empty), resolves after the session lands.
  it('returns null before the session is present, then matches after hydration', () => {
    const want = 'thread-xyz';
    expect(resolveOpenTarget([], want)).toBeNull();               // still hydrating
    const hydrated = [chat({ id: 'thread-xyz', serverThreadId: 'thread-xyz' })]; // server-only copy
    expect(resolveOpenTarget(hydrated, want)!.id).toBe('thread-xyz');
  });

  // C. a genuinely missing thread resolves to null (caller must NOT mint a chat).
  it('returns null for a missing thread', () => {
    const sessions = [chat({ id: 'local-1', serverThreadId: 'thread-1' })];
    expect(resolveOpenTarget(sessions, 'thread-404')).toBeNull();
  });

  // D. normal local sidebar selection (by local id) still works.
  it('matches by local id for ordinary sidebar selection', () => {
    const sessions = [chat({ id: 'local-1' }), chat({ id: 'local-2', serverThreadId: 't2' })];
    expect(resolveOpenTarget(sessions, 'local-1')!.id).toBe('local-1');
    expect(resolveOpenTarget(sessions, 'local-2')!.id).toBe('local-2');
  });

  it('empty request id resolves to null', () => {
    expect(resolveOpenTarget([chat()], '')).toBeNull();
  });

  it('prefers an exact local-id match and never returns the wrong session', () => {
    // A chat whose local id equals another chat's server thread id must not
    // cross-match: id match and serverThreadId match both point at real rows.
    const sessions = [
      chat({ id: 'shared', serverThreadId: 'ts-1' }),
      chat({ id: 'local-2', serverThreadId: 'shared' }),
    ];
    // Requesting "shared" finds the first (id === 'shared').
    expect(resolveOpenTarget(sessions, 'shared')!.id).toBe('shared');
  });
});
