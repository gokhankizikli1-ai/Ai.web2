/**
 * projectApi — backend-authoritative chat↔project + product linkage (Phase 2/3).
 *
 * Proves the client that drives the "Move to project" and "Save to project"
 * flows against a mocked backend that enforces ownership + idempotency, exactly
 * like the server:
 *   • assign a chat to a project (syncing the thread first when needed);
 *   • MOVE a chat A → B (server detaches + rebinds, reports moved_from);
 *   • remove a chat from its project;
 *   • error behaviour: a 404 (not owned / not found) surfaces as ok:false/404;
 *   • guests are a no-op (no server identity);
 *   • attach a Web/App product (buildType preserved, idempotent, ownership).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChatSession } from '@/types';

let scope = 'user_alice';
vi.mock('@/stores/authStore', () => ({ getAccessToken: () => 'tok' }));
vi.mock('@/lib/storageScope', () => ({ currentStorageScope: () => scope }));
// getProjects tells listAddableChats which owned project ids to check membership
// for; chat membership itself remains backend truth (listProjectChats).
vi.mock('@/stores/projectStore', () => ({
  getProjects: () => [{ id: 'pA', name: 'Alpha' }, { id: 'pB', name: 'Beta' }],
}));

import {
  assignChatToProject,
  removeChatFromProject,
  getThreadProject,
  attachProductToProject,
  bindThreadToProject,
  listProjectChats,
  listProjectProducts,
  getProjectBrainContext,
  getProjectWorkspace,
  listAddableChats,
} from './projectApi';

// Fake backend: threads with an optional project binding, per-project ownership,
// and a products store. `owner` is the acting user (from the mock scope).
function makeBackend() {
  const threads = new Map<string, { id: string; project: string | null; title: string }>();
  // project id -> owner user id
  const projectOwner = new Map<string, string>([
    ['pA', 'alice'], ['pB', 'alice'], ['pOther', 'bob'],
  ]);
  const products: Record<string, unknown>[] = [];
  let seq = 0;
  const uid = () => (scope.startsWith('user_') ? scope.slice('user_'.length) : 'guest');

  const handler = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method || 'GET').toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
    const notFound = () => new Response(JSON.stringify({ success: false, error: 'not found' }), { status: 404 });
    const ownsProject = (pid: string) => projectOwner.get(pid) === uid();

    if (path === '/v2/sessions/workspaces/ensure_default' && method === 'POST') return ok({ id: 'ws' });
    let m = path.match(/^\/v2\/sessions\/workspaces\/([^/]+)\/threads$/);
    if (m && method === 'POST') {
      const id = `th-${++seq}`;
      threads.set(id, { id, project: null, title: body.title || 'Chat' });
      return ok({ id });
    }
    // The user's default-workspace threads (the "all my chats" seam).
    if (m && method === 'GET') {
      return ok({
        threads: [...threads.values()].map((t) => ({
          id: t.id, title: t.title, mode: 'chat', updated_at: '2024-01-01T00:00:00Z',
        })),
      });
    }
    // Chats filed under a project (Project Overview → Chats).
    m = path.match(/^\/v2\/sessions\/projects\/([^/]+)\/threads$/);
    if (m && method === 'GET') {
      if (!ownsProject(m[1])) return notFound();
      const list = [...threads.values()].filter((t) => t.project === m![1]).map((t) => ({
        id: t.id, title: t.title, mode: 'chat', updated_at: '2024-01-01T00:00:00Z',
      }));
      return ok({ threads: list });
    }
    m = path.match(/^\/v2\/sessions\/threads\/([^/]+)\/messages$/);
    if (m && method === 'GET') return ok({ messages: [] });
    if (m && method === 'POST') return ok({ id: 'msg', client_message_id: body.client_message_id ?? null });
    m = path.match(/^\/v2\/sessions\/threads\/([^/]+)\/project$/);
    if (m) {
      const th = threads.get(m[1]);
      if (!th) return notFound();
      if (method === 'GET') return ok({ thread_id: th.id, project_id: th.project });
      if (method === 'PUT') {
        if (!ownsProject(body.project_id)) return notFound();
        const movedFrom = th.project && th.project !== body.project_id ? th.project : null;
        th.project = body.project_id;
        return ok({ thread_id: th.id, project_id: body.project_id, moved_from: movedFrom });
      }
      if (method === 'DELETE') {
        const removed = th.project;
        th.project = null;
        return ok({ thread_id: th.id, project_id: null, removed_from: removed });
      }
    }
    m = path.match(/^\/v2\/orchestrator\/projects\/([^/]+)\/products$/);
    if (m && method === 'POST') {
      if (!ownsProject(m[1])) return notFound();
      const id = `savedproduct:${m[1]}:${body.source_id}`;
      if (!products.some((p) => p.deliverable_id === id)) {
        products.push({ deliverable_id: id, build_type: body.build_type, title: body.title, project: m[1] });
      }
      return ok({ deliverable_id: id, build_type: body.build_type });
    }
    if (m && method === 'GET') {
      if (!ownsProject(m[1])) return notFound();
      return ok({ products: products.filter((p) => p.project === m![1]), executions: [] });
    }
    // Project Brain (deterministic aggregate — no model call).
    m = path.match(/^\/v2\/projects\/([^/]+)\/brain$/);
    if (m && method === 'GET') {
      if (!ownsProject(m[1])) return ok({ brain: null, empty: true });
      return ok({
        brain: {
          current_goals: ['Reach 100 users'],
          connector_signals: [{ source: 'github', kind: 'github.check.failed', summary: 'CI failed on main' }],
          counts: { products: 1 },
        },
        empty: false,
      });
    }
    // Project Workspace read model — the ONE read the Project page makes.
    // Ownership is server-enforced and a foreign/unknown project is 404
    // (existence-hidden), exactly like the real route.
    m = path.match(/^\/v2\/projects\/([^/]+)\/workspace$/);
    if (m && method === 'GET') {
      if (!ownsProject(m[1])) return notFound();
      return ok({
        project: { id: m[1], name: 'Alpha', description: 'Desc', created_at: '', updated_at: '' },
        summary: { text: 'A project.', source: 'brain' },
        goals: [{ id: 'g1', title: 'Reach 100 users', priority: 3, source: 'goals' }],
        attention: [{ id: 'a1', severity: 'blocking', reason: 'ci_failed', source: 'github',
                      kind: 'github.check.failed', title: 'CI failed on main', context: 'acme/site',
                      observed_at: '2026-06-01T10:00:00Z', ref: '' }],
        activity: [{ id: 'o1', source: 'github', kind: 'github.check.failed',
                     title: 'CI failed on main', occurred_at: '2026-06-01T10:00:00Z', ref: '' }],
        products: products.filter((p) => p.project === m![1]),
        chats: [{ thread_id: 't1', title: 'Chat', mode: 'chat', updated_at: '2026-06-01T09:00:00Z' }],
        connectors: [{ provider: 'github', label: 'GitHub', resource_kind: 'single',
                       resource_noun: 'repository', resources: ['acme/site'], resource_count: 1,
                       status: 'connected', last_sync_at: '2026-06-01T08:00:00Z' }],
        freshness: { generated_at: '2026-06-01T12:00:00Z', last_activity_at: '2026-06-01T10:00:00Z',
                     last_connector_sync_at: '2026-06-01T08:00:00Z',
                     last_observation_at: '2026-06-01T10:00:00Z', last_chat_at: '2026-06-01T09:00:00Z',
                     last_product_at: '' },
        counts: { attention: 1 },
      });
    }
    return notFound();
  };
  return { threads, products, handler };
}

let backend: ReturnType<typeof makeBackend>;

function session(over: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 's1', title: 'Chat',
    messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: new Date() }],
    updatedAt: new Date(), ...over,
  };
}

beforeEach(() => {
  scope = 'user_alice';
  backend = makeBackend();
  vi.stubGlobal('fetch', (u: string, i?: RequestInit) => backend.handler(u, i));
});
afterEach(() => vi.unstubAllGlobals());

describe('assignChatToProject', () => {
  it('syncs the thread then binds it to the project', async () => {
    const res = await assignChatToProject(session(), 'pA');
    expect(res.ok).toBe(true);
    expect(res.projectId).toBe('pA');
    // The thread was created and bound server-side.
    const th = [...backend.threads.values()][0];
    expect(th.project).toBe('pA');
  });

  it('moves a chat A → B and reports moved_from', async () => {
    const s = session();
    const first = await assignChatToProject(s, 'pA');
    // Reuse the same server thread for the move.
    const bound: ChatSession = { ...s, serverThreadId: [...backend.threads.keys()][0] };
    void first;
    const moved = await assignChatToProject(bound, 'pB');
    expect(moved.ok).toBe(true);
    expect(moved.projectId).toBe('pB');
    expect(moved.movedFrom).toBe('pA');
  });

  it('a project the user does not own is a 404 error', async () => {
    const res = await assignChatToProject(session(), 'pOther');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('guests are a no-op (no server identity)', async () => {
    scope = 'guest_x';
    const res = await assignChatToProject(session(), 'pA');
    expect(res.ok).toBe(false);
    expect(backend.threads.size).toBe(0);
  });
});

describe('removeChatFromProject', () => {
  it('removes the binding', async () => {
    const s = session();
    await assignChatToProject(s, 'pA');
    const bound: ChatSession = { ...s, serverThreadId: [...backend.threads.keys()][0] };
    const res = await removeChatFromProject(bound);
    expect(res.ok).toBe(true);
    expect([...backend.threads.values()][0].project).toBeNull();
  });

  it('a never-synced chat has nothing to remove', async () => {
    const res = await removeChatFromProject(session());
    expect(res.ok).toBe(true);
    expect(res.projectId).toBeNull();
  });
});

describe('getThreadProject', () => {
  it('returns the current binding', async () => {
    const s = session();
    await assignChatToProject(s, 'pA');
    const tid = [...backend.threads.keys()][0];
    expect(await getThreadProject(tid)).toBe('pA');
  });
});

describe('attachProductToProject', () => {
  it('attaches a web product and preserves build_type', async () => {
    const res = await attachProductToProject('pA', { buildType: 'web', title: 'Site', sourceId: 's1' });
    expect(res.ok).toBe(true);
    expect(res.deliverableId).toContain('savedproduct:pA:s1');
    expect(backend.products[0].build_type).toBe('web');
  });

  it('preserves app build_type', async () => {
    await attachProductToProject('pA', { buildType: 'app', title: 'App', sourceId: 'a1' });
    expect(backend.products.find((p) => p.title === 'App')!.build_type).toBe('app');
  });

  it('repeated save is idempotent (one product)', async () => {
    await attachProductToProject('pA', { buildType: 'web', title: 'Site', sourceId: 's1' });
    await attachProductToProject('pA', { buildType: 'web', title: 'Site', sourceId: 's1' });
    expect(backend.products.filter((p) => p.deliverable_id === 'savedproduct:pA:s1').length).toBe(1);
  });

  it('cannot attach to a project the user does not own', async () => {
    const res = await attachProductToProject('pOther', { buildType: 'web', sourceId: 'x' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(backend.products.length).toBe(0);
  });
});

describe('Project Overview reads', () => {
  it('listProjectChats returns chats filed under the project', async () => {
    const s = session();
    await assignChatToProject(s, 'pA');
    const chats = await listProjectChats('pA');
    expect(chats.length).toBe(1);
    expect(chats[0].id).toBe([...backend.threads.keys()][0]);
    expect(chats[0].title).toBeTruthy();
  });

  it('listProjectChats is empty for a project with no chats', async () => {
    expect(await listProjectChats('pB')).toEqual([]);
  });

  it('listProjectChats 404 for a foreign project → []', async () => {
    expect(await listProjectChats('pOther')).toEqual([]);
  });

  it('listProjectProducts returns saved products', async () => {
    await attachProductToProject('pA', { buildType: 'app', title: 'iOS', sourceId: 's9' });
    const products = await listProjectProducts('pA');
    expect(products.length).toBe(1);
    expect(products[0].build_type).toBe('app');
    expect(products[0].title).toBe('iOS');
  });

  it('listProjectProducts for a foreign project → []', async () => {
    await attachProductToProject('pA', { buildType: 'web', title: 'x', sourceId: 's1' });
    // acting as owner works; a non-owner sees []
    scope = 'user_bob';
    expect(await listProjectProducts('pA')).toEqual([]);
  });

  it('getProjectBrainContext returns a bounded snapshot for the owner', async () => {
    const brain = await getProjectBrainContext('pA');
    expect(brain).not.toBeNull();
    expect(brain!.current_goals).toContain('Reach 100 users');
    expect(brain!.connector_signals!.length).toBe(1);
  });

  it('getProjectBrainContext returns null for a foreign/empty project', async () => {
    expect(await getProjectBrainContext('pOther')).toBeNull();
  });
});

describe('getProjectWorkspace (the Project page read model)', () => {
  it('returns the bounded snapshot for the owner', async () => {
    const res = await getProjectWorkspace('pA');
    expect(res.notFound).toBe(false);
    expect(res.workspace).not.toBeNull();
    expect(res.workspace!.project.id).toBe('pA');
    expect(res.workspace!.attention[0].reason).toBe('ci_failed');
    expect(res.workspace!.goals[0].title).toBe('Reach 100 users');
    expect(res.workspace!.connectors[0].resources).toEqual(['acme/site']);
  });

  it("a project the caller does not own is existence-hidden (404), not an error", async () => {
    const res = await getProjectWorkspace('pOther');
    expect(res.workspace).toBeNull();
    expect(res.status).toBe(404);
    expect(res.notFound).toBe(true);
  });

  it('an unknown project id answers identically to a foreign one', async () => {
    const unknown = await getProjectWorkspace('does-not-exist');
    const foreign = await getProjectWorkspace('pOther');
    expect(unknown.status).toBe(foreign.status);
    expect(unknown.notFound).toBe(foreign.notFound);
  });

  it('the same project id read as another user leaks nothing', async () => {
    expect((await getProjectWorkspace('pA')).workspace).not.toBeNull();
    scope = 'user_bob';
    const res = await getProjectWorkspace('pA');
    expect(res.workspace).toBeNull();
    expect(res.notFound).toBe(true);
  });

  it('a transport failure is reported as retryable, NOT as "not found"', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const res = await getProjectWorkspace('pA');
    expect(res.workspace).toBeNull();
    expect(res.status).toBe(0);
    expect(res.notFound).toBe(false);
  });
});

describe('bindThreadToProject (deferred new-chat binding)', () => {
  it('binds an already-synced thread to a project', async () => {
    // Simulate a freshly-created server thread.
    const s = session();
    const threadId = (await assignChatToProject(s, 'pA')).projectId ? [...backend.threads.keys()][0] : '';
    // Now bind that same thread to pB directly (the lifecycle path).
    const res = await bindThreadToProject(threadId, 'pB');
    expect(res.ok).toBe(true);
    expect(res.projectId).toBe('pB');
    const chats = await listProjectChats('pB');
    expect(chats.map((c) => c.id)).toContain(threadId);
  });

  it('binding to a foreign project is a 404', async () => {
    const s = session();
    await assignChatToProject(s, 'pA');
    const threadId = [...backend.threads.keys()][0];
    const res = await bindThreadToProject(threadId, 'pOther');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });
});

describe('listAddableChats (Add existing chat picker)', () => {
  function seed() {
    backend.threads.set('th-none', { id: 'th-none', project: null, title: 'Loose chat' });
    backend.threads.set('th-current', { id: 'th-current', project: 'pA', title: 'Alpha chat' });
    backend.threads.set('th-other', { id: 'th-other', project: 'pB', title: 'Beta chat' });
  }

  it('annotates add / in-project / move-here from backend membership', async () => {
    seed();
    const list = await listAddableChats('pA');
    const byId = Object.fromEntries(list.map((c) => [c.id, c]));
    expect(byId['th-none'].inCurrentProject).toBe(false);
    expect(byId['th-none'].otherProjectId).toBeNull();          // → "Add"
    expect(byId['th-current'].inCurrentProject).toBe(true);      // → disabled
    expect(byId['th-other'].inCurrentProject).toBe(false);
    expect(byId['th-other'].otherProjectId).toBe('pB');          // → "Move here"
    expect(byId['th-other'].otherProjectName).toBe('Beta');
  });

  it('adding a loose chat binds it → then appears in the project', async () => {
    seed();
    const res = await bindThreadToProject('th-none', 'pA');
    expect(res.ok).toBe(true);
    const chats = await listProjectChats('pA');
    expect(chats.map((c) => c.id)).toContain('th-none');
  });

  it('moving a chat from another project rebinds it (single binding)', async () => {
    seed();
    await bindThreadToProject('th-other', 'pA'); // move pB → pA
    const a = await listProjectChats('pA');
    const b = await listProjectChats('pB');
    expect(a.map((c) => c.id)).toContain('th-other');
    expect(b.map((c) => c.id)).not.toContain('th-other');
  });

  it('a guest gets an empty addable list (no server identity)', async () => {
    scope = 'guest_x';
    seed();
    expect(await listAddableChats('pA')).toEqual([]);
  });
});

describe('removeThreadFromProject (Project Overview remove)', () => {
  it('unbinds a thread by id without deleting it', async () => {
    // Seed a thread bound to pA, then remove it from the project.
    backend.threads.set('th-x', { id: 'th-x', project: 'pA', title: 'Keep me' });
    const { removeThreadFromProject } = await import('./projectApi');
    const res = await removeThreadFromProject('th-x');
    expect(res.ok).toBe(true);
    // Binding dropped...
    expect([...backend.threads.values()].find((t) => t.id === 'th-x')!.project).toBeNull();
    // ...but the thread still exists (conversation preserved).
    expect(backend.threads.has('th-x')).toBe(true);
    // ...and no longer appears under the project.
    const chats = await listProjectChats('pA');
    expect(chats.map((c) => c.id)).not.toContain('th-x');
  });
});
