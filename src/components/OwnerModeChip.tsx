/**
 * OwnerModeChip — owner-mode UI controller.
 *
 * VISIBILITY MODEL (changed from "always visible" → "hidden by default"):
 *
 *   The chip is HIDDEN by default. Normal users never see it.
 *
 *   It becomes visible only when ANY of these are true:
 *     1. /v2/admin/status confirms isOwner=true  → "Owner Session Active"
 *        (full unlocked chip)
 *     2. localStorage has a stored owner token (`korvix_owner_token`)
 *        → the user has at least tried to unlock; show a small status
 *        chip so they can see / retry / forget the token
 *     3. URL query `?owner=1`  → discoverable bootstrap from a link
 *        the project owner sends to themselves
 *     4. localStorage `korvix_dev_unlock=1`  → persistent dev-only flag
 *
 *   Owner unlock is also reachable via a KEYBOARD SHORTCUT:
 *     Ctrl/Cmd + Shift + O  → opens OwnerUnlockModal regardless of
 *                              chip visibility. This is the canonical
 *                              entry point for the project owner on a
 *                              fresh browser — they don't need any
 *                              visible UI to bootstrap.
 *
 * STATE → UI mapping:
 *   isOwner = true           → amber "Owner Session Active" chip,
 *                              click opens AdminPanel
 *   hasStoredToken = true    → grey "Owner (verifying)" chip with a
 *                              warning dot if the most recent status
 *                              call reported a mismatch, click opens
 *                              modal to fix / forget the token
 *   neither + shortcut hit   → modal opens, chip stays hidden
 *
 * RATIONALE for hiding:
 *   The previous "Owner" button was visible to everyone, which leaked
 *   admin existence + invited probing. The keyboard-shortcut path is
 *   discoverable to the owner without being discoverable to a casual
 *   visitor. The chip only ever appears after the owner has acted
 *   (stored a token, hit the shortcut, or actually unlocked).
 */
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ShieldAlert, KeyRound } from 'lucide-react';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useAuthStore } from '@/stores/authStore';
import OwnerUnlockModal from './OwnerUnlockModal';
import AdminPanel from './AdminPanel';

const TOKEN_KEY = 'korvix_owner_token';
const DEV_FLAG_KEY = 'korvix_dev_unlock';

function readToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) || ''; }
  catch { return ''; }
}
function readDevFlag(): boolean {
  try { return localStorage.getItem(DEV_FLAG_KEY) === '1'; }
  catch { return false; }
}
function readUrlBootstrap(): boolean {
  try {
    // Hash router → check the hash query string in addition to search.
    const fromSearch = new URLSearchParams(window.location.search).get('owner') === '1';
    const hash = window.location.hash || '';
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
    const fromHash = new URLSearchParams(hashQuery).get('owner') === '1';
    return fromSearch || fromHash;
  } catch {
    return false;
  }
}

export default function OwnerModeChip() {
  const ownerMode = useOwnerMode();
  // Read the authStore so we can flip the chip to "Owner Session Active"
  // IMMEDIATELY on Google/email login when the backend's _annotate_owner
  // already stamped is_owner=true on the user dict, without waiting for
  // the second /v2/admin/status round trip.
  const authUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const authSaysOwner = !!(isAuthenticated && authUser?.is_owner);

  const [unlockOpen, setUnlockOpen] = useState(false);
  const [panelOpen, setPanelOpen]   = useState(false);

  // Re-evaluate visibility-driving localStorage / URL state on the
  // same global event the modal dispatches so the chip can appear
  // immediately after a paste without a page reload.
  const [storageTick, setStorageTick] = useState(0);
  const bump = useCallback(() => setStorageTick((n) => n + 1), []);

  useEffect(() => {
    const handler = () => {
      bump();
      ownerMode.refresh();
    };
    window.addEventListener('korvix:owner-refresh', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('korvix:owner-refresh', handler);
      window.removeEventListener('storage', handler);
    };
  }, [bump, ownerMode]);

  // Global keyboard shortcut: Ctrl/Cmd+Shift+O opens the unlock modal
  // even when the chip is hidden. This is the canonical bootstrap for
  // the project owner on a fresh browser.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        e.preventDefault();
        setUnlockOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Event-driven open — the three-dot menu's "Owner Mode" entry
  // dispatches korvix:owner-unlock-open. Single source of truth for
  // opening the modal regardless of entry point (chip click, keyboard
  // shortcut, menu entry).
  useEffect(() => {
    const handler = () => setUnlockOpen(true);
    window.addEventListener('korvix:owner-unlock-open', handler);
    return () => window.removeEventListener('korvix:owner-unlock-open', handler);
  }, []);

  // Visibility decision. The hook (useOwnerMode) supplies the
  // confirmed-owner signal; localStorage / URL supply the
  // "user is attempting" signal.
  const hasStoredToken = readToken().length > 0;
  const devUnlock      = readDevFlag();
  const urlBootstrap   = readUrlBootstrap();
  // storageTick is read so the variable references it on every render
  // — see comment on the bump() declaration.
  void storageTick;

  // Confirmed owner via either signal:
  //   - useOwnerMode (the canonical, backend-verified flag)
  //   - authStore.user.is_owner (set by the login response — flips the
  //     chip the instant Google/email login succeeds, before the
  //     /v2/admin/status re-fetch finishes)
  const confirmedOwner = ownerMode.isOwner || authSaysOwner;
  // During auth hydration we render NOTHING. Otherwise a fresh page
  // load would briefly flash the chip in its locked-but-token-stored
  // variant before the persisted user's is_owner is read in.
  if (isHydrating) {
    return null;
  }
  const visible = confirmedOwner || hasStoredToken || devUnlock || urlBootstrap;

  // ── Unlocked: full "Owner Session Active" chip ────────────────────────
  if (visible && confirmedOwner) {
    return (
      <>
        <motion.button
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-500/[0.12] to-fuchsia-500/[0.10] border border-amber-500/30 hover:border-amber-500/55 transition-all shrink-0"
          title="Owner Session Active — click to open the Owner Panel"
          data-testid="owner-mode-chip-unlocked"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-300" />
          </span>
          <ShieldCheck className="h-3 w-3 text-amber-300" />
          <span className="text-[10px] font-semibold tracking-wide text-amber-200 whitespace-nowrap hidden sm:inline">
            Owner Session Active
          </span>
        </motion.button>
        <AnimatePresence>
          {panelOpen && (
            <AdminPanel
              ownerMode={ownerMode}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  // ── Stored-but-not-confirmed: warn chip, click to re-validate ────────
  if (visible) {
    const verifying = ownerMode.loading;
    const reason = ownerMode.debug?.first_failure || ownerMode.error || 'not verified';
    return (
      <>
        <motion.button
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => setUnlockOpen(true)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-rose-500/[0.05] border border-rose-500/20 hover:bg-rose-500/[0.08] hover:border-rose-500/35 transition-all shrink-0"
          title={`Owner token saved but not validated: ${reason}. Click to fix.`}
          data-testid="owner-mode-chip-pending"
        >
          <ShieldAlert className="h-3 w-3 text-rose-300" />
          <span className="text-[10px] font-medium text-rose-200 whitespace-nowrap hidden sm:inline">
            {verifying ? 'Verifying…' : 'Owner: invalid'}
          </span>
        </motion.button>
        <AnimatePresence>
          {unlockOpen && (
            <OwnerUnlockModal onClose={() => setUnlockOpen(false)} />
          )}
        </AnimatePresence>
      </>
    );
  }

  // ── Hidden: render only the modal mount so the keyboard shortcut
  //     can still open it. No visible UI for normal users. ─────────────
  return (
    <AnimatePresence>
      {unlockOpen && (
        <OwnerUnlockModal onClose={() => setUnlockOpen(false)} />
      )}
    </AnimatePresence>
  );
}

/** Subtle reminder of the shortcut for the owner. Exported separately
 * so the Admin Panel can show it in the help section.
 * (Not rendered by default — see SettingsPage if we want a help row.) */
export const OWNER_UNLOCK_SHORTCUT = 'Ctrl/Cmd + Shift + O';
export { KeyRound as OwnerUnlockShortcutIcon };
