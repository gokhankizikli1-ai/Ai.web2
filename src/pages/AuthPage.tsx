import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useNavigate, useLocation } from 'react-router';
import {
  Mail, Lock, Eye, EyeOff,
  ArrowRight, User, ShieldAlert, UserPlus,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import BrandLogo from '@/components/BrandLogo';

/* ─── Google Identity Services (GIS) type stubs ─────────────────────────
 *
 * The /gsi/client script in index.html populates window.google.accounts.id.
 * We only need three calls + the credential callback shape + the
 * One-Tap notification surface so we can detect why a prompt didn't
 * display (popup blocked, ITP, third-party-cookie suppression, …)
 * and surface a precise error to the user. */
interface GoogleCredentialResponse {
  credential: string;       // ID token (JWT) we POST to /auth/google
  select_by?: string;
  clientId?: string;
}
interface GoogleIdConfig {
  client_id: string;
  callback: (resp: GoogleCredentialResponse) => void;
  ux_mode?: 'popup' | 'redirect';
  auto_select?: boolean;
}
/** Subset of the PromptMomentNotification API.
 *  Docs: https://developers.google.com/identity/gsi/web/reference/js-reference#PromptMomentNotification */
interface GoogleNotification {
  isNotDisplayed: () => boolean;
  getNotDisplayedReason: () => string;        // browser_not_supported | invalid_client | missing_client_id | opt_out_or_no_session | secure_http_required | suppressed_by_user | unregistered_origin | unknown_reason
  isSkippedMoment: () => boolean;
  getSkippedReason: () => string;             // auto_cancel | user_cancel | tap_outside | issuing_failed
  isDismissedMoment: () => boolean;
  getDismissedReason: () => string;           // credential_returned | cancel_called | flow_restarted
}
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: GoogleIdConfig) => void;
          prompt: (notification?: (n: GoogleNotification) => void) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
          cancel: () => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

/* ─── Reason codes surfaced to the user / debug log ─────────────────────
 *
 * Stable strings so we can grep production logs (when the operator
 * opens /?debug=1) and know exactly which layer failed. The names
 * match what the user asked for in the spec. */
type GoogleAuthReason =
  | 'gis_not_loaded'
  | 'popup_blocked'
  | 'popup_skipped'
  | 'backend_auth_url_missing'
  | 'callback_timeout'
  | 'redirect_state_mismatch'
  | 'redirect_no_token'
  | 'redirect_uri_mismatch'
  | 'gis_error';

function googleAuthMessage(reason: GoogleAuthReason, extra?: string): string {
  const detail = extra ? `: ${extra}` : '';
  switch (reason) {
    case 'gis_not_loaded':
      return `Google sign-in script is not available${detail}. Click "Use redirect instead" below.`;
    case 'popup_blocked':
      return `Google popup was blocked by the browser${detail}. Click "Use redirect instead" below.`;
    case 'popup_skipped':
      return `Google popup closed before sign-in completed${detail}.`;
    case 'backend_auth_url_missing':
      return 'Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID on Vercel (Production scope) and redeploy.';
    case 'callback_timeout':
      return `Google did not respond within 2 seconds${detail}. Click "Use redirect instead" below.`;
    case 'redirect_state_mismatch':
      return 'OAuth state mismatch — possible CSRF or stale tab. Try again.';
    case 'redirect_uri_mismatch':
      // The `extra` already contains the exact value Google saw, with
      // the literal "add this to Google Console" call to action. No
      // need to re-state the prefix — keep the message itself short.
      return extra || 'Google rejected the redirect_uri. Authorize it in Google Cloud Console.';
    case 'redirect_no_token':
      return `Google redirect returned no id_token${detail}. Try again.`;
    case 'gis_error':
      return `Google Identity Services error${detail}.`;
  }
}

/** Returns true on Safari (desktop or mobile) and on every iOS device.
 *  Safari's Intelligent Tracking Prevention silently blocks the third-
 *  party-cookie iframe that One Tap relies on, which is why
 *  gis.prompt() can never call its callback on iPad — the iframe
 *  loads, ITP kills its session, and the GIS internal state hangs.
 *  We side-step the whole problem by using the standard OAuth 2.0
 *  redirect implicit flow on these platforms. */
function isSafariOrIOS(): boolean {
  try {
    const ua = navigator.userAgent || '';
    const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS 13+ reports as MacIntel but with touch support.
      (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
    return isSafari || isIOS;
  } catch { return false; }
}

/** Generate a 32-char URL-safe random string for OAuth state + nonce.
 *  Falls back to Math.random when crypto is unavailable (very old
 *  browsers) — still better than empty, even if not cryptographically
 *  strong. */
function randomString(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint8Array(16);
      crypto.getRandomValues(buf);
      return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* ignore */ }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const OAUTH_STATE_KEY = 'korvix_oauth_state';
const OAUTH_NONCE_KEY = 'korvix_oauth_nonce';

/**
 * Build the EXACT redirect_uri string we send to Google.
 *
 * Pinned to `${origin}/login` regardless of which auth page the click
 * came from. Reasons:
 *
 *   - Google compares redirect_uri byte-for-byte against the
 *     "Authorized redirect URIs" list. Different paths (/login vs
 *     /signup) would each need to be added separately.
 *   - The on-mount redirect-callback handler runs on /login (the
 *     route AuthPage owns), so anchoring there ensures Google's
 *     callback lands on the page that consumes the id_token.
 *   - origin (scheme + host + port) is taken verbatim from
 *     window.location so localhost/preview/prod all work without
 *     env-var configuration. The list of REAL hosts must be
 *     enumerated in Google Console — this function does NOT
 *     guess; it returns whatever the browser says.
 *
 * No trailing slash, no query string, no fragment — Google's match
 * is strict.
 */
export function googleRedirectUri(): string {
  return `${window.location.origin}/login`;
}

/** Kick the user off to Google's OAuth endpoint with implicit
 *  response_type=id_token. Google redirects back to
 *  `redirect_uri#id_token=<jwt>&state=<state>` which we read on mount.
 *  This bypasses GIS entirely — works on every browser including
 *  iPad Safari with ITP fully on. */
function startGoogleRedirect(clientId: string): void {
  const state = randomString();
  const nonce = randomString();
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, state);
    sessionStorage.setItem(OAUTH_NONCE_KEY, nonce);
  } catch { /* private mode — proceed anyway; we'll degrade state check */ }

  const redirectUri = googleRedirectUri();

  // UNCONDITIONAL console output. This is debug-grade info that the
  // operator needs visible WITHOUT having to opt into ?debug=1 first
  // — when Google returns 400 redirect_uri_mismatch the only thing
  // that resolves it is seeing the exact byte-for-byte value sent.
  // The lines are prefixed with [korvixai-auth] so they're trivial
  // to grep in DevTools.
  //
  // No PII is logged: client_id is non-secret (it's in every OAuth
  // URL Google ever serves), state/nonce are random per-request.
  /* eslint-disable no-console */
  console.log(
    '%c[korvixai-auth] Google OAuth → redirect_uri =',
    'color:#7890A3;font-weight:bold;',
    redirectUri,
  );
  console.log(
    '%c[korvixai-auth] Add this VERBATIM to Google Cloud Console → ' +
    'APIs & Services → Credentials → OAuth 2.0 Client → ' +
    'Authorized redirect URIs',
    'color:#7890A3;',
  );
  console.log('[korvixai-auth] window.location.origin   =', window.location.origin);
  console.log('[korvixai-auth] window.location.host     =', window.location.host);
  console.log('[korvixai-auth] window.location.protocol =', window.location.protocol);
  console.log('[korvixai-auth] client_id (non-secret)   =', clientId);
  /* eslint-enable no-console */

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('state', state);
  // Force the account chooser so a stale auto-login session can't
  // strand the user on the wrong Google account.
  url.searchParams.set('prompt', 'select_account');
  window.location.href = url.toString();
}

function debugLog(reason: GoogleAuthReason, extra?: string): void {
  try {
    if (localStorage.getItem('korvix_debug') === '1') {
      // eslint-disable-next-line no-console
      console.warn('[GoogleAuth]', reason, extra || '');
    }
  } catch { /* ignore */ }
}

/* ─── Google Icon SVG ─── */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

/* ─── Apple Icon SVG ─── */
function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

interface AuthPageProps {
  mode?: 'login' | 'signup';
}

export default function AuthPage({ mode: propMode }: AuthPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, signup, loginWithGoogle, isAuthenticated, isLoading, error, clearError } = useAuthStore();
  const [googleBusy, setGoogleBusy] = useState(false);

  // SYNCHRONOUS detection of an OAuth callback. Set as the initial
  // useState value (not in an effect) so the first render already
  // shows the "Signing you in…" skeleton instead of briefly flashing
  // the login form while the redirect-callback effect fires. The
  // main.tsx bootstrap has already stashed the fragment by the time
  // React renders, so reading sessionStorage here is safe.
  const [processingRedirect, setProcessingRedirect] = useState<boolean>(() => {
    try {
      const stashed = sessionStorage.getItem('korvix_oauth_response') || '';
      if (stashed && /(?:^|&)(?:id_token|error|access_token)=/.test(stashed)) {
        return true;
      }
    } catch { /* ignore */ }
    // Also catch the no-bootstrap fallback: a raw OAuth fragment
    // sitting in window.location.hash. AuthPage's effect would
    // process it; we want the skeleton up front.
    try {
      const raw = window.location.hash.replace(/^#/, '');
      if (raw && /(?:^|&)(?:id_token|error|access_token)=/.test(raw)) {
        return true;
      }
    } catch { /* ignore */ }
    return false;
  });

  // Support both /login and /signup routes, plus toggle within the page
  const urlMode = location.pathname === '/signup' ? 'signup' : 'login';
  const [mode, setMode] = useState<'login' | 'signup'>(propMode || urlMode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Sync mode when URL changes
  useEffect(() => {
    setMode(propMode || urlMode);
  }, [propMode, urlMode]);

  // Clear errors when mode changes
  useEffect(() => {
    clearError();
    setLocalError(null);
  }, [mode, clearError]);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const from = (location.state as any)?.from || '/chat';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, location.state]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();
    // UI fix (2026-06-28): if the user clicked Google → got the 2s
    // popup watchdog → then switched to email/password, the in-flight
    // watchdog would still fire and flash a red Google error banner
    // for ~2s during a successful email login. Cancel any pending
    // Google work and reset google-specific state so an email-flow
    // login is visually clean.
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    setGoogleBusy(false);
    clearGoogleErr();

    if (!email.trim() || !password.trim()) {
      setLocalError('Please fill in all fields');
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      setLocalError('Please enter your name');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters');
      return;
    }

    let success: boolean;
    if (mode === 'login') {
      success = await login(email, password);
    } else {
      success = await signup(email, password, name);
    }

    if (success) {
      const from = (location.state as any)?.from || '/chat';
      navigate(from, { replace: true });
    }
  };

  const handleGuest = () => {
    const from = (location.state as any)?.from || '/chat';
    navigate(from);
  };

  /* ─── Google OAuth — Safari/iPad-safe with timeout + redirect fallback
   *
   * Two execution paths:
   *
   *   POPUP  (Chrome/Firefox/Edge on desktop)
   *     gis.initialize() once on mount → click runs gis.prompt() with a
   *     2-second watchdog. If neither the credential callback nor the
   *     PromptMomentNotification fires in time, the watchdog resets the
   *     button and surfaces a precise reason code.
   *
   *   REDIRECT  (Safari + iPad + every browser when popup is blocked)
   *     Skip GIS entirely. Build the standard OAuth 2.0 implicit-flow
   *     URL (response_type=id_token) and navigate the tab to it. Google
   *     bounces back with `#id_token=…&state=…`; we read the fragment
   *     on mount and POST to /auth/google like the popup callback.
   *
   * The redirect path works on every browser including iPad Safari
   * with ITP fully on, where the GIS One-Tap iframe is silently
   * killed and gis.prompt() never calls its callback.
   *
   * Failure modes — surfaced as `googleReason`, mapped to user text
   * by googleAuthMessage():
   *   gis_not_loaded            GIS script never reached the page
   *   popup_blocked             Browser blocked the One-Tap iframe
   *   popup_skipped             User dismissed the popup
   *   backend_auth_url_missing  VITE_GOOGLE_CLIENT_ID empty
   *   callback_timeout          2s watchdog fired
   *   redirect_state_mismatch   CSRF guard caught a bad state param
   *   redirect_no_token         Google redirected back with no token
   *   gis_error                 initialize() threw */
  const credentialHandlerRef = useRef<(resp: GoogleCredentialResponse) => void>(() => {});
  credentialHandlerRef.current = async (resp: GoogleCredentialResponse) => {
    if (!resp?.credential) {
      setGoogleReason('popup_skipped');
      setGoogleBusy(false);
      return;
    }
    const ok = await loginWithGoogle(resp.credential);
    setGoogleBusy(false);
    if (ok) {
      const from = (location.state as { from?: string } | null)?.from || '/chat';
      navigate(from, { replace: true });
    }
  };

  const [gisReady, setGisReady] = useState(false);
  // gisFailed only true when the polling exhausted without finding the
  // script — used to flip the button label to "Google unavailable, retry".
  const [gisFailed, setGisFailed] = useState(false);
  const [googleReason, setGoogleReason] = useState<GoogleAuthReason | null>(null);
  const [googleReasonExtra, setGoogleReasonExtra] = useState<string>('');
  // Watchdog timer ref so we can cancel from the credential callback.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setGoogleErr(reason: GoogleAuthReason, extra?: string): void {
    setGoogleReason(reason);
    setGoogleReasonExtra(extra || '');
    debugLog(reason, extra);
  }
  function clearGoogleErr(): void {
    setGoogleReason(null);
    setGoogleReasonExtra('');
  }

  // ── Print the exact redirect_uri at AuthPage mount. Always logged
  // (no debug flag) so when Google returns 400 redirect_uri_mismatch
  // the operator can grep DevTools console for `[korvixai-auth]`
  // before clicking anything. Single line so it's easy to copy.
  useEffect(() => {
    /* eslint-disable no-console */
    console.log(
      '%c[korvixai-auth] Google redirect_uri (add to Google Console) =',
      'color:#7890A3;font-weight:bold;',
      `${window.location.origin}/login`,
    );
    /* eslint-enable no-console */
  }, []);

  // ── GIS one-time init. Non-blocking: the rest of the page renders
  // immediately; the Google button is enabled only once gisReady flips.
  // On Safari/iOS the popup path is unreliable anyway, so we don't even
  // wait for gisReady before allowing redirect.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    if (isSafariOrIOS()) {
      // Skip GIS init entirely on Safari/iOS — the script's One Tap
      // iframe is killed by ITP, polling for it wastes 1.5s on every
      // mount. Redirect flow doesn't need GIS at all.
      return;
    }
    let attempts = 0;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      const gis = window.google?.accounts?.id;
      if (gis) {
        try {
          gis.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: (resp) => credentialHandlerRef.current(resp),
            ux_mode: 'popup',
            auto_select: false,
          });
          setGisReady(true);
        } catch (e) {
          setGoogleErr('gis_error', e instanceof Error ? e.message : String(e));
          setGisFailed(true);
        }
        return;
      }
      attempts += 1;
      // 30 × 50ms = 1.5s maximum wait
      if (attempts < 30) {
        setTimeout(tick, 50);
      } else {
        setGisFailed(true);
        debugLog('gis_not_loaded', `polled ${attempts} times`);
      }
    };
    tick();
    return () => { cancelled = true; };
  }, []);

  // ── Redirect-callback handler. Runs on every mount and reads the URL
  // fragment for either Google's success response (`#id_token=…`) OR
  // Google's error response (`#error=redirect_uri_mismatch&...`). Both
  // get cleaned from history immediately so a reload doesn't replay
  // the result.
  useEffect(() => {
    /* Two-source read of the OAuth response:
     *   1. sessionStorage["korvix_oauth_response"] — populated by the
     *      pre-React bootstrap in src/main.tsx before HashRouter
     *      rewrote the URL to `#/login`. This is the path that
     *      actually fires in production.
     *   2. window.location.hash — fallback for environments where
     *      the bootstrap didn't run (private-mode sessionStorage
     *      blocked, dev with BrowserRouter, manual paste). */
    let hash = '';
    try {
      const stashed = sessionStorage.getItem('korvix_oauth_response') || '';
      if (stashed) {
        hash = stashed;
        // Single-shot: clear before processing so a remount can't replay.
        try { sessionStorage.removeItem('korvix_oauth_response'); }
        catch { /* ignore */ }
      }
    } catch { /* private mode — read live fragment instead */ }
    if (!hash) {
      hash = window.location.hash.replace(/^#/, '');
    }
    if (!hash) return;

    /* eslint-disable no-console */
    console.log(
      '%c[korvixai-auth] AuthPage mount — OAuth response detected',
      'color:#7890A3;font-weight:bold;',
      `${hash.length} chars`,
    );
    /* eslint-enable no-console */

    const params = new URLSearchParams(hash);

    // ── Error path: Google rejected the request server-side
    //    (redirect_uri_mismatch, invalid_client, access_denied, …)
    //    These come back in the fragment as `#error=...&error_description=...`.
    //    Surface them through the existing reason-code system so the
    //    user sees a precise message instead of a blank /login page.
    const errCode = params.get('error');
    if (errCode) {
      const errDesc = params.get('error_description') || '';
      const sentRedirectUri = googleRedirectUri();
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search); }
      catch { /* ignore */ }
      // UNCONDITIONAL console output for the error path — the operator
      // is staring at "400 redirect_uri_mismatch" and needs the exact
      // value visible without opting into ?debug=1 first.
      /* eslint-disable no-console */
      console.error(
        '%c[korvixai-auth] Google returned an OAuth error',
        'color:#B76E79;font-weight:bold;',
        { error: errCode, error_description: errDesc.replace(/\+/g, ' ') },
      );
      console.error(
        '%c[korvixai-auth] The exact redirect_uri this build sent =',
        'color:#B76E79;font-weight:bold;',
        sentRedirectUri,
      );
      if (errCode === 'redirect_uri_mismatch') {
        console.error(
          '%c[korvixai-auth] Fix: add the line above VERBATIM to ' +
          'Google Cloud Console → APIs & Services → Credentials → ' +
          'OAuth 2.0 Client → Authorized redirect URIs',
          'color:#B76E79;',
        );
      }
      /* eslint-enable no-console */
      // redirect_uri_mismatch deserves a dedicated reason — the fix is
      // ops (add the URL to Google Console), not a retry.
      if (errCode === 'redirect_uri_mismatch') {
        setGoogleErr(
          'redirect_uri_mismatch',
          `Sent redirect_uri="${sentRedirectUri}". Add this exact value to Google Cloud Console → OAuth 2.0 Client → Authorized redirect URIs.`,
        );
      } else {
        setGoogleErr('gis_error', `${errCode}${errDesc ? `: ${errDesc.replace(/\+/g, ' ')}` : ''}`);
      }
      try {
        sessionStorage.removeItem(OAUTH_STATE_KEY);
        sessionStorage.removeItem(OAUTH_NONCE_KEY);
      } catch { /* ignore */ }
      // Show the form again so the user can see the error message and
      // try email/password or retry Google. Success path leaves
      // processingRedirect=true because the page navigates away.
      setProcessingRedirect(false);
      return;
    }

    const idToken = params.get('id_token');
    if (!idToken) return;
    const incomingState = params.get('state') || '';

    // CSRF guard — the state we wrote before redirect must match.
    let expectedState = '';
    try { expectedState = sessionStorage.getItem(OAUTH_STATE_KEY) || ''; }
    catch { /* private mode — degraded check */ }

    // Strip the fragment so a reload doesn't re-process the token.
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); }
    catch { /* ignore */ }

    if (expectedState && incomingState !== expectedState) {
      /* eslint-disable no-console */
      console.error(
        '%c[korvixai-auth] OAuth state mismatch — possible CSRF or stale tab',
        'color:#B76E79;font-weight:bold;',
        { expected: expectedState.slice(0, 8) + '…', got: incomingState.slice(0, 8) + '…' },
      );
      /* eslint-enable no-console */
      setGoogleErr('redirect_state_mismatch', `got ${incomingState.slice(0, 8)}…`);
      setProcessingRedirect(false);
      return;
    }
    try {
      sessionStorage.removeItem(OAUTH_STATE_KEY);
      sessionStorage.removeItem(OAUTH_NONCE_KEY);
    } catch { /* ignore */ }

    /* eslint-disable no-console */
    console.log(
      '%c[korvixai-auth] id_token received from Google — POSTing to /auth/google',
      'color:#7890A3;font-weight:bold;',
      { id_token_length: idToken.length, state_ok: !expectedState || incomingState === expectedState },
    );
    /* eslint-enable no-console */
    setGoogleBusy(true);
    // Belt + suspenders for the production fix 2026-06-28: a popup_blocked
    // / suppressed_by_user notification from an EARLIER one-tap attempt may
    // have left a red banner in state. Once we're successfully processing
    // a redirect-flow id_token, that earlier "popup blocked" message is no
    // longer relevant — clear it so the loading spinner is the only thing
    // visible until navigate fires. (Necessary because the popup-flow's
    // credentialHandlerRef.clearGoogleErr() in handleGoogle does NOT fire
    // on the redirect path — the credential arrives via the URL hash, not
    // via gis.prompt.)
    clearGoogleErr();
    loginWithGoogle(idToken).then((ok) => {
      setGoogleBusy(false);
      if (ok) {
        // Final clearGoogleErr before navigation — defends against any
        // error that may have been set between the clear above and now
        // (e.g. by an in-flight watchdog from a parallel attempt).
        clearGoogleErr();
        const from = (location.state as { from?: string } | null)?.from || '/chat';
        /* eslint-disable no-console */
        console.log(
          '%c[korvixai-auth] Backend /auth/google accepted token → navigating to',
          'color:#6F8F7A;font-weight:bold;',
          from,
        );
        /* eslint-enable no-console */
        navigate(from, { replace: true });
      } else {
        /* eslint-disable no-console */
        console.error(
          '%c[korvixai-auth] Backend /auth/google REJECTED the id_token',
          'color:#B76E79;font-weight:bold;',
          'See authStore.error for the message',
        );
        /* eslint-enable no-console */
        setGoogleErr('redirect_no_token', 'backend rejected the id_token');
        setProcessingRedirect(false);
      }
    }).catch((e) => {
      // Defensive: apiGoogle's try/catch should always resolve, but if
      // anything in loginWithGoogle throws synchronously past the
      // promise (e.g. seedOwnerFromLogin's lazy import fails) the
      // button must still reset and the user must see why.
      /* eslint-disable no-console */
      console.error(
        '%c[korvixai-auth] loginWithGoogle threw unexpectedly',
        'color:#B76E79;font-weight:bold;',
        e,
      );
      /* eslint-enable no-console */
      setGoogleBusy(false);
      setGoogleErr('gis_error', e instanceof Error ? e.message : String(e));
      setProcessingRedirect(false);
    });
    // Effect intentionally only runs once on mount — id_token consumption
    // is one-shot and the URL hash is wiped above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Click handler. Popup-first on supported browsers; redirect-first
  // on Safari/iPad; manual "Use redirect instead" button covers the
  // popup-blocked fallback case.
  const handleGoogle = useCallback(() => {
    clearGoogleErr();
    clearError();
    if (!GOOGLE_CLIENT_ID) {
      setGoogleErr('backend_auth_url_missing');
      return;
    }
    // Safari + iPad: skip GIS, go directly to redirect.
    if (isSafariOrIOS()) {
      setGoogleBusy(true);
      startGoogleRedirect(GOOGLE_CLIENT_ID);
      return; // page unloads
    }
    const gis = window.google?.accounts?.id;
    if (!gis || !gisReady) {
      setGoogleErr('gis_not_loaded');
      return;
    }
    setGoogleBusy(true);
    // 5s watchdog: if neither the credential callback nor the
    // notification callback resolves in time, assume the popup was
    // blocked and reset the button. Was 2s — below the normal Google
    // round-trip on slower networks, which produced a false-positive
    // red banner that flashed for ~1s during successful logins
    // (production 2026-06-28). 5s is comfortably above Google's
    // typical popup-to-credential time while still short enough that
    // a truly blocked popup doesn't strand the user.
    let resolved = false;
    const finish = (reason?: GoogleAuthReason, extra?: string): void => {
      if (resolved) return;
      resolved = true;
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
      if (reason) {
        setGoogleErr(reason, extra);
        setGoogleBusy(false);
      }
    };
    watchdogRef.current = setTimeout(() => finish('callback_timeout'), 5000);

    // The credential callback path (success) resolves us via the
    // credentialHandlerRef. The notification callback path (popup
    // failure) resolves us here. Either way the watchdog gets cleared.
    const originalHandler = credentialHandlerRef.current;
    credentialHandlerRef.current = (resp) => {
      // Belt + suspenders: even if the watchdog already fired and
      // flagged callback_timeout, a late credential arrival means
      // Google was simply slow — NOT a failure. Clear the stale
      // error so the user doesn't see a red banner during what is
      // actually a successful login. Keep the spinner up via
      // setGoogleBusy(true) while the backend round-trip to
      // /auth/google completes.
      finish();
      clearGoogleErr();
      setGoogleBusy(true);
      return originalHandler(resp);
    };

    try {
      gis.prompt((notification: GoogleNotification) => {
        if (notification.isNotDisplayed?.()) {
          const reason = notification.getNotDisplayedReason?.() || 'unknown';
          // suppressed_by_user / opt_out_or_no_session aren't ACTUAL
          // failures — Google's One Tap is paused but full OAuth still
          // works via the redirect flow. Production fix 2026-06-28:
          // before, we'd flash a red "popup blocked" banner and ask
          // the user to click "Use redirect instead" — but when login
          // then succeeded via that redirect, the banner remained
          // visible. Now: silently switch to the redirect flow + clear
          // any prior error. The user sees a single Google-OAuth nav
          // instead of error→retry→nav.
          if (reason === 'suppressed_by_user' || reason === 'opt_out_or_no_session') {
            finish();          // dismiss the watchdog cleanly (no error)
            clearGoogleErr();
            setGoogleBusy(true);
            startGoogleRedirect(GOOGLE_CLIENT_ID);
            return;            // page unloads on the redirect
          }
          finish('popup_blocked', reason);
        } else if (notification.isSkippedMoment?.()) {
          const r = notification.getSkippedReason?.() || 'unknown';
          // user_cancel is benign — they closed the prompt themselves
          finish(r === 'user_cancel' ? undefined : 'popup_skipped', r);
          if (r === 'user_cancel') setGoogleBusy(false);
        }
      });
    } catch (e) {
      finish('gis_error', e instanceof Error ? e.message : String(e));
    }
  }, [clearError, gisReady]);

  // ── Manual redirect fallback (button shown after any popup failure)
  const handleGoogleRedirect = useCallback(() => {
    clearGoogleErr();
    clearError();
    if (!GOOGLE_CLIENT_ID) {
      setGoogleErr('backend_auth_url_missing');
      return;
    }
    setGoogleBusy(true);
    startGoogleRedirect(GOOGLE_CLIENT_ID);
  }, [clearError]);

  // Stable derived label so the button text reflects the actual state.
  let googleLabel = 'Continue with Google';
  if (googleBusy) googleLabel = 'Opening Google…';
  else if (gisFailed && !isSafariOrIOS()) googleLabel = 'Google unavailable — retry';

  const handleApple = useCallback(() => {
    setLocalError(
      'Apple sign-in is not yet available — the backend route returns ' +
      '503 until the `cryptography` dep + JWKS verifier are added. ' +
      'Use Google or email for now.',
    );
  }, []);

  const displayError = localError || error;

  const switchMode = (m: 'login' | 'signup') => {
    setMode(m);
    navigate(m === 'login' ? '/login' : '/signup', { replace: true });
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{
        colorScheme: 'light',
        background:
          'radial-gradient(880px 500px at 50% -8%, rgba(82,103,122,0.06), transparent 62%), linear-gradient(180deg, #F7F8FA 0%, #EEF1F4 100%)',
      }}
    >
      {/* Soft ambient accent */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] sm:w-[500px] sm:h-[500px] bg-[#52677A]/[0.05] rounded-full blur-[100px] sm:blur-[150px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[360px] sm:max-w-[380px]"
      >
        {/* Logo — shared brand, dark wordmark on porcelain */}
        <div className="text-center mb-7">
          <Link to="/" className="inline-flex mb-3">
            <BrandLogo tone="onLight" markSize={30} wordSize={19} />
          </Link>
          <p className="text-[12.5px] sm:text-[13px] text-[#64748B]">
            {mode === 'login' ? 'Welcome back to your AI workspace' : 'Create your AI workspace account'}
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border border-[#DDE3EA] bg-white p-5 sm:p-6"
          style={{ boxShadow: '0 24px 60px -30px rgba(16,24,39,0.28), 0 8px 20px -14px rgba(16,24,39,0.12)' }}
        >

          {/* Post-Google-redirect skeleton — replaces the form while the
              OAuth callback is being processed so the user sees clear
              progress instead of a blank page or a flickering form. */}
          {processingRedirect ? (
            <div
              className="flex flex-col items-center justify-center py-8 text-center"
              data-testid="auth-processing-redirect"
              role="status"
              aria-live="polite"
            >
              <div className="relative h-10 w-10 mb-3">
                <span className="absolute inset-0 rounded-full border-2 border-[#52677A]/20" />
                <span
                  className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
                  style={{ borderTopColor: 'rgba(82,103,122,0.9)' }}
                />
              </div>
              <div className="text-[13px] font-semibold text-[#0F1729] mb-1">
                Signing you in…
              </div>
              <div className="text-[11px] text-[#64748B] max-w-[260px] leading-relaxed">
                Verifying your Google credentials with the backend.
              </div>
              <div className="w-full mt-5 space-y-2">
                <div className="h-2.5 rounded bg-[#EEF1F4] animate-pulse" />
                <div className="h-2.5 rounded bg-[#EEF1F4] animate-pulse w-3/4 mx-auto" />
                <div className="h-2.5 rounded bg-[#EEF1F4] animate-pulse w-1/2 mx-auto" />
              </div>
            </div>
          ) : (
          <>
          {/* Tab switcher */}
          <div className="flex gap-1 p-1 rounded-xl bg-[#EEF1F4] border border-[#DDE3EA] mb-6">
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`flex-1 py-2 rounded-lg text-[12.5px] font-semibold transition-all capitalize ${
                  mode === m
                    ? 'bg-white text-[#0F1729] shadow-[0_1px_3px_rgba(16,24,39,0.10)]'
                    : 'text-[#64748B] hover:text-[#0F1729]'
                }`}
              >
                {m === 'login' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          {/* Social buttons */}
          <div className="space-y-2 mb-5">
            <button
              onClick={handleGoogle}
              disabled={googleBusy}
              className="w-full flex items-center justify-center gap-2.5 h-10 rounded-xl border border-[#DDE3EA] bg-white hover:bg-[#F7F8FA] hover:border-[#C3CDD8] transition-all text-[12.5px] font-medium text-[#334155] disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="auth-google-button"
            >
              <GoogleIcon className="h-4 w-4" />
              {googleLabel}
            </button>
            {googleReason && !isSafariOrIOS() && (
              <button
                onClick={handleGoogleRedirect}
                disabled={googleBusy}
                className="w-full flex items-center justify-center gap-2.5 h-9 rounded-xl border border-[#52677A]/30 bg-[#52677A]/[0.06] hover:bg-[#52677A]/[0.12] transition-all text-[11px] font-medium text-[#52677A] disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="auth-google-redirect-button"
              >
                <GoogleIcon className="h-3.5 w-3.5" />
                Use redirect instead
              </button>
            )}
            {googleReason && (
              <p
                className="text-[10.5px] text-[#B76E79] leading-snug"
                data-testid="auth-google-reason"
              >
                {googleAuthMessage(googleReason, googleReasonExtra)}
              </p>
            )}
            <button
              onClick={handleApple}
              className="w-full flex items-center justify-center gap-2.5 h-10 rounded-xl border border-[#DDE3EA] bg-white hover:bg-[#F7F8FA] hover:border-[#C3CDD8] transition-all text-[12.5px] font-medium text-[#334155]"
            >
              <AppleIcon className="h-4 w-4" />
              Continue with Apple
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-[#DDE3EA]" />
            <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-[#DDE3EA]" />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Name field (signup only) */}
            <AnimatePresence>
              {mode === 'signup' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="relative">
                    <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full name"
                      className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#F7F8FA] border border-[#DDE3EA] text-[13px] text-[#0F1729] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#52677A] focus:bg-white focus:ring-2 focus:ring-[#52677A]/15 transition-all"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#F7F8FA] border border-[#DDE3EA] text-[13px] text-[#0F1729] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#52677A] focus:bg-white focus:ring-2 focus:ring-[#52677A]/15 transition-all"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full h-10 pl-10 pr-10 rounded-xl bg-[#F7F8FA] border border-[#DDE3EA] text-[13px] text-[#0F1729] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#52677A] focus:bg-white focus:ring-2 focus:ring-[#52677A]/15 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#52677A] transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Error */}
            <AnimatePresence>
              {displayError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-start gap-2 p-2.5 rounded-lg bg-[#B76E79]/[0.08] border border-[#B76E79]/25"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-[#B76E79] shrink-0 mt-0.5" />
                  <p className="text-[11px] text-[#9B5560]">{displayError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 flex items-center justify-center rounded-xl text-[13px] font-semibold text-[#F5F7FA] transition-all disabled:opacity-50 hover:-translate-y-px"
              style={{
                background: 'linear-gradient(180deg, #161C23 0%, #0B0E12 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
                boxShadow: '0 6px 18px rgba(16,24,39,0.16), inset 0 1px 0 rgba(255,255,255,0.07)',
              }}
            >
              {isLoading ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
              ) : (
                <>
                  {mode === 'login' ? 'Sign In' : 'Create Account'}
                  <ArrowRight className="ml-1.5 w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Guest */}
          <div className="mt-4 pt-4 border-t border-[#DDE3EA] text-center">
            <button
              onClick={handleGuest}
              className="inline-flex items-center gap-1.5 text-[12px] text-[#64748B] hover:text-[#52677A] transition-colors"
            >
              <User className="w-3.5 h-3.5" />
              Continue as Guest
            </button>
          </div>
          </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-[#94A3B8] mt-5">
          By continuing, you agree to our{' '}
          <Link to="/terms" className="text-[#64748B] hover:text-[#0F1729] underline underline-offset-2 decoration-[#DDE3EA] transition-colors">Terms</Link>
          {' '}and{' '}
          <Link to="/privacy" className="text-[#64748B] hover:text-[#0F1729] underline underline-offset-2 decoration-[#DDE3EA] transition-colors">Privacy Policy</Link>.
        </p>
      </motion.div>
    </div>
  );
}
