/**
 * OwnerWelcomeToast — premium one-shot welcome animation that fires
 * when an owner session activates.
 *
 * Mounted globally in AppLayout. Subscribes to useOwnerMode and
 * useAuthStore. Tracks the isOwner transition false → true and
 * shows a single toast per session:
 *
 *   "Hoş geldiniz Gökhan Bey • Owner Session Activated"
 *
 * Design:
 *   - Bottom-centred chip, lifted above any chat input / bottom-nav
 *   - Amber gradient + soft glow + subtle pulse on the accent dot
 *   - 4.5 second auto-dismiss with manual × close
 *   - sessionStorage flag so a reload doesn't replay
 *   - Renders NOTHING for non-owners, ever — gated by isOwner
 *
 * NOT a redesign: just a new floating element. No layout shifts.
 * No other components touch this; if anyone wants to suppress it
 * they can clear sessionStorage["korvix_owner_welcome_shown"].
 */
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Sparkles, X } from 'lucide-react';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useAuthStore } from '@/stores/authStore';

const SHOWN_KEY = 'korvix_owner_welcome_shown';
const SHOW_MS = 4500;

function isAlreadyShown(): boolean {
  try { return sessionStorage.getItem(SHOWN_KEY) === '1'; }
  catch { return false; }
}
function markShown(): void {
  try { sessionStorage.setItem(SHOWN_KEY, '1'); }
  catch { /* ignore */ }
}

/** Tailor the greeting to the user's display name. Best-effort —
 *  Turkish convention is "<First Name> Bey" for men / "<First Name>
 *  Hanım" for women. We only know the name (not the gender) so we
 *  use "Bey" by default — the user explicitly asked for "Gökhan Bey"
 *  in the spec. Falls back to a neutral "Welcome back" when no
 *  display name is known. */
function buildGreeting(displayName?: string): string {
  const name = (displayName || '').trim();
  if (!name) return 'Welcome back. Owner Session aktif edildi.';
  const first = name.split(/\s+/)[0];
  // Exact wording from the spec — Turkish, executive register.
  // "aktif edildi" reads more formal/respectful than "activated".
  return `Hoş geldiniz ${first} Bey. Owner Session aktif edildi.`;
}

/** Routes the toast is FORBIDDEN to render on, no matter what the
 *  parent decides. Defence-in-depth alongside the App.tsx
 *  `!isPublicRoute && <OwnerWelcomeToast />` gate. */
const FORBIDDEN_PATH_PREFIXES = [
  '/',          // landing — exact match handled separately below
  '/features',
  '/use-cases',
  '/pricing',
  '/about',
  '/login',
  '/signup',
  '/blog',
  '/careers',
  '/privacy',
  '/terms',
];

function isPathPublic(pathname: string): boolean {
  if (pathname === '/') return true;
  return FORBIDDEN_PATH_PREFIXES.some((p) => p !== '/' && pathname.startsWith(p));
}

export default function OwnerWelcomeToast() {
  const { isOwner } = useOwnerMode();
  const authUser = useAuthStore((s) => s.user);
  // Gate on hydration so a fresh page load with persisted owner state
  // doesn't replay the welcome toast every time the user reloads.
  // Combined with the sessionStorage "shown" guard below: even if
  // isOwner transitions during hydration, we only fire AFTER hydration
  // settles. Hard reload behaviour stays "shown once per session".
  const isHydrating = useAuthStore((s) => s.isHydrating);

  // Visible state — only true during the 4.5s animation window.
  const [visible, setVisible] = useState(false);
  // Sticky-once-per-session guard. Tracked locally so we don't
  // re-trigger if isOwner briefly flickers (e.g. /v2/admin/status
  // refresh while authStore is also updating).
  const firedRef = useRef<boolean>(isAlreadyShown());
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isHydrating) return;     // wait for definitive auth resolution
    if (!isOwner) return;
    // Defence-in-depth route guard. Spec: "Owner toast must only
    // render inside authenticated app shell". App.tsx already gates
    // this component on !isPublicRoute, but a regression there could
    // silently flash the toast on the landing page where a casual
    // visitor would see it.
    try {
      if (isPathPublic(window.location.pathname)) return;
    } catch { /* ignore — let the App.tsx gate win */ }
    // Also require an authenticated user OR a known display name so
    // we never show "Hoş geldiniz Bey" with no name on a half-broken
    // session state.
    if (!authUser?.email && !authUser?.name) return;
    if (firedRef.current) return;
    firedRef.current = true;
    markShown();
    setVisible(true);
    dismissTimerRef.current = setTimeout(() => setVisible(false), SHOW_MS);
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }
    };
  }, [isOwner, isHydrating]);

  const greeting = buildGreeting(authUser?.name || authUser?.email?.split('@')[0]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.92 }}
          animate={{ opacity: 1, y: 0,  scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="fixed left-1/2 -translate-x-1/2 z-[70] pointer-events-auto"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)' }}
          role="status"
          aria-live="polite"
          data-testid="owner-welcome-toast"
        >
          <div
            className="relative flex items-center gap-3 px-4 py-2.5 rounded-full overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(59, 130, 246,0.16) 0%, rgba(156, 187, 209,0.12) 100%)',
              border: '1px solid rgba(59, 130, 246,0.30)',
              backdropFilter: 'blur(14px) saturate(1.1)',
              boxShadow:
                '0 12px 32px -10px rgba(59, 130, 246,0.35), ' +
                '0 4px 12px rgba(0,0,0,0.45), ' +
                'inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            {/* Animated shimmer — a soft amber sweep that crosses the
                chip once on mount. Pure CSS via motion.div so no
                additional dep is needed. */}
            <motion.div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(120deg, transparent 30%, rgba(156, 187, 209,0.20) 50%, transparent 70%)',
                mixBlendMode: 'screen',
              }}
              initial={{ x: '-120%' }}
              animate={{ x: '120%' }}
              transition={{ duration: 1.4, ease: 'easeOut', delay: 0.1 }}
            />

            {/* Status dot — pulsing amber to mirror the OwnerModeChip's
                "live" indicator. */}
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#60A5FA] opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#60A5FA]" />
            </span>

            <ShieldCheck className="h-3.5 w-3.5 text-[#60A5FA] shrink-0" />

            <span className="text-[12px] font-medium text-[#F8FAFC] tracking-tight whitespace-nowrap">
              {greeting}
            </span>

            <Sparkles className="h-3 w-3 text-[#60A5FA]/70 shrink-0" />

            <button
              onClick={() => {
                if (dismissTimerRef.current) {
                  clearTimeout(dismissTimerRef.current);
                  dismissTimerRef.current = null;
                }
                setVisible(false);
              }}
              className="ml-1 h-5 w-5 flex items-center justify-center rounded-full text-[#60A5FA]/60 hover:text-[#F8FAFC] hover:bg-white/[0.05] transition-all"
              aria-label="Dismiss welcome message"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
