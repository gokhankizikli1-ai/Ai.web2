import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startGithubConnect, beginGithubConnectRedirect, beginGithubInstallRedirect,
  getGithubPendingInstallations, getGithubPendingRepositories, selectGithubRepository,
} from '@/lib/githubConnectorApi';

/**
 * GitHub connector — connect-flow frontend client.
 *
 * Verifies the client hits the real connect-flow endpoints, attaches the session
 * bearer, drives the browser to the user-AUTHORIZATION url by default (the path
 * that resolves an already-installed App without uninstall/reinstall) and to the
 * INSTALL url only for the explicit fallback, and — critically for the new UX —
 * the final selection sends the repo full name plus (when several installations
 * are pending) the chosen installation id, both server-verified. Zero real
 * network: fetch is stubbed and inspected.
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

const startPayload = {
  authorize_url: 'https://github.com/login/oauth/authorize?client_id=cid&state=abc',
  install_url: 'https://github.com/apps/korvix-ai/installations/new?state=abc',
  state: 'abc',
};

describe('githubConnectorApi — connect flow', () => {
  it('startGithubConnect POSTs connect/start with the bearer and returns both urls', async () => {
    reply(200, startPayload);
    const res = await startGithubConnect('p1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.authorize_url).toContain('/login/oauth/authorize');
      expect(res.data.install_url).toContain('/apps/korvix-ai/installations/new');
    }
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/v2\/github\/projects\/p1\/connect\/start$/);
    expect(calls[0].auth).toBe('Bearer JWT-tok');
  });

  it('beginGithubConnectRedirect navigates to the AUTHORIZE url on success', async () => {
    reply(200, startPayload);
    const assign = mockLocation();
    const res = await beginGithubConnectRedirect('p1');
    expect(res.ok).toBe(true);
    expect(assign).toHaveBeenCalledWith(startPayload.authorize_url);
  });

  it('beginGithubInstallRedirect navigates to the INSTALL url on success', async () => {
    reply(200, startPayload);
    const assign = mockLocation();
    const res = await beginGithubInstallRedirect('p1');
    expect(res.ok).toBe(true);
    expect(assign).toHaveBeenCalledWith(startPayload.install_url);
  });

  it('beginGithubConnectRedirect does NOT navigate on failure', async () => {
    reply(503, null, 'not configured');
    const assign = mockLocation();
    const res = await beginGithubConnectRedirect('p1');
    expect(res.ok).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('getGithubPendingInstallations GETs the verified installation list', async () => {
    reply(200, { installations: [{ installation_id: '100', account_login: 'octo', account_type: 'User' }], count: 1 });
    const res = await getGithubPendingInstallations('p1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.installations[0].account_login).toBe('octo');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toMatch(/\/v2\/github\/projects\/p1\/pending-installations$/);
  });

  it('getGithubPendingRepositories GETs the pending repo list (no id → no query)', async () => {
    reply(200, { repositories: [{ id: '1', full_name: 'octo/hello', name: 'hello', owner: 'octo', private: false, archived: false }], count: 1, installation_id: '100' });
    const res = await getGithubPendingRepositories('p1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.repositories[0].full_name).toBe('octo/hello');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toMatch(/\/v2\/github\/projects\/p1\/pending-installation\/repositories$/);
  });

  it('getGithubPendingRepositories passes the installation id as a query param', async () => {
    reply(200, { repositories: [], count: 0, installation_id: '300' });
    await getGithubPendingRepositories('p1', '300');
    expect(calls[0].url).toMatch(/\/pending-installation\/repositories\?installation_id=300$/);
  });

  it('getGithubPendingRepositories surfaces 404 (no pending install) as ok:false', async () => {
    reply(404, null, 'no pending');
    const res = await getGithubPendingRepositories('p1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });

  it('selectGithubRepository POSTs the repo full name and no installation id by default', async () => {
    reply(200, { connection: { project_id: 'p1', installation_id: '100', repo_full_name: 'octo/hello', repo_id: '42', created_at: '', updated_at: '' } });
    const res = await selectGithubRepository('p1', 'octo/hello');
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toMatch(/\/v2\/github\/projects\/p1\/connect\/select$/);
    expect(calls[0].body).toEqual({ repo_full_name: 'octo/hello' });
    expect(calls[0].auth).toBe('Bearer JWT-tok');
  });

  it('selectGithubRepository includes the installation id when one is chosen', async () => {
    reply(200, { connection: { project_id: 'p1', installation_id: '300', repo_full_name: 'acme/widget', repo_id: '77', created_at: '', updated_at: '' } });
    const res = await selectGithubRepository('p1', 'acme/widget', '300');
    expect(res.ok).toBe(true);
    expect(calls[0].body).toEqual({ repo_full_name: 'acme/widget', installation_id: '300' });
  });
});
