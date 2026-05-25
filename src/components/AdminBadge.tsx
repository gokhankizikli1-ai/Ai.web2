/**
 * AdminBadge — small visual chip that appears only for the project owner.
 *
 * Backed by `useOwnerMode()`. Renders NOTHING for normal users; the
 * presence of admin mode is invisible to non-owners.
 *
 * The badge opens the AdminPanel on click.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import AdminPanel from '@/components/AdminPanel';

export default function AdminBadge() {
  const ownerMode = useOwnerMode();
  const [open, setOpen] = useState(false);

  // Non-owner: render nothing. Keeps the badge invisible to ordinary
  // users and avoids any UI hint that admin mode exists.
  if (!ownerMode.isOwner) return null;

  return (
    <>
      <motion.button
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r from-amber-500/[0.08] to-fuchsia-500/[0.08] border border-amber-500/20 hover:border-amber-500/40 transition-all"
        title="Admin Mode — click to open the Owner Panel"
        data-testid="admin-badge"
      >
        <ShieldCheck className="h-3 w-3 text-amber-300" />
        <span className="text-[10px] font-semibold tracking-wide text-amber-200">
          Admin Mode
        </span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <AdminPanel
            ownerMode={ownerMode}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
