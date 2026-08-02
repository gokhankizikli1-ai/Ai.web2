/**
 * useEmailVerification — account-scoped email-verification state for the UI.
 *
 * Reads the server-authoritative status (GET /v2/auth/email-verification/status)
 * for the current user, exposes a cooldown-aware resend action, and never
 * fabricates state (null while loading / on failure). Keyed to the auth user id
 * so switching accounts refetches and clears the prior snapshot.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import {
  getVerificationStatus,
  resendVerification,
  type VerificationStatus,
} from '@/lib/verificationApi';

export interface EmailVerificationState {
  status: VerificationStatus | null;
  loading: boolean;
  /** Seconds until another resend is allowed (0 = allowed now). */
  cooldown: number;
  /** True while a resend request is in flight. */
  sending: boolean;
  /** Trigger a resend; updates cooldown from the backend response. */
  resend: () => Promise<void>;
  refetch: () => void;
}

export function useEmailVerification(): EmailVerificationState {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const uid = user?.id ?? null;

  const [status, setStatus] = useState<VerificationStatus | null>(null);
  // Start UNRESOLVED (loading=true) so the first paint never flashes the
  // "unverified" panel before the authoritative status has been fetched. The
  // effect below flips it false once the fetch settles (or for a guest).
  const [loading, setLoading] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [nonce, setNonce] = useState(0);
  const tick = useRef<number | null>(null);

  // Fetch status for the current account.
  useEffect(() => {
    if (!isAuthenticated || !uid) {
      setStatus(null);
      setLoading(false);
      setCooldown(0);
      return;
    }
    let cancelled = false;
    setStatus(null);
    setLoading(true);
    const ctrl = new AbortController();
    getVerificationStatus({ signal: ctrl.signal })
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (s && s.cooldownRemaining > 0) setCooldown(s.cooldownRemaining);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; ctrl.abort(); };
  }, [uid, isAuthenticated, nonce]);

  // Cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    tick.current = window.setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => { if (tick.current) window.clearInterval(tick.current); };
  }, [cooldown > 0]);

  const resend = useCallback(async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    try {
      const res = await resendVerification();
      if (res.cooldownRemaining > 0) setCooldown(res.cooldownRemaining);
      else if (res.sent) setCooldown(60);
    } finally {
      setSending(false);
    }
  }, [sending, cooldown]);

  return {
    status,
    loading,
    cooldown,
    sending,
    resend,
    refetch: () => setNonce((n) => n + 1),
  };
}
