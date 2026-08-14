import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startGithubConnect, beginGithubConnectRedirect,
  getGithubPendingRepositories, selectGithubRepository,
} from '@/lib/githubConnectorApi';

/**
 * GitHub connector — install-flow frontend client.
 *
 * Verifies the client hits the real install-flow endpoints, attaches the session
 * bearer, and — critically for the new UX — the final selection sends ONLY the
 * repo full name (no installation id, no manual repo string typed by the user).
 * Zero real network: fetch is stubbed and inspected.
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

/** Provide a `window` with a mockable location.assign (tests run in the node
 *  environment, so there is no real window — matching how these client tests
 *  stub `localStorage` via vi.stubGlobal). */
function mockLocation() {
  const assign = vi.fn();
  vi.stubGlobal('window', { location: { assign, href: '' } });
  return assign;
}

describe('githubConnectorApi — install flow', () => {
  it('startGithubConnect POSTs connect/start with the bearer and returns the install url', async () => {
    reply(200, { install_url: 'https://github.com/apps/korvix-ai/installations/new?state=abc', state: 'abc' });
    const res = await startGithubConnect('p1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.install_url).toContain('/apps/korvix-ai/installations/new');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/v2\/github\/projects\/p1\/connect\/start$/);
    expect(calls[0].auth).toBe('Bearer JWT-tok');
  });

  it('beginGithubConnectRedirect navigates to the install url on success', async () => {
    reply(200, { install_url: 'https://github.com/apps/korvix-ai/installations/new?state=xyz', state: 'xyz' });
    const assign = mockLocation();
    const res = await beginGithubConnectRedirect('p1');
    expect(res.ok).toBe(true);
    expect(assign).toHaveBeenCalledWith('https://github.com/apps/korvix-ai/installations/new?state=xyz');
  });

  it('beginGithubConnectRedirect does NOT navigate on failure', async () => {
    reply(503, null, 'not configured');
    const assign = mockLocation();
    const res = await beginGithubConnectRedirect('p1');
    expect(res.ok).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('getGithubPendingRepositories GETs the pending repo list', async () => {
    reply(200, { repositories: [{ id: '1', full_name: 'octo/hello', name: 'hello', owner: 'octo', private: false, archived: false }], count: 1 });
    const res = await getGithubPendingRepositories('p1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.repositories[0].full_name).toBe('octo/hello');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toMatch(/\/v2\/github\/projects\/p1\/pending-installation\/repositories$/);
  });

  it('getGithubPendingRepositories surfaces 404 (no pending install) as ok:false', async () => {
    reply(404, null, 'no pending');
    const res = await getGithubPendingRepositories('p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });

  it('selectGithubRepository POSTs ONLY the repo full name — never an installation id', async () => {
    reply(200, { connection: { project_id: 'p1', installation_id: '100', repo_full_name: 'octo/hello', repo_id: '42', created_at: '', updated_at: '' } });
    const res = await selectGithubRepository('p1', 'octo/hello');
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/v2\/github\/projects\/p1\/connect\/select$/);
    expect(calls[0].body).toEqual({ repo_full_name: 'octo/hello' });
    // The whole point of the new UX: the client never sends an installation id.
    expect(JSON.stringify(calls[0].body)).not.toContain('installation');
    expect(calls[0].auth).toBe('Bearer JWT-tok');
  });
});
