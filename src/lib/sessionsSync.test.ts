/**
 * sessionsSync — server-authoritative chat client (Phase 3).
 *
 * Proves the sync contract against a mocked backend:
 *   • guests / disabled → no server calls (localStorage-only path preserved);
 *   • a conversation is mirrored to the server, creating the thread lazily;
 *   • mirroring is IDEMPOTENT — the server message count is the watermark, so a
 *     repeat/retry never duplicates a turn;
 *   • hydration restores server threads as ChatSessions, skipping Web/App Build
 *     threads and empty shells;
 *   • merge is additive — it never drops or overwrites a local conversation and
 *     dedupes on the server-thread binding.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ChatSession } from '@/types';

// ── Identity + token stubs (module mocks) ───────────────────────────────────
let scope = 'user_alice';
vi.mock('@/stores/authStore', () => ({
  getAccessToken: () => 'test-token',
}));
vi.mock('@/lib/storageScope', () => ({
  currentStorageScope: () => scope,
}));

import {
  serverChatEnabled,
  syncSession,
  hydrateFromServer,
  mergeServerSessions,
  resetSessionsSync,
} from './sessionsSync';

// ── A tiny in-memory fake of the /v2/sessions backend ───────────────────────
// Mirrors the server's per-thread idempotency: an append with a client_message_id
// that already exists (by client id OR by an existing row id) is a no-op.
interface FakeMsg { id: string; role: string; content: string; created_at: string; client_message_id: string | null }
interface FakeThread { id: string; title: string; mode: string; messages: FakeMsg[]; updated_at: string }

function makeBackend() {
  const threads = new Map<string, FakeThread>();
  let seq = 0;
  const nid = (p: string) => `${p}-${++seq}`;

  const handler = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || 'GET').toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });

    if (path === '/v2/sessions/workspaces/ensure_default' && method === 'POST') {
      return ok({ id: 'ws-1' });
    }
    let m = path.match(/^\/v2\/sessions\/workspaces\/([^/]+)\/threads$/);
    if (m && method === 'POST') {
      const id = nid('th');
      threads.set(id, { id, title: body.title, mode: body.mode || 'chat', messages: [], updated_at: '2024-01-01T00:00:00Z' });
      return ok({ id, title: body.title, mode: body.mode });
    }
    if (m && method === 'GET') {
      return ok({ threads: Array.from(threads.values()).map((t) => ({ id: t.id, title: t.title, mode: t.mode, updated_at: t.updated_at })) });
    }
    m = path.match(/^\/v2\/sessions\/threads\/([^/]+)\/messages$/);
    if (m && method === 'GET') {
      const t = threads.get(m[1]);
      return ok({ messages: t ? t.messages : [] });
    }
    if (m && method === 'POST') {
      const t = threads.get(m[1]);
      if (t) {
        const cid: string | null = body.client_message_id ?? null;
        const dup = cid !== null && t.messages.some((x) => x.client_message_id === cid || x.id === cid);
        if (!dup) {
          const id = nid('msg');
          t.messages.push({ id, role: body.role, content: body.content, created_at: '2024-01-01T00:00:01Z', client_message_id: cid });
          return ok({ id, client_message_id: cid });
        }
        const canon = t.messages.find((x) => x.client_message_id === cid || x.id === cid)!;
        return ok({ id: canon.id, client_message_id: canon.client_message_id });
      }
      return ok({ id: 'msg' });
    }
    return new Response(JSON.stringify({ success: false, error: 'not found' }), { status: 404 });
  };
  return { threads, handler };
}

function session(over: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 's1',
    title: 'My chat',
    messages: [
      { id: 'm1', role: 'user', content: 'hi', timestamp: new Date() },
      { id: 'm2', role: 'assistant', content: 'hello', timestamp: new Date() },
    ],
    updatedAt: new Date(),
    ...over,
  };
}

let backend: ReturnType<typeof makeBackend>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scope = 'user_alice';
  resetSessionsSync();
  backend = makeBackend();
  fetchMock = vi.fn((url: string, init?: RequestInit) => backend.handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('serverChatEnabled', () => {
  it('is true for an authenticated (user_) scope', () => {
    scope = 'user_alice';
    expect(serverChatEnabled()).toBe(true);
  });
  it('is false for a guest scope', () => {
    scope = 'guest_nonce';
    expect(serverChatEnabled()).toBe(false);
  });
});

describe('syncSession', () => {
  it('does nothing for guests', async () => {
    scope = 'guest_nonce';
    const res = await syncSession(session());
    expect(res).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a thread and mirrors both turns', async () => {
    const threadId = await syncSession(session());
    expect(threadId).toBeTruthy();
    const t = backend.threads.get(threadId as string)!;
    expect(t.messages.map((x) => [x.role, x.content])).toEqual([
      ['user', 'hi'], ['assistant', 'hello'],
    ]);
  });

  it('is idempotent — re-syncing the same session does not duplicate turns', async () => {
    const s = session();
    const threadId = await syncSession(s);
    // Re-sync with the now-known serverThreadId (as the hook would stash it).
    await syncSession({ ...s, serverThreadId: threadId as string });
    const t = backend.threads.get(threadId as string)!;
    expect(t.messages.length).toBe(2); // still exactly two — no amplification
  });

  it('appends only NEW turns on a subsequent sync', async () => {
    const s = session();
    const threadId = await syncSession(s);
    const grown: ChatSession = {
      ...s,
      serverThreadId: threadId as string,
      messages: [
        ...s.messages,
        { id: 'm3', role: 'user', content: 'again', timestamp: new Date() },
        { id: 'm4', role: 'assistant', content: 'sure', timestamp: new Date() },
      ],
    };
    await syncSession(grown);
    const t = backend.threads.get(threadId as string)!;
    expect(t.messages.length).toBe(4);
    expect(t.messages[3].content).toBe('sure');
  });

  it('two overlapping syncs of the same session do not duplicate turns', async () => {
    const s = session();
    // Fire both without awaiting the first — both create/mirror concurrently.
    const [t1, t2] = await Promise.all([syncSession(s), syncSession(s)]);
    // At least one produced a thread; both may create threads, but neither
    // thread ends up with duplicated turns (client-id dedup per thread).
    const ids = [t1, t2].filter(Boolean) as string[];
    for (const id of ids) {
      const t = backend.threads.get(id)!;
      const cids = t.messages.map((x) => x.client_message_id);
      expect(new Set(cids).size).toBe(cids.length); // no dupes within a thread
      expect(t.messages.length).toBeLessThanOrEqual(2);
    }
  });

  it('a partial-then-full retry appends only the new tail', async () => {
    const s = session();
    const threadId = (await syncSession(s)) as string;
    const grown: ChatSession = {
      ...s,
      serverThreadId: threadId,
      messages: [
        ...s.messages,
        { id: 'm3', role: 'user', content: 'again', timestamp: new Date() },
      ],
    };
    // Re-sync twice — the retry must not duplicate m1/m2/m3.
    await syncSession(grown);
    await syncSession(grown);
    const t = backend.threads.get(threadId)!;
    expect(t.messages.map((x) => x.content)).toEqual(['hi', 'hello', 'again']);
  });

  it('a >page-length history never replays or duplicates', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: `mm-${i}`, role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `t${i}`, timestamp: new Date(),
    }));
    const s = session({ messages: many });
    const threadId = (await syncSession(s)) as string;
    // Re-sync the WHOLE history again (as a fresh device with no watermark).
    await syncSession({ ...s, serverThreadId: threadId });
    const t = backend.threads.get(threadId)!;
    expect(t.messages.length).toBe(120); // exactly once each, no replay
  });

  it('never mirrors Web/App Build sessions', async () => {
    const res = await syncSession(session({ mode: 'web_build' }));
    expect(res).toBeNull();
    expect(backend.threads.size).toBe(0);
  });

  it('never mirrors game/app build modes (allowlist: only chat)', async () => {
    // Ordinary chat (mode undefined or "chat") is the ONLY mirrored kind.
    expect(await syncSession(session({ mode: 'game_build' }))).toBeNull();
    expect(backend.threads.size).toBe(0);
    const chat = await syncSession(session({ mode: 'chat' }));
    expect(chat).toBeTruthy();
  });
});

describe('hydrateFromServer + mergeServerSessions', () => {
  it('restores server threads as chat sessions', async () => {
    await syncSession(session());            // seed one thread on the server
    const restored = await hydrateFromServer();
    expect(restored.length).toBe(1);
    expect(restored[0].serverThreadId).toBeTruthy();
    expect(restored[0].messages.map((m) => m.content)).toEqual(['hi', 'hello']);
    expect(restored[0].mode).toBe('chat');
  });

  it('returns [] for guests', async () => {
    scope = 'guest_nonce';
    expect(await hydrateFromServer()).toEqual([]);
  });

  it('merge is additive and dedupes on serverThreadId', async () => {
    const threadId = (await syncSession(session())) as string;
    const server = await hydrateFromServer();
    // Local already has the same thread bound — merge must not duplicate it.
    const local: ChatSession[] = [session({ id: 'localA', serverThreadId: threadId })];
    const merged = mergeServerSessions(local, server);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe('localA'); // local kept, server deduped
  });

  it('merge appends server-only threads without dropping local ones', async () => {
    const threadId = (await syncSession(session())) as string;
    const server = await hydrateFromServer();
    const local: ChatSession[] = [session({ id: 'localOnly' })]; // no serverThreadId
    const merged = mergeServerSessions(local, server);
    expect(merged.map((s) => s.id).sort()).toEqual(['localOnly', threadId].sort());
  });
});
