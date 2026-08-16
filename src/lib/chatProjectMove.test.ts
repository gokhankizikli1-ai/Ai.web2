import { describe, it, expect, vi } from 'vitest';
import type { ChatSession } from '@/types';
import type { BindingResult } from '@/lib/projectApi';
import {
  CHAT_DRAG_MIME,
  canMoveChatToProject,
  moveChatToProject,
  pruneConfirmedMoves,
  type MoveDeps,
} from '@/lib/chatProjectMove';
import { buildSidebarGroups } from '@/lib/sidebarGroups';

/* ── fixtures ───────────────────────────────────────────────────────────── */

function session(over: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'loc-1',
    title: 'Competitor teardown',
    messages: [],
    updatedAt: new Date('2026-02-11T09:00:00Z'),
    mode: 'chat',
    ...over,
  };
}

const PROJECTS = [{ id: 'p-alpha', name: 'Alpha' }, { id: 'p-beta', name: 'Beta' }];

/** Records what the orchestrator did, so optimistic/rollback order is assertable. */
function deps(bindResult: BindingResult | Error) {
  const applied: [string, string][] = [];
  const rolledBack: string[] = [];
  const bound: { session: ChatSession; projectId: string }[] = [];
  const onChanged = vi.fn();
  const d: MoveDeps = {
    bind: async (s, pid) => {
      bound.push({ session: s, projectId: pid });
      if (bindResult instanceof Error) throw bindResult;
      return bindResult;
    },
    applyOptimistic: (sid, pid) => { applied.push([sid, pid]); },
    rollbackOptimistic: (sid) => { rolledBack.push(sid); },
    onChanged,
  };
  return { d, applied, rolledBack, bound, onChanged };
}

const okBind = (projectId: string, movedFrom: string | null = null): BindingResult =>
  ({ ok: true, status: 200, projectId, movedFrom });

/* ── drag payload ───────────────────────────────────────────────────────── */

describe('drag payload', () => {
  it('uses a private mime type so foreign drags are never mistaken for chats', () => {
    expect(CHAT_DRAG_MIME).toBe('application/x-korvix-chat');
  });
});

/* ── drop eligibility (the drag-over affordance) ────────────────────────── */

describe('canMoveChatToProject', () => {
  const ctx = { projectChats: { 'p-alpha': [{ id: 't-1', title: 'x', updated_at: null }] } };

  it('accepts a standalone chat onto a project', () => {
    expect(canMoveChatToProject(session({ serverThreadId: 't-9' }), 'p-alpha', ctx)).toBe(true);
  });

  it('accepts a chat that has never been synced (no serverThreadId yet)', () => {
    expect(canMoveChatToProject(session(), 'p-alpha', ctx)).toBe(true);
  });

  it('refuses the project the chat is ALREADY filed under (matched by thread id)', () => {
    expect(canMoveChatToProject(session({ serverThreadId: 't-1' }), 'p-alpha', ctx)).toBe(false);
  });

  it('refuses when membership is matched by the LOCAL id instead', () => {
    // A hydrated server chat can carry the thread id as its local id.
    expect(canMoveChatToProject(session({ id: 't-1' }), 'p-alpha', ctx)).toBe(false);
  });

  it('refuses when an in-flight binding already targets that project', () => {
    const pending = { projectChats: {}, pendingBindings: { 'loc-1': 'p-beta' } };
    expect(canMoveChatToProject(session(), 'p-beta', pending)).toBe(false);
    expect(canMoveChatToProject(session(), 'p-alpha', pending)).toBe(true);
  });

  it('refuses non-chat sessions (a Web Build run is not project-bindable here)', () => {
    expect(canMoveChatToProject(session({ mode: 'web_build' }), 'p-alpha', ctx)).toBe(false);
  });

  it('refuses a missing session or a missing target', () => {
    expect(canMoveChatToProject(null, 'p-alpha', ctx)).toBe(false);
    expect(canMoveChatToProject(session(), '', ctx)).toBe(false);
    expect(canMoveChatToProject(session(), null, ctx)).toBe(false);
  });
});

/* ── the move itself ────────────────────────────────────────────────────── */

describe('moveChatToProject', () => {
  const ctx = { projectChats: {} as Record<string, never[]> };

  it('applies the optimistic grouping BEFORE the server call, then confirms it', async () => {
    const { d, applied, rolledBack, onChanged } = deps(okBind('p-alpha'));
    const res = await moveChatToProject(session(), 'p-alpha', ctx, d);

    expect(applied).toEqual([['loc-1', 'p-alpha']]);
    expect(rolledBack).toEqual([]);           // nothing to undo on success
    expect(onChanged).toHaveBeenCalledTimes(1); // re-read backend truth
    expect(res).toMatchObject({ ok: true, outcome: 'moved', projectId: 'p-alpha' });
  });

  it('calls the AUTHORITATIVE binder with the real session (never a new chat)', async () => {
    const s = session({ id: 'loc-7', serverThreadId: 't-7' });
    const { d, bound } = deps(okBind('p-alpha'));
    await moveChatToProject(s, 'p-alpha', ctx, d);

    expect(bound).toHaveLength(1);
    // Same object identity: the EXISTING conversation is bound, not a fresh one.
    expect(bound[0].session).toBe(s);
    expect(bound[0].session.id).toBe('loc-7');
    expect(bound[0].session.serverThreadId).toBe('t-7');
    expect(bound[0].projectId).toBe('p-alpha');
  });

  it('reports the project the server detached the chat from (A → B move)', async () => {
    const { d } = deps(okBind('p-beta', 'p-alpha'));
    const res = await moveChatToProject(session({ serverThreadId: 't-1' }), 'p-beta', ctx, d);
    expect(res).toMatchObject({ ok: true, movedFrom: 'p-alpha', projectId: 'p-beta' });
  });

  it('trusts the SERVER\'s project id over the requested one', async () => {
    const { d } = deps(okBind('p-server-says'));
    const res = await moveChatToProject(session(), 'p-alpha', ctx, d);
    expect(res.projectId).toBe('p-server-says');
  });

  /* ── rollback ── */

  it('ROLLS BACK the optimistic grouping when the server fails', async () => {
    const { d, applied, rolledBack, onChanged } = deps({ ok: false, status: 500, projectId: null });
    const res = await moveChatToProject(session(), 'p-alpha', ctx, d);

    expect(applied).toEqual([['loc-1', 'p-alpha']]);
    expect(rolledBack).toEqual(['loc-1']);
    expect(onChanged).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, outcome: 'failed', projectId: null, status: 500 });
  });

  it('ROLLS BACK and reports "forbidden" on a 404 (thread or project not owned)', async () => {
    const { d, rolledBack } = deps({ ok: false, status: 404, projectId: null });
    const res = await moveChatToProject(session(), 'p-alpha', ctx, d);
    expect(rolledBack).toEqual(['loc-1']);
    expect(res.outcome).toBe('forbidden');
  });

  it('ROLLS BACK when the binding call throws (offline / unexpected error)', async () => {
    const { d, rolledBack } = deps(new Error('network down'));
    const res = await moveChatToProject(session(), 'p-alpha', ctx, d);
    expect(rolledBack).toEqual(['loc-1']);
    expect(res).toMatchObject({ ok: false, outcome: 'failed' });
  });

  /* ── no-ops never touch state ── */

  it('is a no-op — no optimistic write, no server call — when already there', async () => {
    const here = { projectChats: { 'p-alpha': [{ id: 't-1', title: 'x', updated_at: null }] } };
    const { d, applied, bound } = deps(okBind('p-alpha'));
    const res = await moveChatToProject(session({ serverThreadId: 't-1' }), 'p-alpha', here, d);

    expect(res.outcome).toBe('already-there');
    expect(applied).toEqual([]);
    expect(bound).toEqual([]);
  });

  it('is a no-op for a non-chat session or a missing target', async () => {
    const { d, applied, bound } = deps(okBind('p-alpha'));
    expect((await moveChatToProject(session({ mode: 'web_build' }), 'p-alpha', ctx, d)).outcome)
      .toBe('not-movable');
    expect((await moveChatToProject(session(), '', ctx, d)).outcome).toBe('not-movable');
    expect(applied).toEqual([]);
    expect(bound).toEqual([]);
  });
});

/* ── the visible result: Recent → project, exactly once ─────────────────── */

describe('grouping after a move', () => {
  const chat = session({ id: 'loc-1', serverThreadId: 't-1' });
  const other = session({ id: 'loc-2', serverThreadId: 't-2', title: 'Draft investor update' });

  const build = (pending: Record<string, string>, projectChats: Record<string, { id: string; title: string; updated_at: string | null }[]> = {}) =>
    buildSidebarGroups({
      sessions: [chat, other],
      projects: PROJECTS,
      projectChats,
      pendingBindings: pending,
    });

  it('starts with both chats in Recent and no project chats', () => {
    const g = build({});
    expect(g.recents.map((s) => s.id)).toEqual(['loc-1', 'loc-2']);
    expect(g.projectChatCount).toBe(0);
  });

  it('moves the chat OUT of Recent and INTO the project on the optimistic write', () => {
    const g = build({ 'loc-1': 'p-alpha' });
    expect(g.recents.map((s) => s.id)).toEqual(['loc-2']);        // left Recent
    const alpha = g.projects.find((p) => p.projectId === 'p-alpha')!;
    expect(alpha.chats.map((c) => c.sessionId)).toEqual(['loc-1']); // arrived, once
  });

  it('shows the chat EXACTLY ONCE once the backend also reports it (no duplicate)', () => {
    // The window where both the optimistic entry and server truth exist.
    const g = build(
      { 'loc-1': 'p-alpha' },
      { 'p-alpha': [{ id: 't-1', title: 'Competitor teardown', updated_at: null }] },
    );
    const alpha = g.projects.find((p) => p.projectId === 'p-alpha')!;
    expect(alpha.chats).toHaveLength(1);
    expect(g.projectChatCount).toBe(1);
    expect(g.recents.map((s) => s.id)).toEqual(['loc-2']);
  });

  it('resolves the moved chat to its LOCAL session id, so opening it is not a blank chat', () => {
    const g = build(
      {},
      { 'p-alpha': [{ id: 't-1', title: 'Competitor teardown', updated_at: null }] },
    );
    const row = g.projects.find((p) => p.projectId === 'p-alpha')!.chats[0];
    expect(row.sessionId).toBe('loc-1');  // the real local session
    expect(row.threadId).toBe('t-1');     // and the server identity it binds by
  });

  it('never lands the chat in a project it was not moved to', () => {
    const g = build({ 'loc-1': 'p-alpha' });
    expect(g.projects.find((p) => p.projectId === 'p-beta')!.chats).toEqual([]);
  });

  it('a collapsed group still owns its chats — they are not returned to Recent', () => {
    // Collapse is purely presentational (see sidebarNav.isProjectGroupExpanded);
    // grouping does not change, so a collapsed project never leaks chats back.
    const g = build({ 'loc-1': 'p-alpha' });
    expect(g.projects.find((p) => p.projectId === 'p-alpha')!.chats).toHaveLength(1);
    expect(g.recents.some((s) => s.id === 'loc-1')).toBe(false);
  });
});

/* ── optimistic bookkeeping ─────────────────────────────────────────────── */

describe('pruneConfirmedMoves', () => {
  const chat = session({ id: 'loc-1', serverThreadId: 't-1' });

  it('drops an entry the backend has confirmed (server truth takes over)', () => {
    const out = pruneConfirmedMoves(
      { 'loc-1': 'p-alpha' },
      [chat],
      { 'p-alpha': [{ id: 't-1', title: 'x', updated_at: null }] },
    );
    expect(out).toEqual({});
  });

  it('matches confirmation by LOCAL id too, not only by thread id', () => {
    const local = session({ id: 't-1' }); // hydrated chat keyed by its thread id
    const out = pruneConfirmedMoves(
      { 't-1': 'p-alpha' },
      [local],
      { 'p-alpha': [{ id: 't-1', title: 'x', updated_at: null }] },
    );
    expect(out).toEqual({});
  });

  it('KEEPS an entry the backend has not caught up with (prevents a flicker back to Recent)', () => {
    const out = pruneConfirmedMoves({ 'loc-1': 'p-alpha' }, [chat], {});
    expect(out).toEqual({ 'loc-1': 'p-alpha' });
  });

  it('keeps an entry when the backend reports a DIFFERENT project', () => {
    const out = pruneConfirmedMoves(
      { 'loc-1': 'p-beta' },
      [chat],
      { 'p-alpha': [{ id: 't-1', title: 'x', updated_at: null }] },
    );
    expect(out).toEqual({ 'loc-1': 'p-beta' });
  });

  it('drops entries for sessions that no longer exist', () => {
    expect(pruneConfirmedMoves({ 'gone': 'p-alpha' }, [chat], {})).toEqual({});
  });

  it('returns the SAME object when nothing changed (stable identity for memoization)', () => {
    const input = { 'loc-1': 'p-alpha' };
    expect(pruneConfirmedMoves(input, [chat], {})).toBe(input);
    const empty = {};
    expect(pruneConfirmedMoves(empty, [chat], {})).toBe(empty);
  });
});
