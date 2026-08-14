import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { addProject, updateProject, deleteProject } from '@/stores/projectStore';
import type { Project } from '@/types/projects';

/**
 * Ownership alignment — the project backend mirror must carry the authenticated
 * identity so the backend owns projects under the JWT subject (the SAME identity
 * the Gmail/GitHub connector routes enforce via require_auth). Previously these
 * calls sent no bearer, so projects were owned by the guest `korvix_user_id`
 * nonce and the connector's ownership check never matched.
 *
 * Zero real network — fetch is stubbed and inspected. Zero provider calls.
 */

const TOKEN_KEY = 'korvix_access_token';

function installStorage() {
  const m = new Map<string, string>();
  const store = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  } as unknown as Storage;
  (globalThis as unknown as { localStorage: Storage }).localStorage = store;
  return store;
}

type FetchCall = [string, RequestInit | undefined];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  installStorage();
  fetchMock = vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ projects: [] }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Let the fire-and-forget mirror microtasks settle. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

/** Find the mirror call to `/projects*` with the given method whose body (if
 *  any) contains `needle` — isolates the call under test from the module-load
 *  hydrate that may also touch `/projects`. */
function findProjectCall(method: string, needle: string): RequestInit | undefined {
  const calls = fetchMock.mock.calls as unknown as FetchCall[];
  for (const [url, init] of calls) {
    if (typeof url !== 'string' || !url.includes('/projects')) continue;
    if ((init?.method || 'GET') !== method) continue;
    const body = typeof init?.body === 'string' ? init.body : '';
    if (needle && !url.includes(needle) && !body.includes(needle)) continue;
    return init;
  }
  return undefined;
}

function authOf(init: RequestInit | undefined): string | undefined {
  const h = (init?.headers || {}) as Record<string, string>;
  return h['Authorization'];
}

function makeProject(id: string, name: string): Project {
  return { id, name, description: '' } as Project;
}

/** Establish a STABLE authenticated identity so the per-identity storage scope
 *  (`user_<id>`) doesn't shift between calls — matching a real signed-in user.
 *  The bearer is what the backend reads for ownership. */
function asAuthed(userId: string, token: string) {
  localStorage.setItem('korvix-auth', JSON.stringify({ state: { user: { id: userId } } }));
  localStorage.setItem(TOKEN_KEY, token);
}

/** Establish a STABLE guest identity (fixed nonce → stable `guest_<nonce>`), no
 *  token — the legacy anonymous path. */
function asGuest(nonce: string) {
  localStorage.removeItem('korvix-auth');
  localStorage.removeItem(TOKEN_KEY);
  localStorage.setItem('korvix_user_id', nonce);
}

describe('projectStore ownership alignment — bearer on backend mirror', () => {
  it('sends Authorization: Bearer on project create when authenticated', async () => {
    asAuthed('u-alpha', 'JWT-abc');
    fetchMock.mockClear();

    const ok = addProject(makeProject('own-1', 'Alpha-Auth-Create'));
    expect(ok).toBe(true);                 // localStorage write still authoritative
    await flush();

    const init = findProjectCall('POST', 'Alpha-Auth-Create');
    expect(init).toBeDefined();
    expect(authOf(init)).toBe('Bearer JWT-abc');
  });

  it('sends NO Authorization header for a guest (no token) — preserves nonce behaviour', async () => {
    asGuest('guest-nonce-1');
    fetchMock.mockClear();

    const ok = addProject(makeProject('own-2', 'Beta-Guest-Create'));
    expect(ok).toBe(true);
    await flush();

    const init = findProjectCall('POST', 'Beta-Guest-Create');
    expect(init).toBeDefined();
    expect(authOf(init)).toBeUndefined();
    // The guest identity still travels as the body user_id (legacy fallback).
    expect(typeof init?.body === 'string' ? init.body : '').toContain('user_id');
  });

  it('sends the bearer on project update (PATCH) when authenticated', async () => {
    asAuthed('u-gamma', 'JWT-xyz');
    addProject(makeProject('own-3', 'Gamma-Update'));
    await flush();
    fetchMock.mockClear();

    updateProject('own-3', { name: 'Gamma-Renamed' });
    await flush();

    const init = findProjectCall('PATCH', 'own-3');
    expect(init).toBeDefined();
    expect(authOf(init)).toBe('Bearer JWT-xyz');
  });

  it('sends the bearer on project delete (DELETE) when authenticated', async () => {
    asAuthed('u-delta', 'JWT-del');
    addProject(makeProject('own-4', 'Delta-Delete'));
    await flush();
    fetchMock.mockClear();

    deleteProject('own-4');
    await flush();

    const init = findProjectCall('DELETE', 'own-4');
    expect(init).toBeDefined();
    expect(authOf(init)).toBe('Bearer JWT-del');
  });

  it('regression: a create still succeeds + persists even if the mirror fetch rejects', async () => {
    asAuthed('u-epsilon', 'JWT-net');
    fetchMock.mockImplementation(async () => { throw new Error('network down'); });

    const ok = addProject(makeProject('own-5', 'Epsilon-Offline'));
    expect(ok).toBe(true);                 // localStorage is the source of truth
    await flush();
    // No throw escaped the fire-and-forget mirror (apiSafe swallowed it).
  });
});
