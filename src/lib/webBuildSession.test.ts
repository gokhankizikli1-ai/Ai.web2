import { describe, it, expect, beforeEach } from 'vitest';
import { saveWebBuildSession, getActiveWebBuildSession, clearActiveWebBuildSession, listWebBuildSessions } from '@/lib/webBuildSession';
import type { WebBuildPayload } from '@/lib/webBuildPayload';

/** In-memory localStorage so the scoping logic can be exercised in node. */
function installStorage() {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return m;
}

const asUser = (id: string) => localStorage.setItem('korvix-auth', JSON.stringify({ state: { user: { id } } }));
const asGuest = () => { localStorage.removeItem('korvix-auth'); localStorage.setItem('korvix_user_id', 'guest-nonce-1'); };

const payload = (stepId: string, prompt: string): WebBuildPayload =>
  ({ steps: [{ id: stepId }], prompt, brief: {}, sectionItems: [], files: [], createdAt: 't' } as unknown as WebBuildPayload);

describe('web build session isolation', () => {
  beforeEach(() => { installStorage(); });

  it('scopes sessions per user — one account never sees another', () => {
    asUser('A');
    saveWebBuildSession(payload('step-A', 'A prompt'), 'en');
    expect(getActiveWebBuildSession()?.prompt).toBe('A prompt');

    // Switch to account B — must NOT see A's build.
    asUser('B');
    expect(getActiveWebBuildSession()).toBeNull();
    expect(listWebBuildSessions()).toHaveLength(0);

    saveWebBuildSession(payload('step-B', 'B prompt'), 'en');
    expect(getActiveWebBuildSession()?.prompt).toBe('B prompt');

    // Back to A — A's build is still there and unaffected by B.
    asUser('A');
    expect(getActiveWebBuildSession()?.prompt).toBe('A prompt');
    expect(listWebBuildSessions()).toHaveLength(1);
  });

  it('a guest scope is separate from a signed-in user', () => {
    asGuest();
    saveWebBuildSession(payload('step-G', 'guest prompt'), 'en');
    expect(getActiveWebBuildSession()?.prompt).toBe('guest prompt');
    asUser('A');
    expect(getActiveWebBuildSession()).toBeNull();
  });

  it('New Build clears the active pointer but keeps the session in history', () => {
    asUser('A');
    saveWebBuildSession(payload('step-A', 'A prompt'), 'en');
    clearActiveWebBuildSession();
    expect(getActiveWebBuildSession()).toBeNull();     // fresh empty state
    expect(listWebBuildSessions()).toHaveLength(1);     // still restorable
  });
});
