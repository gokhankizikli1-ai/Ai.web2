// coding: utf-8
// Pure, race-free resolution of the project id to attach to an AI request.
//
// This is the decision authority behind useChat's `resolveSendProjectId`.
// It lives in its own module (no React) so the switch-then-send race
// behaviour can be unit-tested directly in node-env vitest — the same
// reason `projectBinding.ts` was extracted.
//
// The contract (matches useChat exactly):
//   • If a binding was already resolved for THIS EXACT session
//     (`cached.sid === sid`), trust it — even when it resolved to null
//     (an explicitly-unbound chat must send NO project id). A pending
//     new-from-project target is only used to fill a null cache.
//   • Otherwise resolve authoritatively from the session's server thread
//     (`getThreadProject`) so a just-switched bound chat still sends its
//     real project and a just-switched UNBOUND chat sends nothing.
//   • A new-from-project chat with no server thread yet uses its pending
//     target so even the FIRST turn can receive Project context.
//   • Never derives the project from localStorage metadata. Returns null
//     when there is no real association.
//
// The returned id is only ever a routing HINT: the backend re-verifies
// the AUTHENTICATED user owns it before injecting any project context.

export interface SendProjectIdDeps {
  /** Optimistic new-from-project target for this session, if any. */
  pending: string | null;
  /** The binding resolved by the active-project effect, keyed by session. */
  cached: { sid: string; pid: string | null };
  /** The session record (for its serverThreadId), if it exists locally. */
  session: { serverThreadId?: string | null } | undefined;
  /** Whether server chat persistence is enabled (serverChatEnabled()). */
  serverEnabled: boolean;
  /** Authoritative binding lookup by backend thread id. */
  getThreadProject: (threadId: string) => Promise<string | null>;
}

export async function resolveSendProjectId(
  sid: string,
  deps: SendProjectIdDeps,
): Promise<string | null> {
  const { pending, cached, session, serverEnabled, getThreadProject } = deps;
  // Resolved for THIS session → authoritative. A null pid means the chat is
  // explicitly unbound; fall back to `pending` only to fill that null (so a
  // brand-new project chat whose effect hasn't run yet still gets context).
  if (cached.sid === sid) return cached.pid ?? pending ?? null;
  // Not resolved for this session (switch-then-send): resolve from the
  // backend thread binding so we never leak the previously-selected chat's
  // project and never miss a just-switched bound chat's real project.
  if (session?.serverThreadId && serverEnabled) {
    try {
      const pid = await getThreadProject(session.serverThreadId);
      return pid ?? pending ?? null;
    } catch {
      return pending ?? null;
    }
  }
  return pending ?? null;
}
