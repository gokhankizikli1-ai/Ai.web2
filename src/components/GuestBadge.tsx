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
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#52677A]/[0.06] border border-[#52677A]/10"
        >
          <User className="h-3 w-3 text-[#52677A]" />
          <span className="text-[11px] text-[#7890A3]/80">Guest mode</span>
          <button onClick={dismiss} className="ml-1 text-[#52677A]/40 hover:text-[#7890A3] transition-colors">
            <X className="h-3 w-3" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
