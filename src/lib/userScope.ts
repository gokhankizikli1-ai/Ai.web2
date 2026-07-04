/**
 * The per-identity storage scope — the SINGLE source of truth for isolating
 * localStorage between accounts. Web Build (sessions, active pointer, preview
 * stash) and the sidebar companion all key their storage by this scope so one
 * account can NEVER see another's builds.
 *
 * This mirrors useChat.currentStorageScope() exactly:
 *   authenticated → `user_<id>` (from the zustand `korvix-auth` persist blob)
 *   guest         → `guest_<nonce>` (the rotating `korvix_user_id`)
 *   fallback      → `guest_anon`
 * Kept in sync with useChat so a Web Build session lands in the same identity
 * bucket as that user's chats.
 */
export function currentUserScope(): string {
  try {
    const blob = localStorage.getItem('korvix-auth');
    if (blob) {
      const uid = JSON.parse(blob)?.state?.user?.id;
      if (typeof uid === 'string' && uid) return `user_${uid}`;
    }
  } catch { /* fall through to guest */ }
  try {
    const nonce = localStorage.getItem('korvix_user_id');
    if (typeof nonce === 'string' && nonce) return `guest_${nonce}`;
  } catch { /* fall through */ }
  return 'guest_anon';
}

/** A scoped localStorage key, e.g. korvix:webbuild:user_42:sessions. */
export function scopedKey(namespace: string, name: string): string {
  return `korvix:${namespace}:${currentUserScope()}:${name}`;
}
