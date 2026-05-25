/**
 * OwnerModeChip — the visible entry point for Owner Mode.
 *
 * ALWAYS rendered in the top bar. Two visual states:
 *
 *   LOCKED  (default for everyone, including the owner on a fresh
 *            browser) — small outline shield icon labelled "Owner".
 *            Click opens OwnerUnlockModal where the owner pastes
 *            their OWNER_TOKEN.
 *
 *   UNLOCKED  (after useOwnerMode confirms isOwner=true) — amber
 *             gradient pill with a pulsing dot and the label
 *             "Owner Session Active". Click opens AdminPanel.
 *
 * Replaces the previous AdminBadge + invisible-when-locked behaviour
 * that left the owner with no way to bootstrap from the UI.
 *
 * Non-owners see only the locked icon. They can click it, they can
 * type into the modal — but every wrong token is rejected by the
 * backend's constant-time compare. Worst case: they learn admin
 * mode exists; they still cannot use it without the secret.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ShieldQuestion } from 'lucide-react';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import OwnerUnlockModal from './OwnerUnlockModal';
import AdminPanel from './AdminPanel';

export default function OwnerModeChip() {
  const ownerMode = useOwnerMode();
  const [panelOpen, setPanelOpen]   = useState(false);

  // useOwnerMode listens for this event to re-fetch /v2/admin/status
  // after the user submits a token through OwnerUnlockModal.
  useEffect(() => {
    const handler = () => { ownerMode.refresh(); };
    window.addEventListener('korvix:owner-refresh', handler);
    return () => window.removeEventListener('korvix:owner-refresh', handler);
  }, [ownerMode]);

  // Decide which state to render. The locked chip is the entry point;
  // the unlocked chip opens the panel.
  if (ownerMode.isOwner) {
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
          <span className="text-[10px] font-semibold tracking-wide text-amber-200 whitespace-nowrap">
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

  return <LockedOwnerChip />;
}

function LockedOwnerChip() {
  const [unlockOpen, setUnlockOpen] = useState(false);

  // Locked state — visible to everyone, harmless click target. Keeping
  // this state in a branch component resets it when owner mode unlocks.
  return (
    <>
      <motion.button
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => setUnlockOpen(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.10] transition-all shrink-0"
        title="Owner Mode — paste your OWNER_TOKEN to unlock"
        data-testid="owner-mode-chip-locked"
      >
        <ShieldQuestion className="h-3 w-3 text-slate-500" />
        <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">
          Owner
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
