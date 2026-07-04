/**
 * Mirror a Web Build session into the SHARED chat-session store so it appears
 * in the left sidebar like a normal conversation. The record is tagged
 * `mode: 'web_build'` + `webBuildRunId` so ChatDashboard routes a click to the
 * Web Build page (which reopens the real session) instead of opening Chat.
 *
 * We deliberately reuse the exact localStorage scope + key that useChat uses
 * (`korvix_sessions_<scope>`) so the sidebar picks the entry up on its next
 * load. Writes are additive and id-stable (one entry per Web Build session — no
 * duplicates); we never touch other sessions.
 */

/** Mirror of useChat.currentStorageScope() — keep in sync. */
function storageScope(): string {
  try {
    const blob = localStorage.getItem('korvix-auth');
    if (blob) {
      const uid = JSON.parse(blob)?.state?.user?.id;
      if (typeof uid === 'string' && uid) return `user_${uid}`;
    }
  } catch { /* fall through */ }
  try {
    const nonce = localStorage.getItem('korvix_user_id');
    if (typeof nonce === 'string' && nonce) return `guest_${nonce}`;
  } catch { /* fall through */ }
  return 'guest_anon';
}

function sessionsKey(): string {
  return `korvix_sessions_${storageScope()}`;
}

interface StoredChatSession {
  id: string;
  title: string;
  mode?: string;
  webBuildRunId?: string;
  messages: { id: string; role: string; content: string; timestamp: string }[];
  updatedAt: string;
}

/** Create or update the sidebar entry for a Web Build session. */
export function upsertWebBuildChatSession(sessionId: string, title: string, prompt: string): void {
  if (!sessionId) return;
  try {
    const key = sessionsKey();
    const raw = localStorage.getItem(key);
    const list: StoredChatSession[] = raw ? (JSON.parse(raw) as StoredChatSession[]) : [];
    const arr = Array.isArray(list) ? list : [];
    const now = new Date().toISOString();
    const existing = arr.find((s) => s && s.id === sessionId);
    if (existing) {
      existing.title = title;
      existing.mode = 'web_build';
      existing.webBuildRunId = sessionId;
      existing.updatedAt = now;
      if (!existing.messages?.length && prompt) {
        existing.messages = [{ id: `${sessionId}-u`, role: 'user', content: prompt, timestamp: now }];
      }
    } else {
      arr.unshift({
        id: sessionId,
        title,
        mode: 'web_build',
        webBuildRunId: sessionId,
        messages: prompt ? [{ id: `${sessionId}-u`, role: 'user', content: prompt, timestamp: now }] : [],
        updatedAt: now,
      });
    }
    localStorage.setItem(key, JSON.stringify(arr));
  } catch { /* ignore quota/serialization errors */ }
}
