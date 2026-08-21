import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * INLINE "ASK KORVIX" — proved to be the EXISTING chat, in a different place.
 *
 * The point of this feature is that it is not a new one. So the assertions here
 * are almost entirely about which authorities get called:
 *
 *   the conversation   created through the sessions authority, filed under the
 *                      project through the ownership-checked binding route, and
 *                      REUSED on the next question rather than duplicated;
 *   the AI path        exactly one POST, to `/v2/chat/stream`, carrying
 *                      `project_id` so the BACKEND injects Project Context —
 *                      no second endpoint, no prompt built here;
 *   the turns          both halves appended through the sessions authority with
 *                      stable idempotency keys, so the exchange is a real chat
 *                      the user can open in Chat;
 *   the failures       cancel, network death, an error frame and an empty
 *                      stream each leave recoverable state and never a
 *                      duplicated question.
 *
 * Every dependency is mocked. Nothing here reaches a network or a model.
 */

type Turn = { role: 'user' | 'assistant'; content: string };
type Appended = { role: 'user' | 'assistant'; content: string; clientMessageId: string };
type Binding = { ok: boolean; status: number; projectId: string | null };
type Chat = Record<string, unknown>;

const sessions = vi.hoisted(() => ({
  serverChatEnabled: vi.fn<() => boolean>(() => true),
  createChatThread:
    vi.fn<(title: string, metadata?: Record<string, unknown>) => Promise<string | null>>(
      async () => 'th-new'),
  appendThreadMessage:
    vi.fn<(threadId: string, message: Appended) => Promise<boolean>>(async () => true),
  listThreadMessages:
    vi.fn<(threadId: string, limit?: number) => Promise<Turn[]>>(async () => []),
}));

const projects = vi.hoisted(() => ({
  bindThreadToProject:
    vi.fn<(threadId: string, projectId: string) => Promise<Binding>>(
      async () => ({ ok: true, status: 200, projectId: 'p1' })),
  listProjectChats: vi.fn<(projectId: string) => Promise<Chat[]>>(async () => []),
}));

vi.mock('@/lib/sessionsSync', () => sessions);
vi.mock('@/lib/projectApi', () => projects);
vi.mock('@/lib/locale', () => ({
  getRequestLocale: () => ({ locale: 'en', language_mode: 'auto' }),
}));
vi.mock('@/lib/chatStream', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chatStream')>('@/lib/chatStream');
  return {
    ...actual,
    chatStreamUrl: () => 'https://api.test/v2/chat/stream',
    authHeaders: () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }),
  };
});

import { askInWorkspace, resolveAskThread, ASK_ORIGIN } from '@/lib/inlineAsk';

/** A fetch Response whose body streams the given SSE text as one chunk. */
function sseResponse(frames: string, ok = true): Response {
  const bytes = new TextEncoder().encode(frames);
  let sent = false;
  return {
    ok,
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true, value: undefined }
                                : ((sent = true), { done: false, value: bytes })),
        releaseLock: () => {},
      }),
    },
  } as unknown as Response;
}

const TOKENS = (...parts: string[]) =>
  parts.map((p) => `event: token\ndata: ${JSON.stringify({ delta: p })}\n\n`).join('')
  + 'event: done\ndata: {"finish_reason":"stop"}\n\n';

function collect() {
  const out = {
    tokens: [] as string[], done: [] as string[],
    errors: [] as string[], threads: [] as string[],
  };
  return {
    out,
    cb: {
      onThread: (id: string) => out.threads.push(id),
      onToken: (t: string) => out.tokens.push(t),
      onDone: (t: string) => out.done.push(t),
      onError: (c: string) => out.errors.push(c),
    },
  };
}

/** Let the async body of `askInWorkspace` run to completion. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  sessions.serverChatEnabled.mockReturnValue(true);
  sessions.createChatThread.mockResolvedValue('th-new');
  sessions.appendThreadMessage.mockResolvedValue(true);
  sessions.listThreadMessages.mockResolvedValue([]);
  projects.bindThreadToProject.mockResolvedValue({ ok: true, status: 200, projectId: 'p1' });
  projects.listProjectChats.mockResolvedValue([]);
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse(TOKENS('Hel', 'lo'))));
});

// ══════════════════════════════════════════════════════════════════════════
// The happy path, and WHICH authorities it goes through
// ══════════════════════════════════════════════════════════════════════════

describe('askInWorkspace — one exchange, existing authorities only', () => {
  it('streams the answer and reports it complete', async () => {
    const { out, cb } = collect();
    askInWorkspace('p1', 'What changed?', cb);
    await settle();
    expect(out.errors).toEqual([]);
    expect(out.tokens).toEqual(['Hel', 'Hello']);
    expect(out.done).toEqual(['Hello']);
  });

  it('creates the conversation through the sessions authority and FILES it', async () => {
    const { cb } = collect();
    askInWorkspace('p1', 'What changed?', cb);
    await settle();
    expect(sessions.createChatThread).toHaveBeenCalledTimes(1);
    // Marked on the sessions authority so it can be recognised later — no
    // second index of "which chat is the workspace's".
    expect(sessions.createChatThread.mock.calls[0][1])
      .toMatchObject({ origin: ASK_ORIGIN, project_id: 'p1' });
    // Filed through the ownership-checked binding route, not a local flag.
    expect(projects.bindThreadToProject).toHaveBeenCalledWith('th-new', 'p1');
  });

  it('posts EXACTLY ONE request, to the existing streaming endpoint', async () => {
    const { cb } = collect();
    askInWorkspace('p1', 'What changed?', cb);
    await settle();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/v2/chat/stream');
  });

  it('sends project_id so the BACKEND builds the project context', async () => {
    const { cb } = collect();
    askInWorkspace('p1', 'What changed?', cb);
    await settle();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.project_id).toBe('p1');
    // No system prompt, no context block, no memory — the frontend assembles
    // none of it. If this ever grows a `system` message, a second prompt
    // builder has been born.
    expect(Object.keys(body).sort())
      .toEqual(['language_mode', 'locale', 'messages', 'project_id']);
    expect(body.messages).toEqual([{ role: 'user', content: 'What changed?' }]);
  });

  it('carries the authenticated identity', async () => {
    const { cb } = collect();
    askInWorkspace('p1', 'What changed?', cb);
    await settle();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('persists BOTH turns, so the exchange is a real conversation', async () => {
    const { cb } = collect();
    askInWorkspace('p1', 'What changed?', cb);
    await settle();
    const roles = sessions.appendThreadMessage.mock.calls.map((c) => c[1].role);
    expect(roles).toEqual(['user', 'assistant']);
    const ids = sessions.appendThreadMessage.mock.calls.map((c) => c[1].clientMessageId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('reports the thread as soon as it exists, so "Open in chat" can appear', async () => {
    const { out, cb } = collect();
    const handle = askInWorkspace('p1', 'What changed?', cb);
    await settle();
    expect(out.threads).toEqual(['th-new']);
    expect(handle.threadId).toBe('th-new');
  });

  it('sends the conversation history so a follow-up is a follow-up', async () => {
    sessions.listThreadMessages.mockResolvedValue([
      { role: 'user', content: 'first' }, { role: 'assistant', content: 'answer' },
    ]);
    const { cb } = collect();
    askInWorkspace('p1', 'and now?', cb, { threadId: 'th-1' });
    await settle();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'and now?' },
    ]);
  });

  it('scrubs internal orchestration markers out of the answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(TOKENS('Here: ', 'TOOL OUTPUT', ' done'))));
    const { out, cb } = collect();
    askInWorkspace('p1', 'q', cb);
    await settle();
    expect(out.done[0]).toBe('Here:  done');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Reusing the project's conversation
// ══════════════════════════════════════════════════════════════════════════

describe('the project keeps ONE inline-Ask conversation', () => {
  it('reuses the existing one instead of creating another', async () => {
    projects.listProjectChats.mockResolvedValue([
      { id: 'th-old', title: 'x', mode: 'chat', updated_at: '2026-01-01T00:00:00Z',
        metadata: { origin: ASK_ORIGIN } },
    ]);
    const { cb } = collect();
    askInWorkspace('p1', 'q', cb);
    await settle();
    expect(sessions.createChatThread).not.toHaveBeenCalled();
    expect(sessions.appendThreadMessage.mock.calls[0][0]).toBe('th-old');
  });

  it('picks the newest when there is more than one', async () => {
    projects.listProjectChats.mockResolvedValue([
      { id: 'th-a', mode: 'chat', updated_at: '2026-01-01T00:00:00Z',
        metadata: { origin: ASK_ORIGIN } },
      { id: 'th-b', mode: 'chat', updated_at: '2026-05-01T00:00:00Z',
        metadata: { origin: ASK_ORIGIN } },
    ]);
    expect(await resolveAskThread('p1')).toBe('th-b');
  });

  it('never adopts an ordinary chat the user was already having', async () => {
    projects.listProjectChats.mockResolvedValue([
      { id: 'th-user', mode: 'chat', updated_at: '2026-05-01T00:00:00Z', metadata: {} },
    ]);
    expect(await resolveAskThread('p1')).toBeNull();
  });

  it('never adopts a build/tool thread', async () => {
    projects.listProjectChats.mockResolvedValue([
      { id: 'th-build', mode: 'web_build', updated_at: '2026-05-01T00:00:00Z',
        metadata: { origin: ASK_ORIGIN } },
    ]);
    expect(await resolveAskThread('p1')).toBeNull();
  });

  it('resolves nothing when the project has no chats the caller can see', async () => {
    // A foreign or missing project answers 404 at the route; the client sees an
    // empty list and creates its own thread rather than guessing an id.
    expect(await resolveAskThread('p-foreign')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Project isolation
// ══════════════════════════════════════════════════════════════════════════

describe('project isolation', () => {
  it('a question asked from project A can only bind to project A', async () => {
    const { cb } = collect();
    askInWorkspace('pA', 'q', cb);
    await settle();
    expect(projects.bindThreadToProject).toHaveBeenCalledWith('th-new', 'pA');
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.project_id).toBe('pA');
  });

  it('refuses to ask at all when the conversation cannot be filed', async () => {
    // A 404 from the binding route means the caller does not own the project.
    // Asking anyway would produce an answer with no project context, filed
    // nowhere — a worse outcome than a truthful failure.
    projects.bindThreadToProject.mockResolvedValue({ ok: false, status: 404, projectId: null });
    const { out, cb } = collect();
    askInWorkspace('pA', 'q', cb);
    await settle();
    expect(out.errors).toEqual(['thread']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses when the conversation cannot be created', async () => {
    sessions.createChatThread.mockResolvedValue(null);
    const { out, cb } = collect();
    askInWorkspace('p1', 'q', cb);
    await settle();
    expect(out.errors).toEqual(['thread']);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Failure, retry, cancel
// ══════════════════════════════════════════════════════════════════════════

describe('failure leaves recoverable state', () => {
  it('a guest is told, and nothing is sent', async () => {
    sessions.serverChatEnabled.mockReturnValue(false);
    const { out, cb } = collect();
    askInWorkspace('p1', 'q', cb);
    await settle();
    expect(out.errors).toEqual(['unavailable']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('an empty question is refused without touching anything', async () => {
    const { out, cb } = collect();
    askInWorkspace('p1', '   ', cb);
    await settle();
    expect(out.errors).toEqual(['empty']);
    expect(sessions.createChatThread).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a dead connection reports `network`, and the question is already saved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { out, cb } = collect();
    askInWorkspace('p1', 'q', cb);
    await settle();
    expect(out.errors).toEqual(['network']);
    // The user's turn was persisted BEFORE the request, so the question is not
    // silently lost — it is in the conversation, answerable later.
    const roles = sessions.appendThreadMessage.mock.calls.map((c) => c[1].role);
    expect(roles).toEqual(['user']);
  });

  it('an HTTP failure reports `stream` and writes no assistant turn', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse('', false)));
    const { out, cb } = collect();
    askInWorkspace('p1', 'q', cb);
    await settle();
    expect(out.errors).toEqual(['stream']);
    const roles = sessions.appendThreadMessage.mock.calls.map((c) => c[1].role);
    expect(roles).toEqual(['user']);
  });

  it('an error frame mid-stream reports `stream`, never a half answer as done', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(
      'event: token\ndata: {"delta":"partial"}\n\n'
      + 'event: error\ndata: {"code":"PROVIDER_AUTH"}\n\n')));
    const { out, cb } = collect();
    askInWorkspace('p1', 'q', cb);
    await settle();
    expect(out.errors).toEqual(['stream']);
    expect(out.done).toEqual([]);
  });

  it('a stream that completes with nothing says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(
      'event: done\ndata: {"finish_reason":"stop"}\n\n')));
    const { out, cb } = collect();
    askInWorkspace('p1', 'q', cb);
    await settle();
    expect(out.errors).toEqual(['empty']);
  });

  it('a RETRY reuses the question key, so the question is not written twice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const first = collect();
    const handle = askInWorkspace('p1', 'q', first.cb);
    await settle();
    expect(first.out.errors).toEqual(['network']);

    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(TOKENS('ok'))));
    const second = collect();
    askInWorkspace('p1', 'q', second.cb, {
      threadId: handle.threadId ?? undefined,
      questionMessageId: handle.questionMessageId,
    });
    await settle();
    expect(second.out.done).toEqual(['ok']);

    const userPosts = sessions.appendThreadMessage.mock.calls
      .filter((c) => c[1].role === 'user');
    expect(userPosts).toHaveLength(2);
    // Same idempotency key ⇒ the sessions store collapses them to one row.
    expect(userPosts[0][1].clientMessageId)
      .toBe(userPosts[1][1].clientMessageId);
  });

  it('a retry does not send the question twice in one prompt', async () => {
    // The thread now already holds the question from the failed attempt.
    sessions.listThreadMessages.mockResolvedValue([{ role: 'user', content: 'q' }]);
    const { cb } = collect();
    askInWorkspace('p1', 'q', cb, { threadId: 'th-1', questionMessageId: 'k1' });
    await settle();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'q' }]);
  });
});

describe('stop, cancel and unmount', () => {
  it('cancelling before the request stops it reaching the AI path', async () => {
    const { out, cb } = collect();
    const handle = askInWorkspace('p1', 'q', cb);
    handle.cancel();
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(out.done).toEqual([]);
    expect(out.errors).toEqual([]);   // a cancel is not an error
  });

  it('STOP keeps the partial answer, and writes it to the conversation', async () => {
    // Otherwise the page would show an answer the conversation does not have,
    // and "Open in chat" would present a question with nothing under it.
    let handle: ReturnType<typeof askInWorkspace> | null = null;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(
      'event: token\ndata: {"delta":"half an ans"}\n\n'
      + 'event: token\ndata: {"delta":"wer"}\n\n')));
    const { out, cb } = collect();
    handle = askInWorkspace('p1', 'q', {
      ...cb,
      onToken: (text) => { cb.onToken(text); handle?.stop(); },
    });
    await settle();
    expect(out.done).toEqual(['half an ans']);
    const written = sessions.appendThreadMessage.mock.calls.map((c) => c[1]);
    expect(written.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(written[1].content).toBe('half an ans');
    expect(out.errors).toEqual([]);
  });

  it('ABANDONING writes no fragment — only the question survives', async () => {
    let handle: ReturnType<typeof askInWorkspace> | null = null;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(
      'event: token\ndata: {"delta":"half"}\n\n'
      + 'event: token\ndata: {"delta":" more"}\n\n')));
    const { out, cb } = collect();
    handle = askInWorkspace('p1', 'q', {
      ...cb,
      onToken: (text) => { cb.onToken(text); handle?.cancel(); },
    });
    await settle();
    expect(out.done).toEqual([]);
    expect(out.errors).toEqual([]);
    const roles = sessions.appendThreadMessage.mock.calls.map((c) => c[1].role);
    expect(roles).toEqual(['user']);
  });

  it('stopping before any token is not an error and writes nothing extra', async () => {
    const { out, cb } = collect();
    const handle = askInWorkspace('p1', 'q', cb);
    handle.stop();
    await settle();
    expect(out.errors).toEqual([]);
    expect(out.done).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('an aborted request is never reported as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }));
    const { out, cb } = collect();
    const handle = askInWorkspace('p1', 'q', cb);
    await Promise.resolve();
    handle.cancel();
    await settle();
    expect(out.errors).toEqual([]);
    expect(out.done).toEqual([]);
  });

  it('passes an abort signal so the connection is really dropped', async () => {
    const { cb } = collect();
    askInWorkspace('p1', 'q', cb);
    await settle();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
