/**
 * VerifyEmail — the email-verification experience.
 *
 * Two modes, decided by the presence of a `token` in the URL fragment
 * (`/#/verify-email?token=...`):
 *
 *   • CONFIRM  — a token is present (the user clicked the email link). We POST it
 *                to /v2/auth/email-verification/confirm and render the outcome
 *                (verified / already used / expired / invalid). On success we
 *                refresh the auth session (so `verification_required` clears) and
 *                signal the credit display to refetch (the starter grant just
 *                landed) — the balance is NEVER shown until the backend confirms.
 *
 *   • PENDING  — no token (the user navigated here from the gate). We show the
 *                masked destination email and a cooldown-aware resend button.
 *
 * The raw token rides in the URL *fragment*, which the browser never sends to
 * the server, so it can't leak into backend logs.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { CheckCircle2, MailCheck, XCircle, Clock, Loader2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useEmailVerification } from '@/hooks/useEmailVerification';
import { confirmVerification, type ConfirmStatus } from '@/lib/verificationApi';

type ConfirmPhase = 'confirming' | ConfirmStatus;

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { status, cooldown, sending, resend } = useEmailVerification();

  const [phase, setPhase] = useState<ConfirmPhase>('confirming');
  const ran = useRef(false);

  // CONFIRM mode — run exactly once for the token in the URL.
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    let cancelled = false;
    (async () => {
      const result = await confirmVerification(token);
      if (cancelled) return;
      setPhase(result);
      if (result === 'verified' || result === 'already_verified') {
        // The account is now verified and the starter grant has landed.
        try { await refreshUser(); } catch { /* best-effort */ }
        try { window.dispatchEvent(new Event('korvix:credits-refresh')); } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, [token, refreshUser]);

  const goToApp = () => navigate('/chat');

  // ── CONFIRM mode UI ──────────────────────────────────────────────────────
  if (token) {
    return (
      <Shell>
        {phase === 'confirming' && (
          <Panel
            icon={<Loader2 className="w-7 h-7 text-[#3B82F6] animate-spin" />}
            title="Verifying your email…"
            body="Hang tight while we confirm your link."
          />
        )}
        {(phase === 'verified' || phase === 'already_verified') && (
          <Panel
            icon={<CheckCircle2 className="w-7 h-7 text-[#4ADE80]" />}
            title={phase === 'verified' ? 'Email verified' : 'Already verified'}
            body={
              phase === 'verified'
                ? 'Your account is active and your starter credits are ready.'
                : 'This account was already verified — you’re all set.'
            }
            cta={{ label: 'Continue to KorvixAI', onClick: goToApp }}
          />
        )}
        {phase === 'expired' && (
          <Panel
            icon={<Clock className="w-7 h-7 text-[#FACC15]" />}
            title="This link has expired"
            body="Verification links are valid for a short time. Request a fresh one below."
            cta={isAuthenticated
              ? { label: sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new link', onClick: resend, disabled: sending || cooldown > 0 }
              : { label: 'Go to sign in', onClick: () => navigate('/login') }}
          />
        )}
        {(phase === 'already_used' || phase === 'invalid' || phase === 'error') && (
          <Panel
            icon={<XCircle className="w-7 h-7 text-[#F87171]" />}
            title={phase === 'already_used' ? 'Link already used' : 'This link isn’t valid'}
            body={
              phase === 'already_used'
                ? 'This verification link has already been used. If your email still isn’t verified, request a new link.'
                : 'We couldn’t verify this link. Request a new one and try again.'
            }
            cta={isAuthenticated
              ? { label: sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new link', onClick: resend, disabled: sending || cooldown > 0 }
              : { label: 'Go to sign in', onClick: () => navigate('/login') }}
          />
        )}
      </Shell>
    );
  }

  // ── PENDING mode UI (no token) ─────────────────────────────────────────────
  if (status?.verified) {
    return (
      <Shell>
        <Panel
          icon={<CheckCircle2 className="w-7 h-7 text-[#4ADE80]" />}
          title="You’re verified"
          body="Your email is confirmed and your account is active."
          cta={{ label: 'Continue to KorvixAI', onClick: goToApp }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Panel
        icon={<MailCheck className="w-7 h-7 text-[#3B82F6]" />}
        title="Verify your email"
        body={
          status?.emailMasked
            ? `We sent a verification link to ${status.emailMasked}. Click it to activate your account and unlock your starter credits.`
            : 'Check your inbox for a verification link to activate your account and unlock your starter credits.'
        }
        cta={isAuthenticated
          ? {
              label: sending
                ? 'Sending…'
                : cooldown > 0
                  ? `Resend available in ${cooldown}s`
                  : 'Resend verification email',
              onClick: resend,
              disabled: sending || cooldown > 0,
              icon: <RefreshCw className="w-3.5 h-3.5" />,
            }
          : { label: 'Go to sign in', onClick: () => navigate('/login') }}
        secondary={{ label: 'Back to app', onClick: goToApp }}
      />
    </Shell>
  );
}

/* ── Presentational bits ─────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#0B0F14]">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md"
      >
        {children}
      </motion.div>
    </div>
  );
}

interface CtaProps { label: string; onClick: () => void; disabled?: boolean; icon?: React.ReactNode; }

function Panel({
  icon, title, body, cta, secondary,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: CtaProps;
  secondary?: CtaProps;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#131920] p-8 text-center shadow-2xl">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.03] border border-white/[0.05]">
        {icon}
      </div>
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[#94A3B8]">{body}</p>
      {cta && (
        <button
          onClick={cta.onClick}
          disabled={cta.disabled}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#3B82F6] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2f6fd6] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {cta.icon}
          {cta.label}
        </button>
      )}
      {secondary && (
        <button
          onClick={secondary.onClick}
          className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-white/[0.06] px-4 py-2 text-sm text-[#94A3B8] transition-colors hover:text-white"
        >
          {secondary.label}
        </button>
      )}
    </div>
  );
}
