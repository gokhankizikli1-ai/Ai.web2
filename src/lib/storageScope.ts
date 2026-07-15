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

/**
 * Fired whenever the active identity changes (login / logout / account switch),
 * so mounted React trees can rehydrate their in-memory copy of scoped data. The
 * scope itself is derived synchronously from localStorage, so listeners can call
 * `currentStorageScope()` to learn the NEW identity and dedupe redundant fires.
 */
export const IDENTITY_CHANGED_EVENT = 'korvix:identity-changed';

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

/* ─── Legacy-global OWNERSHIP (Phase 14D.2) ──────────────────────────────────
 *
 * Legacy GLOBAL keys (pre-scoping `korvix_projects`, `korvix_saved_prompts`,
 * `korvix_standalone_agents`, per-project agent/task caches …) predate identity
 * scoping and belong to whoever used this browser before scoping existed. They
 * must be owned by AT MOST ONE authenticated user. A single global marker
 * records that owner:
 *
 *   korvix_legacy_claimed_by = user_<id>
 *
 * The first authenticated claimant writes the marker BEFORE any global key is
 * read/moved/removed; every later identity — guest or a different user — is
 * locked out of reading, copying, merging, quarantining or deleting the legacy
 * data. The marker survives logout (it is NOT an auth artifact), so the same
 * browser keeps one stable legacy owner. It holds only the opaque scope string
 * — no email, token or personal data.
 *
 * The generic helpers here do ONLY ownership + raw IO. The owning store decides
 * how to parse / merge / quarantine its own schema. */
export const LEGACY_CLAIM_KEY = 'korvix_legacy_claimed_by';

/** A validated, owner-locked handle to one legacy global key's raw value. */
export interface LegacyClaim {
  /** The owning identity scope, always `user_<id>`. */
  scope: string;
  /** The legacy GLOBAL key being claimed. */
  globalKey: string;
  /** The per-identity destination key the owning store should write. */
  scopedKey: string;
  /** The raw legacy value (owner decides how to parse it). */
  raw: string;
}

/** True only for an authenticated owner scope (`user_*`). */
function isOwnerScope(scope: string): boolean {
  return scope.startsWith('user_');
}

/**
 * Ownership + read gate for a legacy GLOBAL key. Returns a {@link LegacyClaim}
 * the OWNING STORE can safely parse/merge/quarantine, or `null` when the current
 * identity must not touch the data — i.e. it is a guest, the global key holds
 * nothing, the ownership marker belongs to a DIFFERENT user, or storage failed.
 *
 * When no marker exists yet, the first authenticated caller RESERVES ownership
 * (marker ← its scope) BEFORE returning the raw value, using a compare-after-
 * write to reduce (not eliminate) cross-tab races. This never writes the scoped
 * destination or removes the global key — the caller does that with
 * {@link quarantineLegacyGlobal} / {@link dropLegacyGlobal} once it has safely
 * persisted the data.
 */
export function claimLegacyGlobal(globalKey: string): LegacyClaim | null {
  try {
    const scope = currentStorageScope();
    if (!isOwnerScope(scope)) return null;            // guests never claim
    let raw: string | null = null;
    try { raw = localStorage.getItem(globalKey); } catch { return null; }
    if (raw === null) return null;                    // nothing legacy for this key
    // Establish / verify the single ownership marker before the caller removes
    // anything. Only reserve when there is real data to own.
    let owner: string | null = null;
    try { owner = localStorage.getItem(LEGACY_CLAIM_KEY); } catch { return null; }
    if (owner === null) {
      try {
        localStorage.setItem(LEGACY_CLAIM_KEY, scope);
        if (localStorage.getItem(LEGACY_CLAIM_KEY) !== scope) return null; // lost a race
      } catch { return null; }
    } else if (owner !== scope) {
      return null;                                    // owned by another user — hands off
    }
    return { scope, globalKey, scopedKey: `${globalKey}_${scope}`, raw };
  } catch { return null; }
}

/** True when the current identity owns (or may still reserve) the legacy marker. */
function currentOwnsLegacyMarker(): boolean {
  try {
    const scope = currentStorageScope();
    if (!isOwnerScope(scope)) return false;
    let owner: string | null = null;
    try { owner = localStorage.getItem(LEGACY_CLAIM_KEY); } catch { return false; }
    return owner === null || owner === scope;
  } catch { return false; }
}

/**
 * Remove a legacy GLOBAL source key. Only the marker owner may do so, and only
 * AFTER the owning store has safely written its scoped destination or a
 * quarantine backup. A no-op for any non-owner (defence in depth).
 */
export function dropLegacyGlobal(globalKey: string): void {
  try {
    if (!currentOwnsLegacyMarker()) return;
    localStorage.removeItem(globalKey);
  } catch { /* private mode / quota — leave the global key intact */ }
}

/**
 * Preserve raw legacy data that could not be safely merged under an OWNER-scoped
 * backup key so it is never lost and never surfaced in the UI:
 *
 *   korvix_legacy_backup_<globalKey>_<userScope>[ _<n> ]
 *
 * An existing non-empty backup is never overwritten — a deterministic numeric
 * suffix is used instead. Returns `true` only once the raw value is verifiably
 * persisted (so the caller may then {@link dropLegacyGlobal}); on any failure it
 * returns `false` and the caller must leave the global key untouched.
 */
export function quarantineLegacyGlobal(globalKey: string, raw: string): boolean {
  try {
    const scope = currentStorageScope();
    if (!currentOwnsLegacyMarker()) return false;
    const base = `korvix_legacy_backup_${globalKey}_${scope}`;
    let key = base;
    for (let n = 0; ; n += 1) {
      let existing: string | null = null;
      try { existing = localStorage.getItem(key); } catch { return false; }
      if (existing === null || existing === '') break;   // free slot
      if (existing === raw) return true;                 // already quarantined — idempotent
      if (n >= 50) return false;                          // pathological — give up, keep global
      key = `${base}_${n + 1}`;
    }
    localStorage.setItem(key, raw);
    return localStorage.getItem(key) === raw;            // verify before caller drops global
  } catch { return false; }
}

/**
 * Boot-time ownership RESERVATION (kept under its original name so authStore's
 * boot block needs no change). The authenticated owner claims the single legacy
 * marker so no other account can later grab this browser's legacy data; the
 * actual schema-aware move / merge / quarantine happens in each owning store's
 * load path via {@link claimLegacyGlobal}. Guests never reserve; a marker owned
 * by another user is left untouched. Best-effort + storage-failure tolerant.
 */
export function migrateGlobalToScope(globalKey: string): void {
  try { claimLegacyGlobal(globalKey); } catch { /* best-effort reservation */ }
}
