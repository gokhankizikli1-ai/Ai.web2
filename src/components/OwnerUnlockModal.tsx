/**
 * OwnerUnlockModal — paste an OWNER_TOKEN and validate it against
 * the backend.
 *
 * Why this exists: without this, the project owner had to run
 *   localStorage.setItem('korvix_owner_token', '<value>')
 * in the browser console before any admin UI would appear. That's a
 * miserable bootstrap for a feature meant for the owner.
 *
 * Flow:
 *   1. Owner pastes the token shown on Railway env (OWNER_TOKEN).
 *   2. We write it to localStorage and call /v2/admin/status with the
 *      header set.
 *   3. If the backend responds with data.is_owner=true, we close the
 *      modal, trigger a global refresh (window event consumed by
 *      useOwnerMode), and the AdminBadge / OwnerSessionIndicator
 *      light up.
 *   4. If the backend responds with is_owner=false, we surface the
 *      `data.debug.first_failure` reason so the owner can fix the
 *      env var without leaving the browser.
 *
 * "Forget token" wipes localStorage and refreshes — useful when
 * handing the laptop to someone else for a demo.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Key, Loader2, ShieldCheck, AlertTriangle, Trash2 } from 'lucide-react';

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
  | { kind: 'ok' }
  | { kind: 'denied'; reason?: string; debug?: Record<string, unknown> }
  | { kind: 'network-error'; message: string };

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
    inputRef.current?.focus();
  }, []);

  // Esc closes.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const validate = async (): Promise<void> => {
    const trimmed = token.trim();
    if (trimmed.length < 16) {
      setResult({
        kind: 'denied',
        reason: 'Token must be at least 16 characters. Generate with `python -c "import secrets; print(secrets.token_urlsafe(32))"` and set OWNER_TOKEN on Railway.',
      });
      return;
    }

    // Optimistically write to localStorage so a successful round-trip
    // doesn't require a second click. If validation fails we leave
    // it written — the owner may want to retry with the same value
    // after fixing an env var on Railway.
    try { localStorage.setItem(TOKEN_KEY, trimmed); }
    catch { /* localStorage disabled — proceed anyway, request still works */ }

    setResult({ kind: 'checking' });

    try {
      const r = await fetch(`${API_BASE}/v2/admin/status`, {
        method: 'GET',
        headers: {
          'Content-Type':           'application/json',
          'X-Korvix-Owner-Token':   trimmed,
        },
      });
      if (r.status === 404) {
        setResult({
          kind: 'denied',
          reason: 'Backend returned 404. ENABLE_ADMIN_MODE is not set on Railway, or the deploy hasn\'t picked up the env yet.',
        });
        return;
      }
      const body = await r.json();
      const data = (body?.data ?? {}) as { is_owner?: boolean; debug?: Record<string, unknown> };
      if (data.is_owner) {
        setResult({ kind: 'ok' });
        // Notify useOwnerMode and any other listeners to re-fetch.
        try { window.dispatchEvent(new CustomEvent('korvix:owner-refresh')); } catch { /* ignore */ }
        // Brief success state, then close.
        setTimeout(onClose, 800);
        return;
      }
      const failReason =
        (data.debug as { first_failure?: string } | undefined)?.first_failure ||
        'Token rejected. Check OWNER_TOKEN on Railway matches what you pasted.';
      setResult({
        kind: 'denied',
        reason: failReason,
        debug: data.debug as Record<string, unknown> | undefined,
      });
    } catch (e) {
      setResult({
        kind: 'network-error',
        message: e instanceof Error ? e.message : 'unknown',
      });
    }
  };

  const forget = (): void => {
    try { localStorage.removeItem(TOKEN_KEY); }
    catch { /* ignore */ }
    setToken('');
    setResult({ kind: 'idle' });
    try { window.dispatchEvent(new CustomEvent('korvix:owner-refresh')); } catch { /* ignore */ }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-amber-500/20 bg-[#0b0b12]/95 shadow-2xl shadow-amber-500/5 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Unlock owner mode"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.05] bg-gradient-to-r from-amber-500/[0.04] to-transparent">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-amber-500/[0.1] border border-amber-500/20">
              <Key className="h-3.5 w-3.5 text-amber-300" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-white tracking-tight">
                Unlock Owner Mode
              </div>
              <div className="text-[10px] text-amber-300/60">
                Paste the OWNER_TOKEN configured on the backend.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md text-slate-500 hover:text-white hover:bg-white/[0.05] transition-all"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
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
              onChange={(e) => { setToken(e.target.value); setResult({ kind: 'idle' }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') validate(); }}
              placeholder="e.g. abc123…xyz (32+ characters)"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] font-mono text-slate-200 focus:border-amber-500/40 focus:outline-none focus:bg-white/[0.04] transition-all"
            />
            <div className="text-[10px] text-slate-600 mt-1.5">
              The token is stored locally in your browser and sent as
              <code className="mx-1 px-1 py-0.5 rounded bg-white/[0.04] text-slate-400">X-Korvix-Owner-Token</code>
              with every admin request.
            </div>
          </div>

          {/* Result panel */}
          {result.kind === 'ok' && (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 flex items-start gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300 mt-0.5 shrink-0" />
              <div>
                <div className="text-[11px] font-medium text-emerald-200">
                  Owner Session Active
                </div>
                <div className="text-[10px] text-emerald-300/70">
                  Reloading owner UI…
                </div>
              </div>
            </div>
          )}
          {result.kind === 'denied' && (
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-300 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-rose-200">
                  Token rejected
                </div>
                <div className="text-[10px] text-rose-300/80 break-words">
                  {result.reason}
                </div>
              </div>
            </div>
          )}
          {result.kind === 'network-error' && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-300 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-amber-200">
                  Network error
                </div>
                <div className="text-[10px] text-amber-300/80 break-words">
                  Could not reach <code className="px-1 rounded bg-white/[0.04]">{API_BASE}</code> — {result.message}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={forget}
              className="text-[10px] text-slate-500 hover:text-rose-300 flex items-center gap-1 transition-colors"
              title="Remove the stored token from this browser"
            >
              <Trash2 className="h-3 w-3" />
              Forget token
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-[11px] text-slate-400 hover:text-white hover:bg-white/[0.04] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={validate}
                disabled={result.kind === 'checking' || token.trim().length === 0}
                className="px-3 py-1.5 rounded-md bg-amber-500/[0.12] border border-amber-500/30 text-[11px] text-amber-200 hover:bg-amber-500/[0.18] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
              >
                {result.kind === 'checking' && <Loader2 className="h-3 w-3 animate-spin" />}
                {result.kind === 'checking' ? 'Verifying…' : 'Unlock'}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
