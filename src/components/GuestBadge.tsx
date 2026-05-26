import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, X } from 'lucide-react';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useAuthStore } from '@/stores/authStore';

export default function GuestBadge() {
  const [visible, setVisible] = useState(true);
  // Hide for owner-mode sessions (OWNER_TOKEN unlock) AND for any
  // signed-in user (Google / email / Apple). Without this, a logged-in
  // user would still see "Guest mode" beside their name, which is a
  // direct contradiction.
  const { isOwner } = useOwnerMode();
  const { isAuthenticated } = useAuthStore();
  const suppressed = isOwner || isAuthenticated;

  useEffect(() => {
    const dismissed = localStorage.getItem('korvix_guest_dismissed');
    if (dismissed) setVisible(false);
  }, []);

  const dismiss = () => {
    setVisible(false);
    localStorage.setItem('korvix_guest_dismissed', 'true');
  };

  return (
    <AnimatePresence>
      {visible && !suppressed && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/[0.06] border border-cyan-500/10"
        >
          <User className="h-3 w-3 text-cyan-400" />
          <span className="text-[11px] text-cyan-300/80">Guest mode</span>
          <button onClick={dismiss} className="ml-1 text-cyan-400/40 hover:text-cyan-300 transition-colors">
            <X className="h-3 w-3" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
