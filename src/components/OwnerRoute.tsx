import { Navigate } from 'react-router';
import { useEffect } from 'react';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useLanguageStore } from '@/stores/languageStore';
import { toast } from 'sonner';

/**
 * OwnerRoute — gates private-beta surfaces to owner sessions only.
 *
 * Wrap INSIDE an existing <ProtectedRoute> so auth is checked first,
 * then owner status. Non-owners are bounced to /chat with a best-effort
 * "private beta" toast. While the owner-status fetch is in flight we
 * render nothing (rather than flashing a real owner out to /chat).
 */
export default function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { isOwner, loading } = useOwnerMode();
  const { t } = useLanguageStore();

  useEffect(() => {
    if (!loading && !isOwner) {
      try { toast(t('privateBetaToast')); } catch { /* toast is optional */ }
    }
  }, [loading, isOwner, t]);

  if (loading) return null;              // avoid flashing real owners out during the status fetch
  if (!isOwner) return <Navigate to="/chat" replace />;
  return <>{children}</>;
}
