/**
 * Founder-Beta AI protection — frontend client (Phase 14L.1).
 *
 * The SERVER is the source of truth for every limit; this module only:
 *   • holds ONE stable idempotency key per intentional Web Build submission and
 *     reuses it across that build's internal sub-calls (planning → visual →
 *     code-gen → repairs) so retries/double-clicks dedupe server-side,
 *   • injects the operation headers onto the Web Build /chat calls,
 *   • records the server operationId (from response metadata) and finalizes the
 *     operation (releasing the concurrency lock) on a terminal outcome,
 *   • maps stable backend block codes → i18n keys (localized via t()),
 *   • fetches the honest per-user beta usage snapshot for the UI.
 *
 * Never trusts client state for enforcement; a missing/dropped call fails safe
 * on the server (blocked), never bypassed.
 */

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

export type AiOperationType =
  | 'web_build_full'
  | 'web_build_major_redesign'
  | 'web_build_small_edit'
  | 'image_generation';

/** Stable backend block codes (mirror backend/services/ai_guard/policy.py). */
export type AiBlockCode =
  | 'ai_temporarily_disabled'
  | 'operation_disabled'
  | 'daily_limit_reached'
  | 'operation_in_progress'
  | 'global_spend_limit_reached'
  | 'rate_limited'
  | 'idempotency_conflict'
  | 'credit_unavailable';

const BLOCK_CODES = new Set<string>([
  'ai_temporarily_disabled', 'operation_disabled', 'daily_limit_reached',
  'operation_in_progress', 'global_spend_limit_reached', 'rate_limited',
  'idempotency_conflict', 'credit_unavailable',
]);

/** i18n key for a block code. The frontend localizes to en/tr/de via t(). */
const CODE_KEYS: Record<string, string> = {
  ai_temporarily_disabled: 'wbBetaAiDisabled',
  operation_disabled: 'wbBetaOperationDisabled',
  daily_limit_reached: 'wbBetaDailyLimit',
  operation_in_progress: 'wbBetaInProgress',
  global_spend_limit_reached: 'wbBetaCapacity',
  rate_limited: 'wbBetaRateLimited',
  idempotency_conflict: 'wbBetaConflict',
  credit_unavailable: 'wbBetaCapacity',
};

export function isBetaBlockCode(code: unknown): code is AiBlockCode {
  return typeof code === 'string' && BLOCK_CODES.has(code);
}

/** i18n key for a block code. The daily-limit message differs for a full build
 *  vs a small edit, so the operation type refines that one code. */
export function betaBlockMessageKey(code: unknown, operationType?: string): string {
  if (code === 'daily_limit_reached') {
    return operationType === 'web_build_small_edit' ? 'wbBetaDailyLimitEdit' : 'wbBetaDailyLimitFull';
  }
  return (typeof code === 'string' && CODE_KEYS[code]) || 'wbBetaGeneric';
}

function apiBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}
function getUserId(): string {
  try {
    const key = 'korvix_user_id';
    let id = localStorage.getItem(key);
    if (!id) { id = (crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}${Date.now()}`); localStorage.setItem(key, id); }
    return id;
  } catch { return 'anon'; }
}
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) h['Authorization'] = `Bearer ${tok}`;
  } catch { /* localStorage may be disabled */ }
  return h;
}
function uuid(): string {
  try { return crypto?.randomUUID?.() || ''; } catch { /* ignore */ }
  return `op-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

interface ActiveOp {
  key: string;              // client idempotency key (header X-Korvix-Operation-Id)
  type: AiOperationType;
  operationId?: string;     // server operation id (from response metadata) — used to finalize
  startedAt: number;
  scope: string;            // project/session scope; a scope change invalidates it
}

// One active operation per tab. Concurrency across tabs/users is enforced by the
// SERVER lock — this is only local double-submit + key-stability bookkeeping.
let _active: ActiveOp | null = null;
const STALE_MS = 15 * 60 * 1000;

function _fresh(op: ActiveOp | null): op is ActiveOp {
  return !!op && (Date.now() - op.startedAt) < STALE_MS;
}

/** Start a NEW intentional operation (rotates the key). Call once per user submit. */
export function beginWebBuildOperation(type: AiOperationType, scope = 'global'): string {
  _active = { key: uuid().slice(0, 80) || `op-${Date.now()}`, type, startedAt: Date.now(), scope };
  return _active.key;
}

/** Lazily ensure an active operation (covers surfaces that don't call begin). */
export function ensureActiveOperation(defaultType: AiOperationType = 'web_build_full', scope = 'global'): ActiveOp {
  if (!_fresh(_active)) _active = { key: uuid().slice(0, 80) || `op-${Date.now()}`, type: defaultType, startedAt: Date.now(), scope };
  return _active as ActiveOp;
}

/** Headers to spread onto a protected /chat call. `major_redesign` also declares
 *  the stricter, policy-gated intent (server validates it; never a bypass). */
export function activeOperationHeaders(defaultType: AiOperationType = 'web_build_full'): Record<string, string> {
  const op = ensureActiveOperation(defaultType);
  const h: Record<string, string> = { 'X-Korvix-Operation-Id': op.key };
  if (op.type === 'web_build_major_redesign') h['X-Korvix-Ai-Operation'] = 'web_build_major_redesign';
  return h;
}

/** Record the server operationId returned in a /chat response's metadata.aiOperation. */
export function attachOperationId(operationId: unknown): void {
  if (_active && typeof operationId === 'string' && operationId) _active.operationId = operationId;
}

export function isOperationActive(): boolean {
  return _fresh(_active);
}

export function clearActiveOperation(): void {
  _active = null;
}

/** Finalize the active operation (release the server lock). Best-effort; never throws.
 *  Targets the server operationId when captured, else the client key (so a Stop
 *  pressed before the first response still releases the lock). */
export async function finalizeWebBuildOperation(status: 'succeeded' | 'failed' | 'cancelled'): Promise<void> {
  const op = _active;
  _active = null;
  if (!op || (!op.operationId && !op.key)) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      await fetch(`${apiBase()}/v2/ai/operations/finalize`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ operationId: op.operationId, idempotencyKey: op.key, status, user_id: getUserId() }),
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
  } catch { /* finalize is best-effort; the server TTL releases the lock anyway */ }
}

export interface BetaUsageOperation { enabled: boolean; used: number; limit: number; remaining: number; }
export interface BetaUsage {
  mode: string;
  aiOperationsEnabled: boolean;
  resetAt?: string;
  operations: Record<string, BetaUsageOperation>;
}

/** Fetch the honest per-user founder-beta usage snapshot for the UI. */
export async function fetchBetaUsage(): Promise<BetaUsage | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(`${apiBase()}/v2/ai/usage?user_id=${encodeURIComponent(getUserId())}`, {
        method: 'GET', headers: authHeaders(), signal: ctrl.signal,
      });
      if (!resp.ok) return null;
      return (await resp.json()) as BetaUsage;
    } finally { clearTimeout(timer); }
  } catch { return null; }
}
