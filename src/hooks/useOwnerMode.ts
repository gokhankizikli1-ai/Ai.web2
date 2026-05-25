/**
 * useOwnerMode — Owner / Admin Mode detection.
 *
 * Calls GET /v2/admin/status once on mount and caches the result. The
 * endpoint always returns 200; `is_owner=false` is the normal answer
 * for every non-owner user. The frontend uses this signal to decide
 * whether to render the Admin badge and Admin Panel.
 *
 * Resolution:
 *   - VITE_API_URL build var (same as useChat / useTradingSignals)
 *   - localStorage 'korvix_access_token' (set by /v2/auth/* flow when
 *     the user signs in; absent for guests)
 *
 * Failure modes:
 *   - 404 (admin mode disabled on backend) → isOwner=false, error=null
 *   - any other failure                    → isOwner=false, error set
 *
 * NEVER throws to consumers. The badge component reads isOwner and
 * silently renders nothing when it's false.
 */
import { useEffect, useState, useCallback } from 'react';

const DEFAULT_API_HOST = 'https://korvixai-backend-production.up.railway.app';
const API_BASE = `${
  (import.meta.env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  DEFAULT_API_HOST
}`;

const ADMIN_STATUS_URL = `${API_BASE}/v2/admin/status`;

export interface OwnerCapabilities {
  is_owner: boolean;
  admin_mode: boolean;
  capabilities: string[];
}

export interface OwnerModeState {
  isOwner: boolean;
  capabilities: string[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const DEFAULT_STATE: OwnerCapabilities = {
  is_owner: false,
  admin_mode: false,
  capabilities: [],
};

function readAccessToken(): string | null {
  try {
    return localStorage.getItem('korvix_access_token');
  } catch {
    return null;
  }
}

function readGuestId(): string {
  try {
    return localStorage.getItem('korvix_user_id') || '';
  } catch {
    return '';
  }
}

export function useOwnerMode(): OwnerModeState {
  const [data, setData] = useState<OwnerCapabilities>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const token = readAccessToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const guest = readGuestId();
      if (guest) headers['X-Korvix-Guest-Id'] = guest;

      const r = await fetch(ADMIN_STATUS_URL, { method: 'GET', headers });
      if (r.status === 404) {
        // Admin mode disabled on backend — not an error.
        setData(DEFAULT_STATE);
        return;
      }
      if (!r.ok) {
        setData(DEFAULT_STATE);
        setError(`status ${r.status}`);
        return;
      }
      const body = await r.json();
      if (body?.data && typeof body.data === 'object') {
        setData({
          is_owner: !!body.data.is_owner,
          admin_mode: !!body.data.admin_mode,
          capabilities: Array.isArray(body.data.capabilities) ? body.data.capabilities : [],
        });
      } else {
        setData(DEFAULT_STATE);
      }
    } catch (e: unknown) {
      setData(DEFAULT_STATE);
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    isOwner: data.is_owner,
    capabilities: data.capabilities,
    loading,
    error,
    refresh: fetchStatus,
  };
}

/**
 * Helper for components that need to check a single capability id.
 * Returns false until the status fetch resolves — i.e. the safe default
 * is "non-owner / no capability" while the page is still loading.
 */
export function hasCapability(state: OwnerModeState, capability: string): boolean {
  return state.isOwner && state.capabilities.includes(capability);
}
