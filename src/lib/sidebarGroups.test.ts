import { describe, it, expect } from 'vitest';
import { buildSidebarGroups, projectOfSession, type ProjectChatRef } from './sidebarGroups';
import type { ChatSession } from '@/types';

function session(over: Partial<ChatSession> & { id: string }): ChatSession {
  return {
    title: `Chat ${over.id}`,
    messages: [],
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    folder: 'none',
    ...over,
  } as ChatSession;
}

const PROJECTS = [
  { id: 'p1', name: 'Project A' },
  { id: 'p2', name: 'Project B' },
];

function chatRef(id: string, over: Partial<ProjectChatRef> = {}): ProjectChatRef {
  return { id, title: `Server ${id}`, updated_at: '2026-01-01T00:00:00Z', ...over };
}

describe('buildSidebarGroups', () => {
  it('files a chat under its project by SERVER THREAD ID, not local id', () => {
    const s = session({ id: 'local-1', serverThreadId: 'thread-1', title: 'Roadmap' });
    const out = buildSidebarGroups({
      sessions: [s],
      projects: PROJECTS,
      projectChats: { p1: [chatRef('thread-1')], p2: [] },
    });
    expect(out.projects[0].chats).toHaveLength(1);
    // The LOCAL id is what the active session is keyed on — it must be carried.
    expect(out.projects[0].chats[0].sessionId).toBe('local-1');
    expect(out.projects[0].chats[0].threadId).toBe('thread-1');
    // Live local title wins over the server snapshot.
    expect(out.projects[0].chats[0].title).toBe('Roadmap');
    expect(out.recents).toHaveLength(0);
  });

  it('also matches a hydrated session whose local id IS the thread id', () => {
    const s = session({ id: 'thread-9', serverThreadId: 'thread-9' });
    const out = buildSidebarGroups({
      sessions: [s], projects: PROJECTS,
      projectChats: { p1: [chatRef('thread-9')] },
    });
    expect(out.projects[0].chats).toHaveLength(1);
    expect(out.projects[0].chats[0].sessionId).toBe('thread-9');
  });

  it('never duplicates a chat between its project group and Recent', () => {
    const bound = session({ id: 'a', serverThreadId: 't-a' });
    const loose = session({ id: 'b' });
    const out = buildSidebarGroups({
      sessions: [bound, loose], projects: PROJECTS,
      projectChats: { p1: [chatRef('t-a')] },
    });
    expect(out.projects[0].chats.map((c) => c.sessionId)).toEqual(['a']);
    expect(out.recents.map((s) => s.id)).toEqual(['b']);
    expect(out.projectChatCount).toBe(1);
  });

  it('never lists the same chat twice inside one project group', () => {
    // The backend list and the local session both describe the same chat.
    const s = session({ id: 'local-1', serverThreadId: 't-1' });
    const out = buildSidebarGroups({
      sessions: [s], projects: PROJECTS,
      projectChats: { p1: [chatRef('t-1'), chatRef('t-1')] },
    });
    expect(out.projects[0].chats).toHaveLength(1);
  });

  it('keeps a server-listed chat that is not in the local session set (openable by thread id)', () => {
    const out = buildSidebarGroups({
      sessions: [], projects: PROJECTS,
      projectChats: { p1: [chatRef('t-remote', { title: 'Only on server' })] },
    });
    expect(out.projects[0].chats[0]).toMatchObject({
      sessionId: null, threadId: 't-remote', title: 'Only on server',
    });
  });

  it('groups a pending (not-yet-synced) project chat optimistically', () => {
    const fresh = session({ id: 'new-1', title: 'New Chat' });
    const out = buildSidebarGroups({
      sessions: [fresh], projects: PROJECTS,
      projectChats: { p1: [], p2: [] },
      pendingBindings: { 'new-1': 'p2' },
    });
    expect(out.projects[1].chats.map((c) => c.sessionId)).toEqual(['new-1']);
    expect(out.recents).toHaveLength(0);
  });

  it('prefers the backend binding over a stale pending target', () => {
    const s = session({ id: 'a', serverThreadId: 't-a' });
    const out = buildSidebarGroups({
      sessions: [s], projects: PROJECTS,
      projectChats: { p1: [chatRef('t-a')] },
      pendingBindings: { a: 'p2' },
    });
    expect(out.projects[0].chats).toHaveLength(1);
    expect(out.projects[1].chats).toHaveLength(0);
  });

  it('drops a binding once the backend no longer reports it (unbind)', () => {
    const s = session({ id: 'a', serverThreadId: 't-a' });
    const after = buildSidebarGroups({
      sessions: [s], projects: PROJECTS, projectChats: { p1: [], p2: [] },
    });
    expect(after.projects[0].chats).toHaveLength(0);
    expect(after.recents.map((x) => x.id)).toEqual(['a']);
  });

  it('caps Recent but never truncates a project group', () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      session({ id: `s${i}`, serverThreadId: `t${i}` }));
    const out = buildSidebarGroups({
      sessions, projects: PROJECTS,
      projectChats: { p1: sessions.slice(0, 15).map((s) => chatRef(s.serverThreadId!)) },
      recentLimit: 3,
    });
    expect(out.projects[0].chats).toHaveLength(15);
    expect(out.recents).toHaveLength(3);
  });

  it('applies the search filter to project groups as well as Recent', () => {
    const a = session({ id: 'a', serverThreadId: 't-a', title: 'Pricing model' });
    const b = session({ id: 'b', serverThreadId: 't-b', title: 'Hiring plan' });
    const out = buildSidebarGroups({
      sessions: [a, b], projects: PROJECTS,
      projectChats: { p1: [chatRef('t-a'), chatRef('t-b')] },
      search: 'pricing',
    });
    expect(out.projects[0].chats.map((c) => c.title)).toEqual(['Pricing model']);
  });

  it('sorts project chats newest first', () => {
    const older = session({ id: 'o', serverThreadId: 't-o', updatedAt: new Date('2026-01-01T00:00:00Z') });
    const newer = session({ id: 'n', serverThreadId: 't-n', updatedAt: new Date('2026-06-01T00:00:00Z') });
    const out = buildSidebarGroups({
      sessions: [older, newer], projects: PROJECTS,
      projectChats: { p1: [chatRef('t-o'), chatRef('t-n')] },
    });
    expect(out.projects[0].chats.map((c) => c.sessionId)).toEqual(['n', 'o']);
  });

  it('carries web_build routing metadata so a bound build still reopens its build surface', () => {
    const s = session({ id: 'b1', serverThreadId: 't-b1', mode: 'web_build', webBuildRunId: 'run-1' });
    const out = buildSidebarGroups({
      sessions: [s], projects: PROJECTS, projectChats: { p1: [chatRef('t-b1')] },
    });
    expect(out.projects[0].chats[0]).toMatchObject({ mode: 'web_build', webBuildRunId: 'run-1' });
  });

  it('does not leak chats of one project into another', () => {
    const a = session({ id: 'a', serverThreadId: 't-a' });
    const b = session({ id: 'b', serverThreadId: 't-b' });
    const out = buildSidebarGroups({
      sessions: [a, b], projects: PROJECTS,
      projectChats: { p1: [chatRef('t-a')], p2: [chatRef('t-b')] },
    });
    expect(out.projects[0].chats.map((c) => c.sessionId)).toEqual(['a']);
    expect(out.projects[1].chats.map((c) => c.sessionId)).toEqual(['b']);
  });

  it('is a no-op shape when the user has no projects', () => {
    const out = buildSidebarGroups({
      sessions: [session({ id: 'a' })], projects: [], projectChats: {},
    });
    expect(out.projects).toEqual([]);
    expect(out.recents).toHaveLength(1);
  });
});

describe('projectOfSession', () => {
  it('resolves by thread id, local id, then pending target', () => {
    const s = session({ id: 'a', serverThreadId: 't-a' });
    expect(projectOfSession(s, { p1: [chatRef('t-a')] })).toBe('p1');
    expect(projectOfSession(session({ id: 't-b' }), { p2: [chatRef('t-b')] })).toBe('p2');
    expect(projectOfSession(session({ id: 'x' }), {}, { x: 'p9' })).toBe('p9');
    expect(projectOfSession(session({ id: 'y' }), {})).toBeNull();
  });
});
