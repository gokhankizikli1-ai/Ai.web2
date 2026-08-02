/**
 * VerifyEmail — the email-verification experience.
 *
 * Two modes, decided by the presence of a `token` in the URL fragment
 * (`/#/verify-email?token=...`):
 *
 *   • CONFIRM  — a token is present (the user clicked the email link). We POST it
 *                to /v2/auth/email-verification/confirm exactly once. On success,
 *                for an authenticated session we refresh the user (clearing
 *                `verification_required`) and REDIRECT to /chat; for a tokenless
 *                session we show a "verified — sign in" action.
 *
 *   • PENDING  — no token (the gate sent an unverified account here). We wait for
 *                auth + status to resolve (never flashing the unverified panel),
 *                then show the resend flow plus a "Sign out / Use another account"
 *                action. A guest with no token is redirected to /login.
 *
 * Security: the backend guard is authoritative. This page NEVER lets an unverified
 * account into the app — the removed "Back to app" button used to bounce off
 * ProtectedRoute into a redirect loop. When status resolves to verified we
 * redirect to /chat (after refreshing the user so the gate agrees).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { CheckCircle2, MailCheck, XCircle, Clock, Loader2, RefreshCw, LogOut, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useEmailVerification } from '@/hooks/useEmailVerification';
import { confirmVerification } from '@/lib/verificationApi';
import {
  shouldRedirectAfterConfirm, pendingDecision, type ConfirmPhase,
} from '@/pages/verifyEmailFlow';

export default function VerifyEmail() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const logout = useAuthStore((s) => s.logout);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrating = useAuthStore((s) => s.isHydrating);

  const { status, loading, cooldown, sending, resend, refetch } = useEmailVerification();

  const [phase, setPhase] = useState<ConfirmPhase>('confirming');
  const ran = useRef(false);          // confirm runs exactly once
  const redirected = useRef(false);   // redirect fires exactly once

  // Canonical sign-out: the store's logout clears the user, the persisted
  // session blob, token + owner artifacts, and (via account-scoped hooks) the
  // verification + credit caches. Then land on /login.
  const signOut = useCallback(async () => {
    if (redirected.current) return;
    redirected.current = true;
    try { await logout(); } finally { navigate('/login', { replace: true }); }
  }, [logout, navigate]);

  // Verified → refresh the user so ProtectedRoute agrees, then go to /chat.
  const goToAppVerified = useCallback(async () => {
    if (redirected.current) return;
    redirected.current = true;
    try { await refreshUser(); } catch { /* best-effort */ }
    try { window.dispatchEvent(new Event('korvix:credits-refresh')); } catch { /* ignore */ }
    navigate('/chat', { replace: true });
  }, [refreshUser, navigate]);

  // ── CONFIRM mode — consume the token once ─────────────────────────────────
  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    let cancelled = false;
    (async () => {
      const result = await confirmVerification(token);
      if (cancelled) return;
      setPhase(result);
      // Only auto-enter the app when there is a real session; a link opened in a
      // fresh browser has no auth and must sign in.
      if (shouldRedirectAfterConfirm(result, useAuthStore.getState().isAuthenticated)) {
        void goToAppVerified();
      }
    })();
    return () => { cancelled = true; };
  }, [token, goToAppVerified]);

  // ── PENDING mode — verified elsewhere → redirect; guest → login ───────────
  useEffect(() => {
    if (token) return;                 // confirm effect owns the token flow
    const decision = pendingDecision({ isHydrating, isAuthenticated, loading, status, redirected: redirected.current });
    if (decision === 'redirect-login') {
      if (!redirected.current) { redirected.current = true; navigate('/login', { replace: true }); }
    } else if (decision === 'redirect-chat') {
      void goToAppVerified();
    }
  }, [token, isHydrating, isAuthenticated, loading, status, navigate, goToAppVerified]);

  const resendCta = () => ({
    label: sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new link',
    onClick: resend,
    disabled: sending || cooldown > 0,
  });
  const signOutCta = { label: 'Sign out / Use another account', onClick: () => void signOut(), icon: <LogOut className="w-3.5 h-3.5" /> };
  const loadingPanel = (
    <Panel icon={<Loader2 className="w-7 h-7 text-[#3B82F6] animate-spin" />} title="Just a moment…" body="Checking your verification status." />
  );

  // ── CONFIRM mode UI ────────────────────────────────────────────────────────
  if (token) {
    return (
      <Shell>
        {phase === 'confirming' && (
          <Panel icon={<Loader2 className="w-7 h-7 text-[#3B82F6] animate-spin" />} title="Verifying your email…" body="Hang tight while we confirm your link." />
        )}
        {(phase === 'verified' || phase === 'already_verified') && (
          isAuthenticated
            ? <Panel icon={<CheckCircle2 className="w-7 h-7 text-[#4ADE80]" />} title="Email verified" body="Taking you to KorvixAI…" />
            : <Panel
                icon={<CheckCircle2 className="w-7 h-7 text-[#4ADE80]" />}
                title={phase === 'verified' ? 'Email verified' : 'Already verified'}
                body="Your email is confirmed. Sign in to continue to KorvixAI."
                cta={{ label: 'Go to sign in', onClick: () => navigate('/login', { replace: true }) }}
              />
        )}
        {phase === 'expired' && (
          <Panel
            icon={<Clock className="w-7 h-7 text-[#FACC15]" />}
            title="This link has expired"
            body="Verification links are valid for a short time. Request a fresh one below."
            cta={isAuthenticated ? resendCta() : { label: 'Go to sign in', onClick: () => navigate('/login', { replace: true }) }}
            secondary={isAuthenticated ? signOutCta : undefined}
          />
        )}
        {(phase === 'already_used' || phase === 'superseded' || phase === 'invalid' || phase === 'error') && (
          <Panel
            icon={<XCircle className="w-7 h-7 text-[#F87171]" />}
            title={phase === 'already_used' ? 'Link already used' : phase === 'superseded' ? 'A newer link was sent' : 'This link isn’t valid'}
            body={
              phase === 'already_used'
                ? 'This verification link has already been used. If your email still isn’t verified, request a new link.'
                : phase === 'superseded'
                  ? 'This link was replaced by a newer verification email. Please use the most recent one, or request a fresh link below.'
                  : 'We couldn’t verify this link. Request a new one and try again.'
            }
            cta={isAuthenticated ? resendCta() : { label: 'Go to sign in', onClick: () => navigate('/login', { replace: true }) }}
            secondary={isAuthenticated ? signOutCta : undefined}
          />
        )}
      </Shell>
    );
  }

  // ── PENDING mode UI ─────────────────────────────────────────────────────────
  const decision = pendingDecision({ isHydrating, isAuthenticated, loading, status, redirected: redirected.current });

  // Do not resolve a panel until BOTH auth and the status fetch have settled —
  // this prevents a flash of the "unverified" panel and prevents a stale render
  // while an account switch or redirect is in flight.
  if (decision === 'loading' || decision === 'redirect-login' || decision === 'redirect-chat') {
    return <Shell>{loadingPanel}</Shell>;
  }

  // Authenticated + resolved but status unavailable ⇒ a transient status-API
  // failure. NEVER treat this as verified. Offer retry + sign-out, not a trap.
  if (decision === 'error') {
    return (
      <Shell>
        <Panel
          icon={<AlertCircle className="w-7 h-7 text-[#FACC15]" />}
          title="Couldn’t load your status"
          body="We couldn’t reach the verification service. Please try again."
          cta={{ label: 'Retry', onClick: refetch, icon: <RefreshCw className="w-3.5 h-3.5" /> }}
          secondary={signOutCta}
        />
      </Shell>
    );
  }

  // decision === 'pending' — the real pending screen (status is non-null here).
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
        cta={{
          label: sending ? 'Sending…' : cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend verification email',
          onClick: resend,
          disabled: sending || cooldown > 0,
          icon: <RefreshCw className="w-3.5 h-3.5" />,
        }}
        secondary={signOutCta}
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
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.06] px-4 py-2 text-sm text-[#94A3B8] transition-colors hover:text-white"
        >
          {secondary.icon}
          {secondary.label}
        </button>
      )}
    </div>
  );
}
