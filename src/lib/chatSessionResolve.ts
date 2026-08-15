/**
 * chatSessionResolve — the canonical identity mapping for "open this chat".
 *
 * A chat is identified across surfaces by TWO different ids:
 *   • ChatSession.id          — the local, client-generated id (sidebar/select)
 *   • ChatSession.serverThreadId — the backend thread id (Project Overview, the
 *                                  server sessions authority)
 *
 * These are NOT equal for a chat that originated locally and later synced: it
 * keeps its random local id while carrying serverThreadId=<threadId>, and the
 * hydrated server copy is deduped against it. The Project Overview opens chats
 * by SERVER THREAD ID, so resolving a request must match EITHER id — matching
 * only by `id` was the live "clicking a project chat opens a blank new chat"
 * bug. Callers then select the returned session's LOCAL `id` (what the active
 * session is keyed on).
 */
import type { ChatSession } from '@/types';

export function resolveOpenTarget(
  sessions: ChatSession[],
  threadOrId: string,
): ChatSession | null {
  if (!threadOrId) return null;
  return sessions.find(
    (s) => s.id === threadOrId || s.serverThreadId === threadOrId,
  ) ?? null;
}
