// preview.ts — frontend MIRROR of the backend Deliverable Result contract.
//
// This is NOT a new model: it mirrors, field-for-field, the renderer-agnostic
// PreviewPayload produced by the Sprint 1.5 Deliverable Result Resolver
// (backend/services/deliverable_result/types.py → PreviewPayload.to_dict()).
// The frontend never invents result fields — it reads exactly what the
// resolver returns. Keep this file in sync with that dataclass.
//
// Renderer-agnostic by design: `renderer` and `artifact_type` are plain
// strings, so future verticals (website / startup / research / game / trading
// / ecommerce) slot in with NO change here. The frontend must never branch on
// a vertical — only on the generic `renderer` hint.

// ── Result lifecycle (mirror of ResultStatus) ─────────────────────────────
export type ResultStatus =
  | 'not_found'              // unknown run / cross-user (existence-hidden)
  | 'no_run'                 // project has no run yet
  | 'pending'                // run queued, nothing produced
  | 'running'                // run in progress
  | 'partial'                // some deliverables ready, none final
  | 'completed'              // final artifact resolved
  | 'completed_no_artifact'  // run finished, produced no artifact
  | 'artifact_not_found'     // a filter matched nothing
  | 'failed'                 // run errored
  | 'cancelled';             // run cancelled

// Statuses the caller treats as "still working — poll again later".
export const NON_TERMINAL_STATUSES: ReadonlySet<ResultStatus> = new Set<ResultStatus>([
  'pending', 'running', 'partial',
]);

export function isResultTerminal(status: ResultStatus | null | undefined): boolean {
  return !!status && !NON_TERMINAL_STATUSES.has(status);
}

// ── A deliverable that fed the result (compact reference) ──────────────────
export interface SourceDeliverable {
  id:       string;
  node_id:  string;
  kind:     string;
  status:   string;
  agent_id: string;
  title:    string;
  version:  number;
}

// ── The stable result/preview payload (mirror of PreviewPayload) ───────────
export interface PreviewPayload {
  status:              ResultStatus;
  project_id:          string | null;
  run_id:              string | null;
  workflow_id:         string | null;
  artifact_id:         string | null;
  artifact_type:       string | null;
  // iframe | code | markdown | file_tree | none | <future> — a plain hint.
  renderer:            string | null;
  title:               string | null;
  summary:             string | null;
  content:             string | null;
  html_preview:        string | null;
  structured_data:     Record<string, unknown> | null;
  source_deliverables: SourceDeliverable[];
  warnings:            string[];
  errors:              string[];
  created_at:          string | null;
  updated_at:          string | null;
}

// The result route returns { result: PreviewPayload, feature_flags: {...} }.
export interface ResultResponse {
  result:        PreviewPayload;
  feature_flags: Record<string, boolean>;
}

// ── POST /v2/intelligence/orchestrate response (Sprint 1.4 + 1.5) ──────────
// Only the fields the frontend reads are typed; the route also returns plan /
// blueprint / orchestration_request which the FE does not consume here.
export interface OrchestrateExecution {
  mode:                   'execute';
  executed:               boolean;
  run_id:                 string | null;
  project_id:             string | null;
  workflow_id:            string | null;
  status:                 string | null;
  disabled_prerequisites: string[];
}

export interface OrchestrateResponse {
  mode:                   'execute' | 'dry_run';
  execution?:             OrchestrateExecution;
  // Sprint 1.5 — where to fetch the produced output later (relative path).
  result_route?:          string;
  disabled_prerequisites?: string[];
  feature_flags?:         Record<string, boolean>;
}
