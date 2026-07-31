/**
 * VerifyEmailBanner — a persistent prompt shown to authenticated users whose
 * email is not yet verified (backend flag `verification_required`). It makes the
 * gate visible ("the app is not fully usable yet") and offers a one-click resend
 * with a live cooldown, plus a link to the full verification screen.
 *
 * Renders NOTHING when verification isn't required (feature off, guest, or
 * already verified), so it's inert until an operator enables enforcement.
 * Hiding this banner is NOT the security control — the backend
 * require_verified_identity guard is; this is the UX surface.
 */
import { useNavigate } from 'react-router';
import { MailWarning, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useEmailVerification } from '@/hooks/useEmailVerification';

export default function VerifyEmailBanner() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { status, cooldown, sending, resend } = useEmailVerification();

  // Show only when the backend says verification is required for this account.
  // We trust either the user annotation OR the live status endpoint — whichever
  // is available — but never invent the requirement.
  const required =
    isAuthenticated &&
    (user?.verification_required === true || status?.verificationRequired === true) &&
    !(status?.verified === true);

  if (!required) return null;

  return (
    <div className="w-full border-b border-[#FACC15]/15 bg-[#FACC15]/[0.06] px-4 py-2.5">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-[#FACC15]" />
          <p className="text-[13px] leading-snug text-[#E7C948]">
            <span className="font-medium text-[#FACC15]">Verify your email</span>
            {status?.emailMasked ? ` — we sent a link to ${status.emailMasked}. ` : ' to unlock your credits and build features. '}
            Some actions stay locked until you confirm it.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={resend}
            disabled={sending || cooldown > 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#FACC15]/25 bg-[#FACC15]/[0.08] px-2.5 py-1 text-[12px] font-medium text-[#FACC15] transition-colors hover:bg-[#FACC15]/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />
            {sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
          </button>
          <button
            onClick={() => navigate('/verify-email')}
            className="rounded-md px-2.5 py-1 text-[12px] text-[#94A3B8] transition-colors hover:text-white"
          >
            Details
          </button>
        </div>
      </div>
    </div>
  );
}
