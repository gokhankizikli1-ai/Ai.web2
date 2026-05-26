/**
 * BuildInfoOverlay — small floating chip that surfaces exactly which
 * frontend build is currently rendering and which backend it's
 * talking to.
 *
 * Use case: "Vercel cached the old build" / "DNS still pointing
 * elsewhere" / "Railway didn't redeploy." Without a visible build
 * stamp, you can't tell whether the latest code is actually live —
 * you're staring at a screenshot guessing. This puts the answer on
 * screen in two seconds.
 *
 * Visibility:
 *   - DEFAULT: hidden. The overlay never renders for normal users.
 *   - SHOWN when ANY of these is true:
 *       • useOwnerMode confirms isOwner=true
 *       • URL has `?debug=1` (hash or search)
 *       • localStorage `korvix_debug=1`
 *   The same gates as the Owner UI — non-owners never see internal
 *   diagnostic data.
 *
 * Content:
 *   - Frontend commit SHA (12 chars) from VERCEL_GIT_COMMIT_SHA or
 *     fallback at build time
 *   - Build time (ISO)
 *   - Build env (vercel-prod / preview / development)
 *   - Vite branch (when available)
 *   - API base URL the app is talking to
 *   - Backend commit SHA + admin-mode flag (read from /v2/admin/status
 *     metadata + a one-shot /v2/health probe)
 *
 * Position:
 *   Fixed bottom-right with a slight margin, well clear of the
 *   BottomNav (`pb-16 sm:pb-0`). Click toggles between collapsed
 *   (commit only) and expanded (full table). Dismiss button (×)
 *   hides for the current session.
 */
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, GitCommit, ChevronUp, ChevronDown, ExternalLink, Copy } from 'lucide-react';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useAuthStore } from '@/stores/authStore';

const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_BASE = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}`;

interface BackendInfo {
  commit_sha?: string;
  environment?: string;
  version?: string;
  admin_mode?: boolean;
  fetched_at?: string;
  error?: string;
}

function isUrlDebug(): boolean {
  try {
    const fromSearch = new URLSearchParams(window.location.search).get('debug') === '1';
    const hash = window.location.hash || '';
    const hashQ = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
    const fromHash = new URLSearchParams(hashQ).get('debug') === '1';
    return fromSearch || fromHash;
  } catch { return false; }
}

function isLocalDebug(): boolean {
  try { return localStorage.getItem('korvix_debug') === '1'; }
  catch { return false; }
}

function isSessionDismissed(): boolean {
  try { return sessionStorage.getItem('korvix_build_info_dismissed') === '1'; }
  catch { return false; }
}

/* Owner-mode diagnostic helpers. Both return only booleans —
 * never the actual token values. */
function hasBearer(): boolean {
  try { return !!localStorage.getItem('korvix_access_token'); }
  catch { return false; }
}
function hasOwnerToken(): boolean {
  try { return !!localStorage.getItem('korvix_owner_token'); }
  catch { return false; }
}

function dismissForSession(): void {
  try { sessionStorage.setItem('korvix_build_info_dismissed', '1'); }
  catch { /* ignore */ }
}

export default function BuildInfoOverlay() {
  const ownerMode = useOwnerMode();
  const isOwner = ownerMode.isOwner;
  // Auth-store snapshot for owner-match diagnostic (logged-in email,
  // is_owner flag from backend's _annotate_owner). Surfaced inside the
  // expanded panel so the operator can immediately see why owner-mode
  // did or didn't activate after Google login.
  const authUser = useAuthStore((s) => s.user);
  const authIsAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [expanded, setExpanded]   = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(isSessionDismissed());
  const [backend, setBackend]     = useState<BackendInfo>({});

  const fetchBackend = useCallback(async () => {
    // Try /v2/admin/build-info first (the new endpoint, returns
    // commit + env + admin-mode flag in one shot). Fall back to
    // /v2/health which always exists.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    try {
      const r = await fetch(`${API_BASE}/v2/admin/build-info`, {
        signal: controller.signal,
        headers: (() => {
          const h: Record<string, string> = { 'Content-Type': 'application/json' };
          try {
            const ot = localStorage.getItem('korvix_owner_token');
            if (ot) h['X-Korvix-Owner-Token'] = ot;
          } catch { /* ignore */ }
          return h;
        })(),
      });
      if (r.ok) {
        const body = await r.json();
        const data = body?.data ?? {};
        setBackend({
          commit_sha:  data.commit_sha || 'unknown',
          environment: data.environment || 'unknown',
          version:     data.version || '',
          admin_mode:  !!data.admin_mode,
          fetched_at:  new Date().toISOString(),
        });
        return;
      }
    } catch { /* fall through */ }
    // Fallback — /v2/health (always available). Reuse the same abort
    // controller so a stalled backend can't hang the overlay forever.
    try {
      const r = await fetch(`${API_BASE}/v2/health`, { signal: controller.signal });
      if (r.ok) {
        const body = await r.json();
        const data = body?.data ?? {};
        const meta = body?.metadata ?? {};
        setBackend({
          commit_sha:  meta.commit_sha || 'unknown',
          environment: data.environment || 'unknown',
          version:     data.version || '',
          fetched_at:  new Date().toISOString(),
        });
        return;
      }
      setBackend({ error: `status ${r.status}` });
    } catch (e) {
      setBackend({ error: e instanceof Error ? e.message : 'fetch failed' });
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // Visibility gate — owner OR explicit debug flag. Computed BEFORE
  // the network effect so non-owners skip the /v2/admin/build-info
  // round-trip entirely. This was the biggest single startup-cost
  // regression in the perf report: every page load was firing the
  // build-info request for the 100% of users who would never see
  // the overlay.
  const shouldShow = !dismissed && (isOwner || isUrlDebug() || isLocalDebug());

  useEffect(() => {
    if (!shouldShow) return;
    fetchBackend();
  }, [shouldShow, fetchBackend]);

  if (!shouldShow) return null;

  const fe = {
    commit:   typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'dev',
    time:     typeof __BUILD_TIME__   !== 'undefined' ? __BUILD_TIME__   : '',
    env:      typeof __BUILD_ENV__    !== 'undefined' ? __BUILD_ENV__    : 'development',
    branch:   typeof __BUILD_BRANCH__ !== 'undefined' ? __BUILD_BRANCH__ : '',
  };

  const beCommit = (backend.commit_sha || '').slice(0, 12);
  const feCommit = fe.commit.slice(0, 12);
  // Highlight when FE and BE commits don't match — that's almost
  // always a sign that one of the two deploys is stale.
  const commitMismatch = beCommit && feCommit !== 'dev' && beCommit !== 'unknown' && beCommit !== feCommit;

  const copy = (text: string): void => {
    try { navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  const handleDismiss = (): void => {
    dismissForSession();
    setDismissed(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="fixed bottom-3 sm:bottom-3 right-3 z-[55] max-w-[calc(100vw-1.5rem)] pointer-events-auto"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 4.5rem)' }}
      data-testid="build-info-overlay"
    >
      <div
        className={`rounded-lg border backdrop-blur-md shadow-2xl text-[10px] font-mono transition-all ${
          commitMismatch
            ? 'border-rose-500/35 bg-rose-500/[0.08] shadow-rose-500/10'
            : 'border-white/[0.08] bg-[#0b0b12]/85'
        }`}
      >
        {/* Collapsed bar — always visible when overlay is shown */}
        <div className="flex items-center gap-2 px-2 py-1">
          <GitCommit className={`h-3 w-3 ${commitMismatch ? 'text-rose-300' : 'text-cyan-300/60'}`} />
          <span className={`${commitMismatch ? 'text-rose-200' : 'text-slate-300'}`}>
            fe <span className="font-bold">{feCommit}</span>
          </span>
          {beCommit && (
            <>
              <span className="text-slate-700">·</span>
              <span className={`${commitMismatch ? 'text-rose-200' : 'text-slate-300'}`}>
                be <span className="font-bold">{beCommit}</span>
              </span>
            </>
          )}
          <span className="text-slate-700">·</span>
          <span className="text-slate-500 hidden sm:inline">{fe.env}</span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 h-4 w-4 flex items-center justify-center text-slate-500 hover:text-white"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </button>
          <button
            onClick={handleDismiss}
            className="h-4 w-4 flex items-center justify-center text-slate-500 hover:text-rose-300"
            title="Hide for this session"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Expanded panel */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="border-t border-white/[0.05] px-2 py-2 space-y-1 overflow-hidden"
            >
              {commitMismatch && (
                <div className="text-[10px] text-rose-200 mb-1">
                  ⚠ Frontend and backend are on DIFFERENT commits.
                  At least one of the two deploys is stale.
                </div>
              )}
              <Row label="frontend"   value={feCommit} onCopy={() => copy(fe.commit)} />
              <Row label="be commit"  value={beCommit || backend.error || 'fetching…'} onCopy={beCommit ? () => copy(beCommit) : undefined} />
              <Row label="fe build"   value={fe.time ? fe.time.slice(0, 19).replace('T', ' ') + 'Z' : '—'} />
              <Row label="fe env"     value={fe.env} />
              {fe.branch && <Row label="fe branch" value={fe.branch} />}
              <Row label="be env"     value={backend.environment || '—'} />
              {backend.version && <Row label="be ver"   value={backend.version} />}
              {backend.admin_mode !== undefined && (
                <Row label="admin mode" value={backend.admin_mode ? 'enabled' : 'disabled'} />
              )}
              <Row label="api"        value={API_BASE} onCopy={() => copy(API_BASE)} />
              <Row label="origin"     value={window.location.origin} onCopy={() => copy(window.location.origin)} />

              {/* ── Owner-detection diagnostic ──────────────────────────
                  Surfaces the exact answer to "why didn't owner mode
                  activate after my Google login?" The fields cover:
                    - logged-in identity (email, kind, signed-in state)
                    - bearer JWT presence (so we know the FE is sending
                      credentials to /v2/admin/status)
                    - OWNER_TOKEN presence (the fallback unlock path)
                    - backend's first_failure (the precise reason from
                      detection_debug() when admin-debug flag is on)
                  All values are user-observed — no secret leaks. */}
              <div className="pt-2 mt-1 border-t border-white/[0.05]">
                <div className="text-[9px] uppercase tracking-wider text-amber-300/60 mb-1">
                  Owner-mode diagnostic
                </div>
                <Row label="signed in"   value={authIsAuthenticated ? 'yes' : 'no'} />
                <Row label="user email"  value={authUser?.email || '—'} />
                <Row label="user kind"   value={authUser?.kind || '—'} />
                <Row label="auth.is_owner" value={String(!!authUser?.is_owner)} />
                <Row label="bearer sent" value={hasBearer() ? 'yes' : 'no'} />
                <Row label="owner-tok"   value={hasOwnerToken() ? 'present' : 'absent'} />
                <Row label="be is_owner" value={String(isOwner)} />
                {ownerMode.debug?.first_failure && (
                  <Row label="reason"    value={ownerMode.debug.first_failure} />
                )}
                {ownerMode.debug && (
                  <Row
                    label="email match"
                    value={ownerMode.debug.user_email_match ? 'yes' : 'no'}
                  />
                )}
              </div>

              {/* ── OAuth diagnostic ────────────────────────────────────
                  The exact redirect_uri this build sends to Google. If
                  Google returns `redirect_uri_mismatch`, this is the
                  string that must be added VERBATIM to the OAuth 2.0
                  Client's Authorized redirect URIs list. Copy button
                  next to the value so you can paste it into the Google
                  Console with one tap. */}
              <div className="pt-2 mt-1 border-t border-white/[0.05]">
                <div className="text-[9px] uppercase tracking-wider text-amber-300/60 mb-1">
                  OAuth redirect_uri (this build)
                </div>
                <Row
                  label="redirect_uri"
                  value={`${window.location.origin}/login`}
                  onCopy={() => copy(`${window.location.origin}/login`)}
                />
                <Row label="client_id" value={
                  (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim() || '—'
                } />
              </div>
              <div className="pt-1 flex items-center justify-between gap-2">
                <button
                  onClick={fetchBackend}
                  className="text-[10px] text-cyan-300/80 hover:text-cyan-200"
                >
                  refresh
                </button>
                <a
                  href={`${API_BASE}/v2/health`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
                >
                  /v2/health <ExternalLink className="h-2.5 w-2.5" />
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function Row({
  label, value, onCopy,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-slate-600 w-16 shrink-0">{label}</span>
      <span className="text-slate-300 flex-1 break-all">{value}</span>
      {onCopy && (
        <button
          onClick={onCopy}
          className="text-slate-700 hover:text-slate-300 shrink-0"
          title="Copy"
        >
          <Copy className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}
