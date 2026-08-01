import { Navigate, useLocation } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  guestAllowed?: boolean;
  /** Where to send an unauthenticated visitor when the route is NOT
   *  guest-allowed. Defaults to /login (e.g. /settings); app surfaces
   *  pass /signup so anonymous visitors are pushed to create an account
   *  rather than dropped into the app in guest mode. */
  redirectTo?: string;
}

/**
 * ProtectedRoute — guards routes that require authentication.
 *
 * guestAllowed: if true, route is accessible to both guests and logged-in users.
 *   (e.g. public marketing pages)
 * guestAllowed: if false, route requires login. Redirects to `redirectTo`.
 *   (app surfaces → /signup; /settings → /login)
 */
// Paths a verification-required (unverified) user may still reach: manage their
// account, see/settle billing, and complete verification. Everything else in the
// full dashboard is blocked until the email is confirmed. Logout is an action,
// not a route, so it stays available everywhere.
const UNVERIFIED_ALLOW_PREFIXES = ['/settings', '/credits', '/billing', '/verify-email'];

export default function ProtectedRoute({ children, guestAllowed = true, redirectTo = '/login' }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Only check auth once on mount
    if (!checked) {
      checkAuth().then(() => setChecked(true));
    }
  }, [checked, checkAuth]);

  // Show loading spinner while checking auth
  if (isLoading || !checked) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-5 w-5 text-[#94A3B8] animate-spin" />
      </div>
    );
  }

  // If guest is allowed, always render (guest mode)
  if (guestAllowed) {
    return <>{children}</>;
  }

  // If auth required and not authenticated, redirect (app → /signup,
  // settings → /login). Never render an app surface for a logged-out user.
  if (!isAuthenticated) {
    return <Navigate to={redirectTo} state={{ from: location.pathname }} replace />;
  }

  // Verification gate: an authenticated but UNVERIFIED account (backend flag,
  // only true when enforcement is on) may not enter the full dashboard. Send it
  // to /verify-email, but keep account/billing/verification paths reachable.
  // Backend require_verified_identity is the real control; this mirrors it in
  // the UI so an unverified user never sees the app as fully usable.
  if (user?.verification_required === true) {
    const reachable = UNVERIFIED_ALLOW_PREFIXES.some(
      (p) => location.pathname === p || location.pathname.startsWith(p + '/'),
    );
    if (!reachable) {
      return <Navigate to="/verify-email" replace />;
    }
  }

  // Auth required and authenticated — render
  return <>{children}</>;
}
