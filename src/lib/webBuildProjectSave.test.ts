import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveWebBuildPayloadToProject } from '@/lib/webBuildProject';
import { getProject, addProject, updateProject } from '@/stores/projectStore';
import type { Project } from '@/types/projects';
import type { WebBuildFile, WebBuildPayload, WebBuildStep } from '@/lib/webBuildPayload';

/**
 * Defect 3 — a Save to Project "success" must mean the Web Build payload actually round-tripped into
 * durable localStorage. Uses an in-memory localStorage whose byte budget simulates the browser quota
 * (same approach as webBuildPersistence.test.ts), plus a "silent-drop" store for the write-appears-to-
 * succeed-but-read-back-misses case. Zero network, zero provider.
 */

interface MockStore extends Storage { _map: Map<string, string>; }

/** In-memory localStorage. setItem throws QuotaExceededError once the total stored bytes exceed
 *  `byteBudget`. `silentDrop` makes setItem a no-op (accepts the write but stores nothing) — the
 *  write "succeeds" yet the value is not persisted. */
function installStorage(byteBudget = Infinity, silentDrop = false): MockStore {
  const m = new Map<string, string>();
  const totalIf = (key: string, value: string) => {
    let total = 0;
    for (const [k, v] of m) { if (k !== key) total += k.length + v.length; }
    return total + key.length + value.length;
  };
  const store = {
    _map: m,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      const s = String(v);
      if (totalIf(k, s) > byteBudget) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      if (silentDrop && k.includes('project')) return; // accept but do not persist project data
      m.set(k, s);
    },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  } as unknown as MockStore;
  (globalThis as unknown as { localStorage: Storage }).localStorage = store;
  return store;
}
const asUser = (id: string) => localStorage.setItem('korvix-auth', JSON.stringify({ state: { user: { id } } }));

const ENTRY = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];
function entryFiles(): WebBuildFile[] {
  return ENTRY.map((p) => ({ path: p, content: 'x', language: 'tsx', status: 'unchanged' as const, added: 0, removed: 0 }));
}
function step(id: string, big = false): WebBuildStep {
  const files = big ? entryFiles().map((f) => ({ ...f, content: 'z'.repeat(600) })) : entryFiles();
  return { id, files } as unknown as WebBuildStep;
}
function payload(...steps: WebBuildStep[]): WebBuildPayload {
  return { prompt: 'a landing page', brief: { type: 'Landing' }, sectionItems: [], activity: [{ id: 'save', status: 'pending' }], steps } as unknown as WebBuildPayload;
}

describe('saveWebBuildPayloadToProject — verified persistence (Defect 3)', () => {
  beforeEach(() => { installStorage(); asUser('U'); });

  it('A: normal save → ok and the webBuild + latest step round-tripped', () => {
    const res = saveWebBuildPayloadToProject(payload(step('run1')));
    expect(res.ok).toBe(true);
    const back = getProject(res.project.id);
    expect(back?.webBuild).toBeTruthy();
    expect(back?.webBuild?.steps?.some((s) => s.id === 'run1')).toBe(true);
  });

  it('B: localStorage write throws (quota) → save reports failure, nothing persisted', () => {
    installStorage(60); asUser('U'); // tiny budget → any project write throws
    const res = saveWebBuildPayloadToProject(payload(step('run1')));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('write-failed');
    expect(getProject(res.project.id)).toBeUndefined();
  });

  it('C: write appears to succeed but read-back misses the project → failure', () => {
    installStorage(Infinity, true); asUser('U'); // setItem accepts project writes but drops them
    const res = saveWebBuildPayloadToProject(payload(step('run1')));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('project-not-persisted');
  });

  it('D: failed save leaves the in-memory Web Build payload untouched', () => {
    installStorage(60); asUser('U');
    const p = payload(step('run1'));
    const before = JSON.stringify(p);
    saveWebBuildPayloadToProject(p);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('E: failed save never returns ok (the UI success signal)', () => {
    installStorage(60); asUser('U');
    expect(saveWebBuildPayloadToProject(payload(step('run1'))).ok).toBe(false);
  });

  it('F: retry after storage becomes writable → success', () => {
    installStorage(60); asUser('U');
    expect(saveWebBuildPayloadToProject(payload(step('run1'))).ok).toBe(false);
    installStorage(); asUser('U'); // storage healthy again
    expect(saveWebBuildPayloadToProject(payload(step('run1'))).ok).toBe(true);
  });

  it('G: a failed UPDATE preserves the previously-saved project', () => {
    // Seed a small project that fits, then size the budget so a larger update cannot be written.
    installStorage(); asUser('U');
    const seeded: Project = {
      id: 'proj-keep', name: 'Website: Landing', description: '', category: 'Website', status: 'active',
      progress: 40, agents: [], tasks: [], memory: [], files: [], createdAt: 'x', updatedAt: 'x',
      color: 'slate', gradient: '', icon: 'Layout', webBuild: payload(step('run1')),
    } as unknown as Project;
    addProject(seeded);
    const budget = 'projects'.length + (localStorage.getItem('projects') || '').length + 40;
    installStorage(budget); asUser('U');
    addProject(seeded); // re-seed under the tight budget (fits)
    const before = JSON.stringify(getProject('proj-keep'));
    const res = saveWebBuildPayloadToProject(payload(step('run1'), step('run2', true)), 'proj-keep');
    expect(res.ok).toBe(false);
    expect(JSON.stringify(getProject('proj-keep'))).toBe(before); // prior project intact
    expect(getProject('proj-keep')?.webBuild?.steps?.length).toBe(1);
  });
});

/**
 * Finding 2 — the backend mirror (POST /projects, PATCH /projects/:id) must fire ONLY after the
 * authoritative local write succeeded. A failed local durable write that still hit the backend would
 * create local/remote divergence (a "failed" save that nonetheless created the project server-side,
 * then a retry creating a duplicate). These assert the mirror call count against local write outcome.
 */
function installStore(failProjectsWrite = false): void {
  const m = new Map<string, string>();
  const store = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      // Fail ONLY the durable project-list write, so auth/user-id writes still succeed and the
      // failure is isolated to exactly the persistence Finding 2 cares about.
      if (failProjectsWrite && k.includes('projects')) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  } as unknown as Storage;
  (globalThis as unknown as { localStorage: Storage }).localStorage = store;
}
const seedProject = (id: string): Project => ({
  id, name: 'Website: Landing', description: '', category: 'Website', status: 'active',
  progress: 40, agents: [], tasks: [], memory: [], files: [], createdAt: 'x', updatedAt: 'x',
  color: 'slate', gradient: '', icon: 'Layout',
} as unknown as Project);

describe('projectStore backend mirror gated on local write (Finding 2)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) } as Response));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('failed local add → no backend mirror POST', () => {
    installStore(true); asUser('U');
    expect(addProject(seedProject('p1'))).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('failed local update → no backend mirror PATCH (existing project, write-back fails)', () => {
    // A store that HOLDS the project (so updateProject's findIndex succeeds) but rejects any
    // projects write-back — isolating "the project exists locally but the durable update failed".
    (globalThis as unknown as { localStorage: Storage }).localStorage = (() => {
      const m = new Map<string, string>();
      m.set('korvix-auth', JSON.stringify({ state: { user: { id: 'U' } } }));
      return {
        getItem: (k: string) => (m.has(k) ? m.get(k)! : (k.includes('projects') ? JSON.stringify([seedProject('p2')]) : null)),
        setItem: (k: string, v: string) => { if (k.includes('projects')) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
        removeItem: (k: string) => m.delete(k), clear: () => m.clear(), key: (i: number) => Array.from(m.keys())[i] ?? null, get length() { return m.size; },
      } as unknown as Storage;
    })();
    fetchSpy.mockClear();
    expect(updateProject('p2', { name: 'Renamed' })).toBe(false); // project found, but write-back fails
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('successful local add fires the mirror POST exactly once', () => {
    installStore(); asUser('U');
    expect(addProject(seedProject('p3'))).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/projects');
  });

  it('successful local update fires the mirror PATCH', () => {
    installStore(); asUser('U');
    addProject(seedProject('p4'));
    fetchSpy.mockClear();
    expect(updateProject('p4', { name: 'Renamed' })).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/projects/p4');
  });
});
