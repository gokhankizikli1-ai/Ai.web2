/**
 * Mirror a Web Build session into the SHARED chat-session store so it appears
 * in the left sidebar like a normal conversation. The record is tagged
 * `mode: 'web_build'` + `webBuildRunId` so ChatDashboard restores it as an
 * embedded Web Build (which reopens the real payload) instead of opening Chat.
 *
 * We reuse the exact per-identity storage scope + key that useChat uses
 * (`korvix_sessions_<scope>`, scope from userScope) so the entry lands in the
 * SAME account bucket — never leaking to another user — and the sidebar picks
 * it up on its next load. Writes are additive and id-stable (one entry per Web
 * Build session — no duplicates); we never touch other sessions.
 *
 * Phase 13D.1 — the OWNING chat session id and the Web Build RUN id are DISTINCT
 * identities and must never be conflated. The sidebar record keeps its own
 * `chatSessionId` as `id`; `webBuildRunId` points at the real build run. An entry
 * is matched by EITHER identity so a companion is never duplicated across refreshes.
 */
import { currentUserScope } from '@/lib/userScope';

function sessionsKey(): string {
  return `korvix_sessions_${currentUserScope()}`;
}

interface StoredChatSession {
  id: string;
  title: string;
  mode?: string;
  webBuildRunId?: string;
  messages: { id: string; role: string; content: string; timestamp: string }[];
  updatedAt: string;
}

/**
 * Create or update the sidebar companion for a Web Build session. `chatSessionId`
 * owns the sidebar row; `webBuildRunId` is the real build-run id (they may differ).
 * Matches an existing row by the SAME chat session id OR the SAME Web Build run id,
 * updates it in place (no duplicate), and preserves any existing chat messages.
 *
 * A legacy 3-arg form `(sessionId, title, prompt)` is still accepted for the standalone
 * /tools/website-builder page, where the sidebar companion id and the run id are the
 * SAME identity (there is no separate owning chat session) — it maps to
 * `(sessionId, sessionId, title, prompt)`. The embedded Chat flow always uses the
 * 4-arg form with the DISTINCT chat-session and run ids.
 */
export function upsertWebBuildChatSession(chatSessionId: string, webBuildRunId: string, title: string, prompt: string): void;
export function upsertWebBuildChatSession(sessionId: string, title: string, prompt: string): void;
export function upsertWebBuildChatSession(a: string, b: string, c: string, d?: string): void {
  // Disambiguate the legacy 3-arg form (d omitted): (sessionId, title, prompt) where the
  // companion id and the run id are the same. The 4-arg form always passes a real prompt.
  const legacy = d === undefined;
  const chatSessionId = a;
  const webBuildRunId = legacy ? a : b;
  const title = legacy ? b : c;
  const prompt = legacy ? c : (d as string);
  if (!chatSessionId || !webBuildRunId) return;
  try {
    const key = sessionsKey();
    const raw = localStorage.getItem(key);
    const list: StoredChatSession[] = raw ? (JSON.parse(raw) as StoredChatSession[]) : [];
    const arr = Array.isArray(list) ? list : [];
    const now = new Date().toISOString();
    // Match by either identity so we never create a duplicate companion.
    const existing = arr.find((s) => s && (s.id === chatSessionId || s.webBuildRunId === webBuildRunId));
    if (existing) {
      existing.title = title || existing.title;
      existing.mode = 'web_build';
      existing.webBuildRunId = webBuildRunId; // the REAL run id, never the chat id
      existing.updatedAt = now;
      if (!existing.messages?.length && prompt) {
        existing.messages = [{ id: `${chatSessionId}-u`, role: 'user', content: prompt, timestamp: now }];
      }
    } else {
      arr.unshift({
        id: chatSessionId,
        title,
        mode: 'web_build',
        webBuildRunId,
        messages: prompt ? [{ id: `${chatSessionId}-u`, role: 'user', content: prompt, timestamp: now }] : [],
        updatedAt: now,
      });
    }
    localStorage.setItem(key, JSON.stringify(arr));
  } catch { /* ignore quota/serialization errors */ }
}
