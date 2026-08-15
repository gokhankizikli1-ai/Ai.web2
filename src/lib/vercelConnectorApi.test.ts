import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startVercelConnect, beginVercelConnectRedirect, getVercelConnection,
  getVercelPendingProjects, selectVercelProject, syncVercel, disconnectVercel,
} from '@/lib/vercelConnectorApi';

/**
 * Vercel connector — frontend client.
 *
 * Verifies the client hits the real backend endpoints, attaches the session
 * bearer, drives the browser to the server-provided authorization URL, sends
 * only a server-provided Vercel project id on selection, and surfaces truthful
 * error/partial states. Critically it also proves the client has NO mutation
 * call and never handles a token. Zero real network: fetch is stubbed and
 * inspected.
 */

interface Captured { url: string; method: string; body: unknown; auth?: string }

let calls: Captured[];
let nextResponse: { status: number; body: unknown };

function stubFetch() {
  calls = [];
  nextResponse = { status: 200, body: { success: true, data: {}, error: null } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      auth: headers['Authorization'],
    });
    return {
      ok: nextResponse.status >= 200 && nextResponse.status < 300,
      status: nextResponse.status,
      json: async () => nextResponse.body,
    } as unknown as Response;
  }));
}

beforeEach(() => {
  const storage: Record<string, string> = { korvix_access_token: 'JWT-tok' };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
  });
  stubFetch();
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function reply(status: number, data: unknown, error: string | null = null) {
  nextResponse = { status, body: { success: status < 400, data, error } };
}

/** Provide a `window` with a mockable location.assign (tests run in node). */
function stubLocation() {
  const assign = vi.fn();
  vi.stubGlobal('window', { location: { assign } });
  return assign;
}

const CONNECTION = {
  project_id: 'p1',
  provider: 'vercel',
  account_label: 'Acme Inc',
  team_id: 'team_9',
  vercel_project_id: 'prj_1',
  vercel_project_name: 'korvix-site',
  framework: 'nextjs',
  production_url: 'https://korvixai.com',
  status: 'connected',
  connected: true,
  needs_project_selection: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  last_sync_at: '2024-01-02T00:00:00Z',
};

// ── connect ────────────────────────────────────────────────────────────────

describe('connect', () => {
  it('POSTs to the project-scoped connect/start with the session bearer', async () => {
    reply(200, { authorization_url: 'https://vercel.com/integrations/korvixai/new?state=S', state: 'S' });
    const res = await startVercelConnect('p1');
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/v2/vercel/projects/p1/connect/start');
    expect(calls[0].auth).toBe('Bearer JWT-tok');
    // No user id is ever sent — identity comes from the session.
    expect(calls[0].body).toBeUndefined();
  });

  it('encodes the project id', async () => {
    reply(200, { authorization_url: 'x', state: 'S' });
    await startVercelConnect('a/b c');
    expect(calls[0].url).toContain('/projects/a%2Fb%20c/');
  });

  it('redirects the browser to the SERVER-provided authorization url', async () => {
    const assign = stubLocation();
    reply(200, { authorization_url: 'https://vercel.com/integrations/korvixai/new?state=S', state: 'S' });
    await beginVercelConnectRedirect('p1');
    expect(assign).toHaveBeenCalledWith('https://vercel.com/integrations/korvixai/new?state=S');
  });

  it('does NOT navigate when the start call fails', async () => {
    const assign = stubLocation();
    reply(503, null, 'connector disabled');
    const res = await beginVercelConnectRedirect('p1');
    expect(assign).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(503);
  });
});

// ── callback result state (status read) ────────────────────────────────────

describe('connection status', () => {
  it('reports a connected project', async () => {
    reply(200, { connection: CONNECTION, connected: true });
    const res = await getVercelConnection('p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.connected).toBe(true);
      expect(res.data.connection?.vercel_project_name).toBe('korvix-site');
      expect(res.data.connection?.account_label).toBe('Acme Inc');
    }
    expect(calls[0].method).toBe('GET');
  });

  it('reports the awaiting-project-choice state', async () => {
    reply(200, {
      connection: { ...CONNECTION, connected: false, status: 'pending_selection',
                    needs_project_selection: true, vercel_project_id: null },
      connected: false,
    });
    const res = await getVercelConnection('p1');
    if (res.ok) {
      expect(res.data.connected).toBe(false);
      expect(res.data.connection?.needs_project_selection).toBe(true);
    }
  });

  it('reports a not-connected project', async () => {
    reply(200, { connection: null, connected: false });
    const res = await getVercelConnection('p1');
    if (res.ok) expect(res.data.connection).toBeNull();
  });
});

// ── project picker + selection ─────────────────────────────────────────────

describe('project picker', () => {
  it('reads the server-provided list', async () => {
    reply(200, { projects: [{ vercel_project_id: 'prj_1', name: 'site', framework: 'nextjs' }], count: 1 });
    const res = await getVercelPendingProjects('p1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.projects[0].vercel_project_id).toBe('prj_1');
    expect(calls[0].url).toContain('/v2/vercel/projects/p1/pending-projects');
    expect(calls[0].url).not.toContain('refresh');
  });

  it('can force a live refresh (the change-project path)', async () => {
    reply(200, { projects: [], count: 0 });
    await getVercelPendingProjects('p1', true);
    expect(calls[0].url).toContain('pending-projects?refresh=true');
  });

  it('surfaces a 409 when there is no authorization yet', async () => {
    nextResponse = {
      status: 409,
      body: { detail: { code: 'NOT_AUTHORIZED', message: 'Vercel is not authorized for this project.' } },
    };
    const res = await getVercelPendingProjects('p1');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(409);
      expect(res.message).toContain('not authorized');
    }
  });

  it('sends only the chosen project id on select', async () => {
    reply(200, { connection: CONNECTION });
    const res = await selectVercelProject('p1', 'prj_1');
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/v2/vercel/projects/p1/connect/select');
    expect(calls[0].body).toEqual({ vercel_project_id: 'prj_1' });
  });

  it('surfaces the backend reason when a selection is refused', async () => {
    nextResponse = {
      status: 404,
      body: { detail: { code: 'NO_PENDING_PROJECT', message: 'That Vercel project is not in this project\'s available list.' } },
    };
    const res = await selectVercelProject('p1', 'prj_evil');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('not in this project');
  });
});

// ── sync ───────────────────────────────────────────────────────────────────

describe('sync', () => {
  it('POSTs and returns a truthful clean report', async () => {
    reply(200, {
      sync: { project_id: 'p1', vercel_project_id: 'prj_1', recorded: 4, deduplicated: 2,
              rejected: 0, deployments: 6, errors: {}, ok: true },
    });
    const res = await syncVercel('p1');
    expect(calls[0].method).toBe('POST');
    if (res.ok) {
      expect(res.data.sync.recorded).toBe(4);
      expect(res.data.sync.ok).toBe(true);
    }
  });

  it('preserves a PARTIAL failure rather than reporting success', async () => {
    reply(200, {
      sync: { project_id: 'p1', vercel_project_id: 'prj_1', recorded: 1, deduplicated: 0,
              rejected: 0, deployments: 1,
              errors: { deployments: 'VercelServerError (HTTP 500)' }, ok: false },
    });
    const res = await syncVercel('p1');
    if (res.ok) {
      expect(res.data.sync.ok).toBe(false);
      expect(Object.keys(res.data.sync.errors)).toEqual(['deployments']);
    }
  });

  it('reports a revoked authorization', async () => {
    nextResponse = {
      status: 409,
      body: { detail: { code: 'CONNECTION_REVOKED', message: 'Vercel authorization is no longer valid. Reconnect to sync.' } },
    };
    const res = await syncVercel('p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('Reconnect');
  });

  it('reports an unreachable server without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const res = await syncVercel('p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(0);
  });
});

// ── disconnect ─────────────────────────────────────────────────────────────

describe('disconnect', () => {
  it('DELETEs the connection', async () => {
    reply(200, { removed: true, connected: false });
    const res = await disconnectVercel('p1');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain('/v2/vercel/projects/p1/connection');
    if (res.ok) expect(res.data.removed).toBe(true);
  });
});

// ── read-only + secret discipline ──────────────────────────────────────────

describe('read-only contract', () => {
  it('exposes no deploy/rollback/env/domain call', async () => {
    const mod = await import('@/lib/vercelConnectorApi');
    const names = Object.keys(mod).join(' ').toLowerCase();
    for (const forbidden of ['deploy', 'redeploy', 'rollback', 'promote',
                             'cancel', 'env', 'domain', 'alias', 'delete']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('never sends anything but the session bearer', async () => {
    reply(200, { connection: CONNECTION, connected: true });
    await getVercelConnection('p1');
    const body = JSON.stringify(calls[0]);
    expect(body).not.toContain('client_secret');
    expect(body).not.toContain('access_token');
  });
});
