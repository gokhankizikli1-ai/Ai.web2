/**
 * Per-identity localStorage SCOPE — the single source of truth for isolating
 * user-owned local data by identity (Phase 14D). Mirrors the scope useChat.ts
 * has used since the 2026-06-28 chat-namespacing fix, so chat, projects,
 * standalone agents and saved prompts all bucket into the SAME identity:
 *
 *   authenticated → `user_<auth_user_id>`   (from the persisted korvix-auth blob)
 *   guest         → `guest_<browser_nonce>` (the korvix_user_id nonce)
 *   storage down  → `guest_anon`            (private-mode fallback)
 *
 * Isolation is STRUCTURAL: each identity reads/writes its OWN keys, so logging
 * out never has to DESTROY a user's data to hide it from the next account — the
 * next account simply reads a different key, and same-user re-login restores the
 * same key. This module never mutates identity; it only derives keys + migrates
 * legacy global data. It reads `korvix-auth` directly (not the store) to avoid a
 * circular dependency between the auth layer and the data stores.
 */

/** The current identity's storage scope. Never returns an empty string. */
export function currentStorageScope(): string {
  try {
    const blob = localStorage.getItem('korvix-auth');
    if (blob) {
      const parsed = JSON.parse(blob);
      const uid = parsed?.state?.user?.id;
      if (typeof uid === 'string' && uid) return `user_${uid}`;
    }
  } catch { /* fall through to guest */ }
  try {
    const nonce = localStorage.getItem('korvix_user_id');
    if (typeof nonce === 'string' && nonce) return `guest_${nonce}`;
  } catch { /* ignore */ }
  return 'guest_anon';
}

/** Build a per-identity key: `<base>_<scope>`. */
export function scopedKey(base: string): string {
  return `${base}_${currentStorageScope()}`;
}

/**
 * One-time-per-identity migration of a legacy GLOBAL localStorage value into the
 * current scope. If the scoped key is still empty and the global key holds data,
 * the current identity CLAIMS it (copy → scoped) and the global key is REMOVED,
 * so a second account on the same browser can never inherit it. Because logging
 * out / switching accounts is always an in-app action (the app is loaded, so a
 * read has already migrated + removed the global key), a later account never
 * sees the previous account's legacy data.
 *
 * `onClaim(raw)` runs with the migrated raw string BEFORE the global key is
 * removed, letting callers migrate dependent global keys (e.g. per-project
 * agent/task caches) in the same pass. Best-effort + storage-failure tolerant.
 */
export function migrateGlobalToScope(globalKey: string, onClaim?: (raw: string) => void): void {
  try {
    const scoped = scopedKey(globalKey);
    if (localStorage.getItem(scoped) !== null) return; // already have scoped data
    const raw = localStorage.getItem(globalKey);
    if (raw === null) return;                          // nothing legacy to claim
    localStorage.setItem(scoped, raw);
    try { onClaim?.(raw); } catch { /* dependent migration best-effort */ }
    localStorage.removeItem(globalKey);
  } catch { /* private mode / quota — skip, reads fall back to empty */ }
}
