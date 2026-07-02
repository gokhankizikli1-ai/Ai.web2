/**
 * OwnerUnlockModal — paste an OWNER_TOKEN and validate it against
 * the backend.
 *
 * Why this exists: without this, the project owner had to run
 *   localStorage.setItem('korvix_owner_token', '<value>')
 * in the browser console before any admin UI would appear.
 *
 * Flow:
 *   1. Owner pastes the token configured on Railway (OWNER_TOKEN).
 *   2. We write it to localStorage AND call /v2/admin/status with
 *      `X-Korvix-Owner-Token: <token>` header.
 *   3. If backend responds data.is_owner=true:
 *        • show a loud success banner
 *        • dispatch `korvix:owner-refresh` so every useOwnerMode
 *          instance re-fetches and chip flips to "Owner Session Active"
 *        • close after a short dwell
 *   4. If backend responds data.is_owner=false:
 *        • do NOT clear the token (owner may want to retry after
 *          fixing OWNER_TOKEN on Railway — clearing forces a re-paste)
 *        • show the server's `data.reason` so the owner sees the
 *          exact backend-side mismatch
 *   5. `Forget token` wipes localStorage and refreshes state.
 *
 * Design intent:
 *   - Token-only auth path. The owner does NOT need to be signed in
 *     via /v2/auth/* — the OWNER_TOKEN IS the credential. The modal
 *     surfaces this explicitly so the owner understands.
 *   - Errors surface the backend's stable reason string, never a
 *     generic "something went wrong".
 *   - "Sign in required" branch is shown only when the backend
 *     reason indicates an identity-path failure that requires auth.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Key, Loader2, ShieldCheck, AlertTriangle, Trash2, LogIn,
} from 'lucide-react';

const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_BASE = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}`;

const TOKEN_KEY = 'korvix_owner_token';

interface OwnerUnlockModalProps {
  onClose: () => void;
}

type Result =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; capabilitiesCount: number }
  | { kind: 'denied'; reason: string; signInRequired: boolean }
  | { kind: 'network-error'; message: string };

function debugLog(...args: unknown[]): void {
  try {
    if (localStorage.getItem('korvix_debug') === '1') {
      // eslint-disable-next-line no-console
      console.debug('[OwnerUnlockModal]', ...args);
    }
  } catch { /* ignore */ }
}

export default function OwnerUnlockModal({ onClose }: OwnerUnlockModalProps) {
  const [token, setToken] = useState<string>('');
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Prefill with whatever is already stored so the owner can see/edit
  // the current value, not type from scratch.
  useEffect(() => {
    try {
      const existing = localStorage.getItem(TOKEN_KEY);
      if (existing) setToken(existing);
    } catch { /* ignore */ }
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  // Esc closes — but only when not in the middle of a request.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && result.kind !== 'checking') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose, result.kind]);

  const validate = async (): Promise<void> => {
    const trimmed = token.trim();
    if (trimmed.length < 16) {
      setResult({
        kind: 'denied',
        reason: 'Token must be at least 16 characters. Generate on the server with `python -c "import secrets; print(secrets.token_urlsafe(32))"` then set OWNER_TOKEN on Railway.',
        signInRequired: false,
      });
      return;
    }

    // Write the token BEFORE the request so:
    //   (a) the chip's useOwnerMode picks it up if it re-fetches in
    //       parallel.
    //   (b) the visibility logic in OwnerModeChip sees a stored token
    //       and surfaces the pending chip even if the modal is dismissed.
    try { localStorage.setItem(TOKEN_KEY, trimmed); }
    catch (e) { debugLog('localStorage.setItem failed:', e); }

    setResult({ kind: 'checking' });

    try {
      debugLog('POST', `${API_BASE}/v2/admin/status`);
      const r = await fetch(`${API_BASE}/v2/admin/status`, {
        method: 'GET',
        headers: {
          'Content-Type':         'application/json',
          'X-Korvix-Owner-Token': trimmed,
        },
      });
      debugLog('response status:', r.status);

      if (r.status === 404) {
        setResult({
          kind: 'denied',
          reason: 'Backend returned 404. ENABLE_ADMIN_MODE is not set on Railway, or the deploy has not picked up the env yet.',
          signInRequired: false,
        });
        return;
      }
      const body = await r.json();
      debugLog('body:', body);
      const data = (body?.data ?? {}) as {
        is_owner?: boolean;
        reason?: string;
        capabilities?: string[];
        debug?: { first_failure?: string };
      };

      if (data.is_owner) {
        setResult({
          kind: 'ok',
          capabilitiesCount: data.capabilities?.length ?? 0,
        });
        // Tell every useOwnerMode instance to re-fetch. The chip will
        // flip to "Owner Session Active" within ~100ms.
        try { window.dispatchEvent(new CustomEvent('korvix:owner-refresh')); }
        catch { /* ignore */ }
        // Also fire a storage event manually — same-tab listeners on
        // `storage` only fire across tabs by default, but the
        // OwnerModeChip's bump() handler subscribes to BOTH our custom
        // event and `storage`, so this is just defence-in-depth.
        return;
      }

      const failReason =
        data.reason ||
        data.debug?.first_failure ||
        'Token rejected by the backend.';
      const signInRequired = /guest|sign in|authentic/i.test(failReason);
      setResult({ kind: 'denied', reason: failReason, signInRequired });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown';
      debugLog('fetch threw:', message);
      setResult({ kind: 'network-error', message });
    }
  };

  // Close button — also fires the refresh event in case the chip is
  // mounted but stale. Cheap defence against any race where the
  // success path's dispatch was dropped.
  const closeAndRefresh = (): void => {
    try { window.dispatchEvent(new CustomEvent('korvix:owner-refresh')); }
    catch { /* ignore */ }
    onClose();
  };

  const forget = (): void => {
    try { localStorage.removeItem(TOKEN_KEY); }
    catch { /* ignore */ }
    setToken('');
    setResult({ kind: 'idle' });
    try { window.dispatchEvent(new CustomEvent('korvix:owner-refresh')); }
    catch { /* ignore */ }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={() => result.kind !== 'checking' && closeAndRefresh()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-[#52677A]/20 bg-[#0b0b12]/95 shadow-2xl shadow-[#52677A]/5 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Unlock owner mode"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.05] bg-gradient-to-r from-[#52677A]/[0.04] to-transparent">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-[#52677A]/[0.1] border border-[#52677A]/20 shrink-0">
              <Key className="h-3.5 w-3.5 text-[#7890A3]" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white tracking-tight">
                Unlock Owner Mode
              </div>
              <div className="text-[10px] text-[#7890A3]/60 truncate">
                Paste OWNER_TOKEN. Token-only — no sign-in required.
              </div>
            </div>
          </div>
          <button
            onClick={closeAndRefresh}
            disabled={result.kind === 'checking'}
            className="h-7 w-7 flex items-center justify-center rounded-md text-slate-500 hover:text-white hover:bg-white/[0.05] transition-all disabled:opacity-40 shrink-0"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Success banner — replaces the body for a clear "DONE" state */}
        {result.kind === 'ok' ? (
          <div className="p-6 flex flex-col items-center text-center">
            <div className="h-12 w-12 rounded-full bg-[#6F8F7A]/[0.1] border border-[#6F8F7A]/30 flex items-center justify-center mb-3">
              <ShieldCheck className="h-6 w-6 text-[#6F8F7A]" />
            </div>
            <div className="text-[14px] font-semibold text-[#6F8F7A] mb-1">
              Owner Session Active
            </div>
            <div className="text-[11px] text-[#6F8F7A]/70 mb-4">
              {result.capabilitiesCount} owner capabilities granted. The
              chip in the top bar will switch to amber within a moment.
            </div>
            <button
              onClick={closeAndRefresh}
              className="px-3 py-1.5 rounded-md bg-[#6F8F7A]/[0.12] border border-[#6F8F7A]/30 text-[11px] text-[#6F8F7A] hover:bg-[#6F8F7A]/[0.18] transition-all"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-3.5">
            <div>
              <label
                htmlFor="owner-token-input"
                className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1.5"
              >
                Owner Token
              </label>
              <input
                ref={inputRef}
                id="owner-token-input"
                type="password"
                value={token}
                onChange={(e) => { setToken(e.target.value); if (result.kind !== 'checking') setResult({ kind: 'idle' }); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && result.kind !== 'checking') validate(); }}
                placeholder="paste 32+ char OWNER_TOKEN…"
                autoComplete="off"
                spellCheck={false}
                disabled={result.kind === 'checking'}
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] font-mono text-slate-200 focus:border-[#52677A]/40 focus:outline-none focus:bg-white/[0.04] transition-all disabled:opacity-50"
              />
              <div className="text-[10px] text-slate-600 mt-1.5">
                Sent as <code className="px-1 rounded bg-white/[0.04] text-slate-400">X-Korvix-Owner-Token</code>.
                The token is stored locally so you don't have to re-paste it.
              </div>
            </div>

            {/* Result panels */}
            {result.kind === 'denied' && (
              <div className="rounded-lg border border-[#B76E79]/25 bg-[#B76E79]/[0.06] px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-[#B76E79] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-[#B76E79]">
                    Invalid owner token
                  </div>
                  <div className="text-[10px] text-[#B76E79]/80 break-words mt-0.5">
                    {result.reason}
                  </div>
                  {result.signInRequired && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[#A68A5B]/80">
                      <LogIn className="h-3 w-3" />
                      Owner Mode normally works token-only.
                      If your deployment requires auth-first, sign in then retry.
                    </div>
                  )}
                </div>
              </div>
            )}
            {result.kind === 'network-error' && (
              <div className="rounded-lg border border-[#A68A5B]/25 bg-[#A68A5B]/[0.06] px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-[#A68A5B] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-[#A68A5B]">
                    Network error
                  </div>
                  <div className="text-[10px] text-[#A68A5B]/80 break-words mt-0.5">
                    Could not reach <code className="px-1 rounded bg-white/[0.04]">{API_BASE}</code> — {result.message}.
                    Check the backend is deployed and CORS allows
                    <code className="mx-1 px-1 rounded bg-white/[0.04]">X-Korvix-Owner-Token</code>.
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={forget}
                disabled={result.kind === 'checking'}
                className="text-[10px] text-slate-500 hover:text-[#B76E79] flex items-center gap-1 transition-colors disabled:opacity-40"
                title="Remove the stored token from this browser"
              >
                <Trash2 className="h-3 w-3" />
                Forget token
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={closeAndRefresh}
                  disabled={result.kind === 'checking'}
                  className="px-3 py-1.5 rounded-md text-[11px] text-slate-400 hover:text-white hover:bg-white/[0.04] transition-all disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={validate}
                  disabled={result.kind === 'checking' || token.trim().length === 0}
                  className="px-3 py-1.5 rounded-md bg-[#52677A]/[0.12] border border-[#52677A]/30 text-[11px] text-[#7890A3] hover:bg-[#52677A]/[0.18] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                >
                  {result.kind === 'checking' && <Loader2 className="h-3 w-3 animate-spin" />}
                  {result.kind === 'checking' ? 'Verifying…' : 'Unlock'}
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
