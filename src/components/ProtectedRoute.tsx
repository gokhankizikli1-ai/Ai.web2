import { Navigate, useLocation } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  guestAllowed?: boolean;
}

/**
 * ProtectedRoute — guards routes that require authentication.
 *
 * guestAllowed: if true, route is accessible to both guests and logged-in users.
 *   (e.g. /chat works in guest mode)
 * guestAllowed: if false, route requires login. Redirects to /login.
 *   (e.g. /settings, /credits)
 */
export default function ProtectedRoute({ children, guestAllowed = true }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
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
        <Loader2 className="h-5 w-5 text-slate-600 animate-spin" />
      </div>
    );
  }

  // If guest is allowed, always render (guest mode)
  if (guestAllowed) {
    return <>{children}</>;
  }

  // If auth required and not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Auth required and authenticated — render
  return <>{children}</>;
}
