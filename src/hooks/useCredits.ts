/**
 * useCredits — the account-scoped credit balance for the UI (Phase 1).
 *
 * Reads the server-authoritative snapshot (`getMyCredits` → GET
 * /v2/billing/credits/me) for the CURRENTLY authenticated user. Keyed to the
 * auth user id so switching accounts refetches and the previous balance is
 * cleared immediately (no stale flash); not persisted, so logout leaks nothing.
 *
 * Loading is neutral (`balance = null`) — the UI must NOT show a fabricated
 * number while loading or on error. A guest / disabled ledger / failed call all
 * resolve to `balance = null` (neutral), never a fake value.
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { getMyCredits, type CreditSummary } from '@/lib/creditsApi';

export interface CreditsState {
  /** Current balance, or null while loading / unknown / on failure (neutral). */
  balance: number | null;
  /** Full snapshot when available (lifetime totals), else null. */
  summary: CreditSummary | null;
  /** True while the authoritative fetch for the current user is in flight. */
  loading: boolean;
  /** Re-fetch (e.g. after a spend or a grant). */
  refetch: () => void;
}

export function useCredits(): CreditsState {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const uid = user?.id ?? null;

  const [summary, setSummary] = useState<CreditSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !uid) {
      setSummary(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Clear the previous account's snapshot immediately so switching accounts
    // never flashes the prior balance.
    setSummary(null);
    setLoading(true);
    getMyCredits()
      .then((s) => { if (!cancelled) setSummary(s); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uid, isAuthenticated, nonce]);

  // Neutral until we have an authoritative, enabled snapshot. A disabled ledger
  // (enabled:false) also shows neutral rather than a hard 0.
  const balance = summary && summary.enabled ? summary.balance : null;

  return {
    balance,
    summary,
    loading,
    refetch: () => setNonce((n) => n + 1),
  };
}
