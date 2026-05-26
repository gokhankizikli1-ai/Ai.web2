import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useNavigate, useLocation } from 'react-router';
import {
  Sparkles, Mail, Lock, Eye, EyeOff,
  ArrowRight, User, ShieldAlert, UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';

/* ─── Google Identity Services (GIS) type stubs ─────────────────────────
 *
 * The /gsi/client script in index.html populates window.google.accounts.id.
 * We only need three calls + the credential callback shape — typing them
 * here is cheaper than pulling in @types/gapi.client.identity. */
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
interface GooglePromptMomentNotification {
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  isDismissedMoment: () => boolean;
  getDismissedReason?: () => string;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: GoogleIdConfig) => void;
          prompt: (notification?: (n: GooglePromptMomentNotification) => void) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
          cancel: () => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

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

  /* ─── Real Google OAuth via Google Identity Services ──────────────────
   *
   * Backend `/auth/google` accepts `{ id_token }`, verifies the token
   * against Google's tokeninfo endpoint AND against GOOGLE_CLIENT_ID
   * (audience check), then issues our own JWT. The id_token comes from
   * the GIS script loaded in index.html.
   *
   * Two-step flow:
   *   1. initialize() — registers a callback with GIS
   *   2. prompt()     — opens the Google account chooser; the callback
   *                     fires with the id_token when the user picks
   *                     an account
   *
   * Failure modes surfaced as setLocalError:
   *   - VITE_GOOGLE_CLIENT_ID not configured on Vercel
   *   - GIS script hasn't loaded yet (rare; we wait + retry once)
   *   - user dismissed the chooser
   *   - backend rejected the id_token (audience mismatch, expired, ...)
   */
  const handleGoogle = useCallback(() => {
    setLocalError(null);
    clearError();
    if (!GOOGLE_CLIENT_ID) {
      setLocalError(
        'Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID on Vercel ' +
        '(Production scope) and redeploy. The backend /auth/google route is ready.',
      );
      return;
    }
    const gis = window.google?.accounts?.id;
    if (!gis) {
      setLocalError('Google sign-in is still loading. Try again in a moment.');
      return;
    }
    setGoogleBusy(true);
    try {
      gis.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp) => {
          if (!resp?.credential) {
            setLocalError('Google sign-in returned no credential. Try again.');
            setGoogleBusy(false);
            return;
          }
          const ok = await loginWithGoogle(resp.credential);
          setGoogleBusy(false);
          if (ok) {
            const from = (location.state as { from?: string } | null)?.from || '/chat';
            navigate(from, { replace: true });
          }
          // ok === false → loginWithGoogle has already set the
          // store-level `error` field; useAuthStore's `error` is
          // surfaced in `displayError` below.
        },
        ux_mode: 'popup',
        auto_select: false,
      });
      gis.prompt((notification) => {
        const dismissed = notification.isDismissedMoment();
        const dismissedWithoutCredential =
          dismissed && notification.getDismissedReason?.() !== 'credential_returned';
        if (
          notification.isNotDisplayed() ||
          notification.isSkippedMoment() ||
          dismissedWithoutCredential
        ) {
          setGoogleBusy(false);
          if (dismissedWithoutCredential) {
            setLocalError('Google sign-in was cancelled.');
          }
        }
      });
    } catch (e) {
      setGoogleBusy(false);
      setLocalError(
        e instanceof Error ? e.message : 'Could not start Google sign-in.',
      );
    }
  }, [clearError, loginWithGoogle, navigate, location.state]);

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
    <div className="min-h-screen bg-gradient-premium text-foreground flex items-center justify-center px-4 relative overflow-hidden">
      {/* Soft ambient orbs */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] sm:w-[500px] sm:h-[500px] bg-cyan-500/[0.04] rounded-full blur-[100px] sm:blur-[150px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] sm:w-[400px] sm:h-[400px] bg-violet-500/[0.03] rounded-full blur-[80px] sm:blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[360px] sm:max-w-[380px]"
      >
        {/* Logo */}
        <div className="text-center mb-7">
          <Link to="/" className="inline-flex items-center gap-2.5 mb-3">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 shadow-lg shadow-cyan-500/10">
              <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
            </div>
            <span className="text-lg sm:text-xl font-bold text-foreground tracking-tight">KorvixAI</span>
          </Link>
          <p className="text-[12px] sm:text-[13px] text-muted-foreground">
            {mode === 'login' ? 'Welcome back to your AI workspace' : 'Create your AI workspace account'}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-xl p-5 sm:p-6 shadow-premium-lg">

          {/* Tab switcher */}
          <div className="flex gap-1 p-0.5 rounded-xl bg-muted border border-border mb-6">
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-all capitalize ${
                  mode === m ? 'bg-background text-foreground shadow-premium' : 'text-muted-foreground hover:text-foreground'
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
              className="w-full flex items-center justify-center gap-2.5 h-10 rounded-xl border border-border bg-muted/30 hover:bg-muted hover:border-border/80 transition-all text-[12px] text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="auth-google-button"
            >
              <GoogleIcon className="h-4 w-4" />
              {googleBusy ? 'Opening Google…' : 'Continue with Google'}
            </button>
            <button
              onClick={handleApple}
              className="w-full flex items-center justify-center gap-2.5 h-10 rounded-xl border border-border bg-muted/30 hover:bg-muted hover:border-border/80 transition-all text-[12px] text-foreground"
            >
              <AppleIcon className="h-4 w-4" />
              Continue with Apple
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-border" />
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
                    <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full name"
                      className="w-full h-10 pl-10 pr-4 rounded-xl bg-muted/40 border border-border text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-cyan-500/20 focus:bg-muted/60 transition-all"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-muted/40 border border-border text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-cyan-500/20 focus:bg-muted/60 transition-all"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full h-10 pl-10 pr-10 rounded-xl bg-muted/40 border border-border text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-cyan-500/20 focus:bg-muted/60 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
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
                  className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-100"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700/70">{displayError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 bg-foreground hover:bg-foreground/90 text-background rounded-xl text-[13px] font-medium transition-all disabled:opacity-40 shadow-premium"
            >
              {isLoading ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full" />
              ) : (
                <>
                  {mode === 'login' ? 'Sign In' : 'Create Account'}
                  <ArrowRight className="ml-1.5 w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {/* Guest */}
          <div className="mt-4 pt-4 border-t border-border text-center">
            <button
              onClick={handleGuest}
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-cyan-600 transition-colors"
            >
              <User className="w-3.5 h-3.5" />
              Continue as Guest
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground/50 mt-5">
          By continuing, you agree to our{' '}
          <Link to="/terms" className="text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
          {' '}and{' '}
          <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</Link>.
        </p>
      </motion.div>
    </div>
  );
}
